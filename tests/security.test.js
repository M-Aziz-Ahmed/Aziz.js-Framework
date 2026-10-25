const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..');
const TEMPLATE = path.join(REPO, 'template');
const security = require(path.join(TEMPLATE, 'scripts', 'lib', 'security.js'));

let PORT = 5200 + Math.floor(Math.random() * 300);

function req(port, p, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve) => {
        const r = require('http').request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({
                status: res.statusCode,
                body: Buffer.concat(chunks).toString('utf8'),
                headers: res.headers,
            }));
        });
        r.on('error', e => resolve({ status: 0, body: e.message, headers: {} }));
        r.setTimeout(6000, () => { r.destroy(); resolve({ status: 0, body: 'timeout', headers: {} }); });
        if (body) r.write(body);
        r.end();
    });
}

const sleep = ms => new Promise(s => setTimeout(s, ms));

function scaffold(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aziz-sec-'));
    for (const sub of ['scripts', '_framework', 'styles']) {
        fs.cpSync(path.join(TEMPLATE, sub), path.join(dir, sub), { recursive: true });
    }
    fs.copyFileSync(path.join(TEMPLATE, 'index.html'), path.join(dir, 'index.html'));
    const babelPkg = path.join(TEMPLATE, 'node_modules', '@babel', 'standalone');
    if (fs.existsSync(babelPkg)) {
        fs.mkdirSync(path.join(dir, 'node_modules', '@babel'), { recursive: true });
        try {
            fs.symlinkSync(babelPkg, path.join(dir, 'node_modules', '@babel', 'standalone'), 'junction');
        } catch { /* symlink may be unavailable */ }
    }
    for (const [rel, content] of Object.entries(files)) {
        const f = path.join(dir, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
    }
    return dir;
}

async function withServer(dir, fn, extraEnv = {}) {
    const port = PORT++;
    const srv = spawn(process.execPath, ['scripts/dev-server.js'], {
        cwd: dir,
        env: { ...process.env, PORT: String(port), ...extraEnv },
        stdio: ['ignore', 'ignore', 'ignore'],
    });
    const exited = new Promise((resolve) => srv.once('exit', resolve));
    try {
        for (let i = 0; i < 60; i++) {
            if ((await req(port, '/_framework/routes.json')).status === 200) break;
            await sleep(100);
        }
        await sleep(200);
        return await fn(port);
    } finally {
        srv.kill();
        await exited;
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch { /* best effort */ }
    }
}

const APP = {
    'app/page.js': `
        export default function Page() {
            return <main><h1>security</h1></main>;
        }
    `,
    'api/ping.js': `
        module.exports = {
            GET() { return { ok: true }; },
            POST(request) { return { echo: request.body ?? null }; },
        };
    `,
};

// ─── CSRF ─────────────────────────────────────────────────────

test('CSRF: safe methods are never blocked', () => {
    const config = security.mergeConfig({});
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        const result = security.checkCsrf({ method, headers: { origin: 'https://evil.example' } }, config.security);
        assert.ok(result.ok, `${method} must not be blocked`);
    }
});

test('CSRF: a cross-origin write is blocked', () => {
    const config = security.mergeConfig({});
    const result = security.checkCsrf(
        { method: 'POST', headers: { origin: 'https://evil.example' } },
        config.security
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
});

test('CSRF: a cross-origin write is blocked via Referer when Origin is absent', () => {
    const config = security.mergeConfig({});
    const result = security.checkCsrf(
        { method: 'POST', headers: { referer: 'https://evil.example/form' } },
        config.security
    );
    assert.equal(result.ok, false);
});

test('CSRF: Sec-Fetch-Site: cross-site is blocked even with a same-origin Origin', () => {
    const config = security.mergeConfig({});
    const result = security.checkCsrf(
        { method: 'POST', headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' } },
        config.security
    );
    assert.equal(result.ok, false);
});

test('CSRF: a same-origin write is allowed', () => {
    const config = security.mergeConfig({});
    const result = security.checkCsrf(
        { method: 'POST', headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } },
        config.security
    );
    assert.ok(result.ok, result.reason);
});

test('CSRF: a non-browser client (no Origin, no Referer) is allowed', () => {
    const config = security.mergeConfig({});
    const result = security.checkCsrf({ method: 'POST', headers: {} }, config.security);
    assert.ok(result.ok, 'curl and server-to-server calls must keep working');
});

test('CSRF: an origin on the CORS allowlist is allowed', () => {
    const config = security.mergeConfig({ security: { cors: { origin: 'https://app.example.com' } } });
    const result = security.checkCsrf(
        { method: 'POST', headers: { origin: 'https://app.example.com' } },
        config.security
    );
    assert.ok(result.ok, result.reason);
});

test('CSRF strict mode requires the token when the cookie is present', () => {
    const config = security.mergeConfig({ security: { csrf: 'strict' } });
    const headers = {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'sec-fetch-site': 'same-origin',
        cookie: '__aziz_csrf=abc123',
    };
    const missing = security.checkCsrf({ method: 'POST', headers }, config.security);
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /CSRF token/);

    const wrong = security.checkCsrf(
        { method: 'POST', headers: { ...headers, 'x-aziz-csrf': 'nope' } },
        config.security
    );
    assert.equal(wrong.ok, false);

    const right = security.checkCsrf(
        { method: 'POST', headers: { ...headers, 'x-aziz-csrf': 'abc123' } },
        config.security
    );
    assert.ok(right.ok, right.reason);
});

test('CSRF strict mode does not demand a token from a server-side render', () => {
    const config = security.mergeConfig({ security: { csrf: 'strict' } });
    const result = security.checkCsrf(
        { method: 'POST', headers: { cookie: '__aziz_csrf=abc123' } },
        config.security
    );
    assert.ok(result.ok, 'an internal render fetch has no browser to ask');
});

test('CSRF can be disabled', () => {
    const config = security.mergeConfig({ security: { csrf: false } });
    const result = security.checkCsrf(
        { method: 'POST', headers: { origin: 'https://evil.example' } },
        config.security
    );
    assert.ok(result.ok);
});

// ─── Rate limiting ────────────────────────────────────────────

test('rate limiter allows up to the limit and then blocks', () => {
    const limiter = security.createRateLimiter({ windowMs: 60000, max: 3 });
    assert.ok(limiter.check('1.2.3.4').allowed);
    assert.ok(limiter.check('1.2.3.4').allowed);
    assert.ok(limiter.check('1.2.3.4').allowed);
    const blocked = limiter.check('1.2.3.4');
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfter > 0);
    // A different client has its own bucket.
    assert.ok(limiter.check('5.6.7.8').allowed);
});

test('rate limiter resets after the window', () => {
    const limiter = security.createRateLimiter({ windowMs: 1000, max: 1 });
    const now = Date.now();
    assert.ok(limiter.check('ip', now).allowed);
    assert.equal(limiter.check('ip', now).allowed, false);
    assert.ok(limiter.check('ip', now + 1500).allowed);
});

test('rate limiter can be disabled', () => {
    const limiter = security.createRateLimiter({ enabled: false, max: 1 });
    for (let i = 0; i < 50; i++) assert.ok(limiter.check('ip').allowed);
});

// ─── Headers ──────────────────────────────────────────────────

test('security headers are applied to every response, without overriding the app', () => {
    const headers = { 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src 'self'" };
    const written = [];
    const res = {
        writeHead(status, h) { written.push({ status, h }); return this; },
    };
    security.installSecurityHeaders(res, headers);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.writeHead(500, { 'Content-Type': 'application/json', 'X-Frame-Options': 'DENY' });
    res.writeHead(204);

    assert.equal(written[0].h['Content-Security-Policy'], "default-src 'self'");
    assert.equal(written[0].h['X-Frame-Options'], 'SAMEORIGIN');
    // An explicit header from the app wins.
    assert.equal(written[1].h['X-Frame-Options'], 'DENY');
    assert.equal(written[2].h['Content-Security-Policy'], "default-src 'self'");
});

test('security headers survive every writeHead signature', () => {
    const headers = { 'X-Frame-Options': 'SAMEORIGIN' };
    const calls = [];
    const res = {
        writeHead(...args) { calls.push(args); return this; },
    };
    security.installSecurityHeaders(res, headers);

    res.writeHead(200, 'OK', { 'Content-Type': 'text/html' });
    res.writeHead(201, ['Content-Type', 'application/json']);
    res.writeHead(202);

    assert.equal(calls[0][0], 200);
    assert.equal(calls[0][1], 'OK', 'the status message is preserved');
    assert.equal(calls[0][2]['X-Frame-Options'], 'SAMEORIGIN');

    assert.ok(calls[1][1].includes('X-Frame-Options'), 'raw header arrays are extended');
    assert.ok(calls[1][1].includes('Content-Type'), 'the original headers survive');

    assert.equal(calls[2][1]['X-Frame-Options'], 'SAMEORIGIN');
});

test('a config can remove a default header', () => {
    const config = security.mergeConfig({ security: { headers: { 'X-Frame-Options': null } } });
    assert.ok(!('X-Frame-Options' in config.security.headers));
});

// ─── Config ───────────────────────────────────────────────────

test('loadConfig reads aziz.config.js and merges it over the defaults', () => {
    const dir = scaffold({
        'aziz.config.js': `module.exports = { security: { rateLimit: { max: 7 } } };`,
    });
    try {
        const config = security.loadConfig(dir);
        assert.equal(config.security.rateLimit.max, 7);
        assert.equal(config.security.rateLimit.windowMs, 60000, 'untouched defaults survive');
        assert.equal(config.security.csrf, 'origin');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('a broken aziz.config.js does not take the server down', () => {
    const dir = scaffold({ 'aziz.config.js': `module.exports = {` });
    try {
        const config = security.loadConfig(dir);
        assert.equal(config.security.csrf, 'origin');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

// ─── Server integration ───────────────────────────────────────

test('the server sends security headers on pages, APIs and errors', async () => {
    const dir = scaffold(APP);
    try {
        await withServer(dir, async (port) => {
            const page = await req(port, '/');
            assert.equal(page.status, 200);
            assert.match(page.headers['content-security-policy'], /default-src 'self'/);
            assert.equal(page.headers['x-content-type-options'], 'nosniff');
            assert.equal(page.headers['x-frame-options'], 'SAMEORIGIN');
            assert.ok(page.headers['permissions-policy']);
            assert.ok(page.headers['referrer-policy']);

            const api = await req(port, '/api/ping');
            assert.equal(api.status, 200);
            assert.match(api.headers['content-security-policy'], /default-src 'self'/);
            assert.equal(api.headers['x-content-type-options'], 'nosniff');

            const missing = await req(port, '/nope');
            assert.equal(missing.status, 404);
            assert.ok(missing.headers['x-content-type-options'], '404s carry the headers too');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('the server does not send wildcard CORS by default', async () => {
    const dir = scaffold(APP);
    try {
        await withServer(dir, async (port) => {
            const res = await req(port, '/api/ping', { headers: { origin: 'https://evil.example' } });
            assert.equal(res.status, 200);
            assert.equal(res.headers['access-control-allow-origin'], undefined,
                'same-origin only unless the app opts in');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('CORS is enabled for an allowlisted origin', async () => {
    const dir = scaffold({
        ...APP,
        'aziz.config.js': `module.exports = { security: { cors: { origin: 'https://app.example.com' } } };`,
    });
    try {
        await withServer(dir, async (port) => {
            const allowed = await req(port, '/api/ping', { headers: { origin: 'https://app.example.com' } });
            assert.equal(allowed.headers['access-control-allow-origin'], 'https://app.example.com');

            const denied = await req(port, '/api/ping', { headers: { origin: 'https://evil.example' } });
            assert.equal(denied.headers['access-control-allow-origin'], undefined);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('the server rejects a cross-origin write', async () => {
    const dir = scaffold(APP);
    try {
        await withServer(dir, async (port) => {
            const res = await req(port, '/api/ping', {
                method: 'POST',
                headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
                body: JSON.stringify({ a: 1 }),
            });
            assert.equal(res.status, 403);
            assert.match(res.body, /CSRF/);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('the server allows a same-origin write', async () => {
    const dir = scaffold(APP);
    try {
        await withServer(dir, async (port) => {
            const res = await req(port, '/api/ping', {
                method: 'POST',
                headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' },
                body: JSON.stringify({ a: 1 }),
            });
            assert.equal(res.status, 200);
            assert.match(res.body, /"a":1/);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('the server rate-limits API requests', async () => {
    const dir = scaffold({
        ...APP,
        'aziz.config.js': `module.exports = { security: { rateLimit: { windowMs: 60000, max: 3 } } };`,
    });
    try {
        await withServer(dir, async (port) => {
            const statuses = [];
            for (let i = 0; i < 5; i++) {
                statuses.push((await req(port, '/api/ping')).status);
            }
            assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
            assert.equal(statuses[3], 429);
            assert.equal(statuses[4], 429);

            const blocked = await req(port, '/api/ping');
            assert.equal(blocked.status, 429);
            assert.ok(blocked.headers['retry-after']);
            assert.equal(blocked.headers['x-ratelimit-remaining'], '0');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('the server issues a CSRF cookie in strict mode', async () => {
    const dir = scaffold({
        ...APP,
        'aziz.config.js': `module.exports = { security: { csrf: 'strict' } };`,
    });
    try {
        await withServer(dir, async (port) => {
            const page = await req(port, '/');
            assert.equal(page.status, 200);
            const cookies = [].concat(page.headers['set-cookie'] || []);
            const csrf = cookies.find(c => c.startsWith('__aziz_csrf='));
            assert.ok(csrf, 'the document hands out a CSRF cookie');
            assert.match(csrf, /SameSite=Lax/);

            const token = csrf.split(';')[0].split('=')[1];

            const withoutToken = await req(port, '/api/ping', {
                method: 'POST',
                headers: { origin: `http://127.0.0.1:${port}`, cookie: `__aziz_csrf=${token}` },
            });
            assert.equal(withoutToken.status, 403);
            assert.match(withoutToken.body, /CSRF token/);

            const withToken = await req(port, '/api/ping', {
                method: 'POST',
                headers: {
                    origin: `http://127.0.0.1:${port}`,
                    cookie: `__aziz_csrf=${token}`,
                    'x-aziz-csrf': token,
                },
            });
            assert.equal(withToken.status, 200);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('aziz.config.js is never served to the browser', async () => {
    const dir = scaffold({
        ...APP,
        'aziz.config.js': `module.exports = { security: { cors: { origin: '*' } } };`,
    });
    try {
        await withServer(dir, async (port) => {
            const res = await req(port, '/aziz.config.js');
            assert.equal(res.status, 404);
            assert.ok(!res.body.includes('cors'), 'the config must not leak');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});
