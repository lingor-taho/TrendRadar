const refreshButton = document.querySelector('.refresh-button');
const refreshDialog = document.querySelector('.refresh-dialog');
const refreshForm = refreshDialog.querySelector('form');
const refreshKeyInput = refreshForm.querySelector('input');
const refreshStatus = document.querySelector('.refresh-status');
const refreshMessage = refreshStatus.querySelector('span');
const refreshFallback = refreshStatus.querySelector('a');

function showRefreshStatus(message, showFallback = false) {
    refreshMessage.textContent = message;
    refreshFallback.hidden = !showFallback;
}

async function waitForRefresh(runId) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 8000));
        const response = await fetch('/api/refresh?run=' + runId, {
            cache: 'no-store',
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error('暂时无法查询更新进度');
        const run = await response.json();
        if (run.status !== 'completed') continue;
        if (run.conclusion !== 'success') throw new Error('本次抓取或发布未成功');
        const reportUrl = new URL(location.href);
        reportUrl.searchParams.set('refresh', runId);
        location.replace(reportUrl);
        return;
    }
    throw new Error('任务还在运行，可以到 GitHub 查看进度');
}

async function startRefresh(key) {
    if (refreshButton.getAttribute('aria-busy') === 'true') return;
    refreshButton.setAttribute('aria-busy', 'true');
    showRefreshStatus('正在请求更新…');
    try {
        const response = await fetch('/api/refresh', {
            method: 'POST',
            headers: key ? { 'X-Refresh-Key': key } : {},
            signal: AbortSignal.timeout(25000),
        });
        if (response.status === 401) {
            showRefreshStatus('');
            refreshForm.querySelector('.refresh-auth-error').textContent = key ? '更新口令不正确，请重试。' : '';
            if (!refreshDialog.open) refreshDialog.showModal();
            refreshKeyInput.focus();
            return;
        }
        if (refreshDialog.open) refreshDialog.close();
        if (response.status === 503) throw new Error('网页更新权限尚未配置，可在 GitHub 手动运行');
        if (!response.ok) throw new Error('未能启动更新，请查看 GitHub 工作流');
        const { runId } = await response.json();
        if (!Number.isSafeInteger(runId)) throw new Error('未找到更新任务');
        showRefreshStatus('正在抓取并发布，请稍候…');
        await waitForRefresh(runId);
    } catch (error) {
        showRefreshStatus(error.name === 'Error' ? error.message : '更新请求暂时不可用', true);
    } finally {
        refreshButton.removeAttribute('aria-busy');
    }
}

refreshButton.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    startRefresh();
});
refreshForm.addEventListener('submit', event => {
    event.preventDefault();
    const key = refreshKeyInput.value;
    refreshKeyInput.value = '';
    startRefresh(key);
});
refreshForm.querySelector('.refresh-cancel').addEventListener('click', () => refreshDialog.close());
refreshDialog.addEventListener('close', () => {
    refreshKeyInput.value = '';
    refreshButton.focus();
});
