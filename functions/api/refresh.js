const repository = 'https://api.github.com/repos/lingor-taho/TrendRadar';
const workflow = `${repository}/actions/workflows/crawler.yml`;
const sessionCookie = '__Secure-trendradar_refresh';
const sessionMaxAge = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();

function json(body, status = 200, cookie) {
    const headers = { 'Cache-Control': 'no-store' };
    if (cookie) headers['Set-Cookie'] = cookie;
    return Response.json(body, { status, headers });
}

async function digest(value) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function matches(provided, expected) {
    if (!provided || provided.length > 128) return false;
    const [a, b] = await Promise.all([digest(provided), digest(expected)]);
    return crypto.subtle.timingSafeEqual(a, b);
}

async function signSession(secret, expiresAt) {
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(expiresAt)));
    return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function onRequest({ request, env }) {
    const url = new URL(request.url);
    const isDispatch = request.method === 'POST';
    if (!isDispatch && request.method !== 'GET') return json({ error: 'method' }, 405);
    if (isDispatch && request.headers.get('Origin') !== url.origin) return json({ error: 'origin' }, 403);
    if (!env.REFRESH_GITHUB_TOKEN || !env.REFRESH_ACCESS_KEY || env.REFRESH_ACCESS_KEY.length < 32) {
        return json({ error: 'unconfigured' }, 503);
    }

    const cookieValue = (request.headers.get('Cookie') || '').split(';').map(value => value.trim())
        .find(value => value.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
    const [expiresAt, signature] = (cookieValue || '').split('.');
    const now = Math.floor(Date.now() / 1000);
    const validSession = /^\d{10}$/.test(expiresAt) && Number(expiresAt) > now &&
        await matches(signature, await signSession(env.REFRESH_ACCESS_KEY, expiresAt));
    let cookie;
    if (!validSession) {
        if (!isDispatch || !(await matches(request.headers.get('X-Refresh-Key'), env.REFRESH_ACCESS_KEY))) {
            return json({ error: 'authorization' }, 401);
        }
        const expiry = String(now + sessionMaxAge);
        const sessionSignature = await signSession(env.REFRESH_ACCESS_KEY, expiry);
        cookie = `${sessionCookie}=${expiry}.${sessionSignature}; Path=/api/refresh; Max-Age=${sessionMaxAge}; HttpOnly; Secure; SameSite=Strict`;
    }

    const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.REFRESH_GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'TrendRadar Pages',
        'X-GitHub-Api-Version': '2026-03-10',
    };

    try {
        if (!isDispatch) {
            const runId = url.searchParams.get('run');
            if (!/^\d{1,16}$/.test(runId || '')) return json({ error: 'run' }, 400);
            const response = await fetch(`${repository}/actions/runs/${runId}`, { headers });
            if (response.status === 404) return json({ status: 'queued' });
            if (!response.ok) return json({ error: 'github' }, 502);
            const { status, conclusion } = await response.json();
            return json({ status, conclusion });
        }

        const recent = await fetch(`${workflow}/runs?branch=master&per_page=5`, { headers });
        if (!recent.ok) return json({ error: 'github' }, 502, cookie);
        const { workflow_runs: runs } = await recent.json();
        const active = runs.find(run => run.status !== 'completed');
        if (active) return json({ runId: active.id }, 202, cookie);

        const response = await fetch(`${workflow}/dispatches`, {
            method: 'POST', headers, body: JSON.stringify({ ref: 'master' }),
        });
        if (!response.ok) return json({ error: 'dispatch' }, 502, cookie);
        const { workflow_run_id: runId } = await response.json();
        if (!Number.isSafeInteger(runId)) return json({ error: 'github' }, 502, cookie);
        return json({ runId }, 202, cookie);
    } catch {
        return json({ error: 'github' }, 502, cookie);
    }
}
