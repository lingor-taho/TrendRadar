const workflow = 'https://api.github.com/repos/lingor-taho/TrendRadar/actions/workflows/crawler.yml';
const branch = 'master';

export default {
    async fetch() {
        return new Response('Not Found', { status: 404 });
    },

    async scheduled(event, env) {
        if (!env.GITHUB_DISPATCH_TOKEN) throw new Error('Missing GitHub dispatch credential');
        const headers = {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
            'Content-Type': 'application/json',
            'User-Agent': 'TrendRadar Cloudflare Scheduler',
            'X-GitHub-Api-Version': '2026-03-10',
        };

        const history = await fetch(`${workflow}/runs?branch=${branch}&per_page=5`, { headers });
        if (!history.ok) throw new Error(`GitHub run lookup failed (${history.status})`);
        const { workflow_runs: runs } = await history.json();
        const slotStart = event.scheduledTime - 5 * 60 * 1000;
        if (runs.some(run => run.status !== 'completed' ||
            (run.conclusion === 'success' && Date.parse(run.created_at) >= slotStart))) {
            console.log('Skipping a refresh already running or completed in this slot');
            return;
        }

        const dispatch = await fetch(`${workflow}/dispatches`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ref: branch, inputs: { trigger: 'cloudflare-cron' } }),
        });
        if (!dispatch.ok) throw new Error(`GitHub dispatch failed (${dispatch.status})`);
        const { workflow_run_id: runId } = await dispatch.json();
        if (!Number.isSafeInteger(runId)) throw new Error('GitHub did not return a run ID');
        console.log(`Dispatched automatic TrendRadar refresh ${runId}`);
    },
};
