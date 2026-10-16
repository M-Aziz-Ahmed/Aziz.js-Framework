const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { installDOM } = require('./helpers/dom.js');
const { loadFramework } = require('./helpers/esm.js');

const REPO = path.join(__dirname, '..');
const TEMPLATE = path.join(REPO, 'template');

let PORT = 4700 + Math.floor(Math.random() * 200);

function req(port, p) {
    return new Promise((resolve) => {
        const r = require('http').request({ host: '127.0.0.1', port, path: p }, (res) => {
            let b = ''; res.on('data', c => b += c);
            res.on('end', () => resolve({ status: res.statusCode, body: b, type: res.headers['content-type'] || '' }));
        });
        r.on('error', e => resolve({ status: 0, body: e.message, type: '' }));
        r.setTimeout(4000, () => { r.destroy(); resolve({ status: 0, body: 'timeout', type: '' }); });
        r.end();
    });
}

const sleep = ms => new Promise(s => setTimeout(s, ms));

// Build a throwaway project from the shipped template.
function scaffold(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aziz-sec-'));
    for (const sub of ['scripts', '_framework', 'styles']) {
        fs.cpSync(path.join(TEMPLATE, sub), path.join(dir, sub), { recursive: true });
    }
    fs.copyFileSync(path.join(TEMPLATE, 'index.html'), path.join(dir, 'index.html'));
    // @babel/standalone is a devDependency; symlink it so JSX compiles.
    const nm = path.join(TEMPLATE, 'node_modules', '@babel');
    if (fs.existsSync(nm)) {
        fs.mkdirSync(path.join(dir, 'node_modules', '@babel'), { recursive: true });
        fs.symlinkSync(nm, path.join(dir, 'node_modules', '@babel', 'standalone'), 'junction');
    }
    for (const [rel, content] of Object.entries(files)) {
        const f = path.join(dir, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
    }
    return dir;
}

async function withServer(dir, fn) {
    const port = PORT++;
    const srv = spawn(process.execPath, ['scripts/dev-server.js', '--production'], {
        cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'ignore'],
    });
    const exited = new Promise((resolve) => srv.once('exit', resolve));
    try {
        for (let i = 0; i < 50; i++) {
            if ((await req(port, '/_framework/routes.json')).status === 200) break;
            await sleep(100);
        }
        await sleep(200);
        return await fn(port);
    } finally {
        srv.kill();
        // Windows holds a lock on the cwd until the process is fully gone.
        await exited;
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch { /* temp dir cleanup is best-effort */ }
    }
}

const SECRETS = {
    'app/page.js': 'export default function Page(){ return <h1>ok</h1>; }\n',
    '.env': 'DB_PASSWORD=super_secret_value\n',
    '.env.local': 'DB_PASSWORD=prod_secret_value\n',
    '.env.production': 'TOKEN=another_secret\n',
    '.npmrc': '_authToken=npm_secret\n',
    'package.json': '{ "name": "sec", "private": true }\n',
    'package-lock.json': '{ "lockfileVersion": 3 }\n',
    'lib/db.js': 'module.exports = { secret: "CLIENT_IMPORTABLE" };\n',
    'lib/store.server.js': 'module.exports = { secret: "SERVER_ONLY_STORE" };\n',
    'server/creds.js': 'module.exports = { secret: "SERVER_DIR" };\n',
    'data/sessions.json': '{ "secret": "SESSION_DATA" }\n',
    'scripts/secret-config.js': 'module.exports = "SERVER_CONFIG";\n',
};

// Exact literals planted in SECRETS — asserting on values, not on words like
// "secret" which also appear in filenames echoed back in the 404 message.
const SECRET_VALUES = [
    'super_secret_value',
    'prod_secret_value',
    'another_secret',
    'npm_secret',
    'SERVER_ONLY_STORE',
    'SERVER_DIR',
    'SESSION_DATA',
    'SERVER_CONFIG',
];

test('BUGFIX: secrets and server internals are never served', async () => {
    const dir = scaffold(SECRETS);
    const results = await withServer(dir, async (port) => {
        const out = [];
        for (const p of [
            '/.env', '/.env.local', '/.env.production', '/.npmrc',
            '/package.json', '/package-lock.json',
            '/lib/store.server.js', '/server/creds.js',
            '/data/sessions.json', '/scripts/secret-config.js', '/scripts/dev-server.js',
        ]) {
            out.push([p, await req(port, p)]);
        }
        return out;
    });

    for (const [p, r] of results) {
        assert.equal(r.status, 404, `${p} must return 404, got ${r.status}`);
        for (const value of SECRET_VALUES) {
            assert.ok(!r.body.includes(value), `${p} leaked "${value}"`);
        }
    }
});

test('client-importable modules and the runtime are still served', async () => {
    const dir = scaffold(SECRETS);
    const results = await withServer(dir, async (port) => ({
        page: await req(port, '/app/page.js'),
        lib: await req(port, '/lib/db.js'),
        router: await req(port, '/_framework/router.js'),
        index: await req(port, '/index.html'),
        reload: await req(port, '/scripts/live-reload-client.js'),
    }));

    assert.equal(results.page.status, 200, 'app/page.js must load for the router to work');
    assert.equal(results.lib.status, 200, 'lib/ must stay importable by pages');
    assert.equal(results.router.status, 200, 'the runtime must be served');
    assert.equal(results.index.status, 200, 'index.html must be served');
    assert.equal(results.reload.status, 200, 'live-reload client is the one allowed script');
});

test('BUGFIX: a blocked path does not fall through to the SPA index', async () => {
    // /.env has no extension, so a naive check would serve index.html instead.
    const dir = scaffold(SECRETS);
    const r = await withServer(dir, (port) => req(port, '/.env'));
    assert.equal(r.status, 404);
    assert.doesNotMatch(r.body, /<div id="root">/, 'must not fall back to index.html');
    assert.doesNotMatch(r.body, /super_secret/);
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Router utilities Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

test('router exposes Next.js-compatible navigation globals', async () => {
    installDOM();
    const { router: mod } = await loadFramework(['router.js', 'runtime.js', 'hooks.js', 'route-match.js']);

    const expected = [
        'navigate', 'useRouter', 'useParams', 'useSearchParams',
        'usePathname', 'useNavigation', 'Link',
        'redirect', 'notFound', 'back', 'forward', 'refresh',
    ];
    for (const name of expected) {
        assert.equal(typeof mod[name], 'function', `${name} must be exported`);
    }
});

test('usePathname() reads window.location instead of the caller poking at it', () => {
    installDOM();
    globalThis.window.location = { pathname: '/blog/hello', search: '?q=x', hash: '' };
    return loadFramework(['router.js', 'runtime.js', 'hooks.js', 'route-match.js']).then(({ router: mod }) => {
        assert.equal(mod.usePathname(), '/blog/hello');
        assert.equal(mod.useSearchParams().get('q'), 'x');
    });
});

test('useNavigation() mirrors useRouter and reports an idle transition', async () => {
    installDOM();
    globalThis.window.location = { pathname: '/x', search: '', hash: '' };
    const { router: mod } = await loadFramework(['router.js', 'runtime.js', 'hooks.js', 'route-match.js']);
    const nav = mod.useNavigation();
    assert.equal(nav.isPending, false);
    assert.equal(nav.state, 'idle');
    assert.equal(nav.pathname, '/x');
    for (const m of ['push', 'replace', 'back', 'forward', 'refresh', 'prefetch']) {
        assert.equal(typeof nav[m], 'function', `useNavigation must expose ${m}`);
    }
    // prefetch must be a safe no-op rather than undefined
    await nav.prefetch();
});

test('useRouter() exposes replace/refresh/prefetch for Next.js parity', async () => {
    installDOM();
    globalThis.window.location = { pathname: '/y', search: '', hash: '' };
    const { router: mod } = await loadFramework(['router.js', 'runtime.js', 'hooks.js', 'route-match.js']);
    const r = mod.useRouter();
    for (const m of ['push', 'replace', 'back', 'forward', 'refresh', 'prefetch']) {
        assert.equal(typeof r[m], 'function', `useRouter must expose ${m}`);
    }
    assert.equal(r.pathname, '/y');
});

test('useTransition() runs a callback and tracks async work', async () => {
    mountHarness('/t');
    const { router: mod, runtime } = await loadFramework(['router.js', 'runtime.js', 'hooks.js', 'route-match.js']);
    const inst = mod.router;
    globalThis.h = runtime.h;

    // Exercised outside a mounted fiber: useState needs one, so assert the
    // shape via the module export and drive it through a real render below.
    assert.equal(typeof mod.useTransition, 'function');

    let inner;
    inst.register('/t', {
        default: function T() {
            inner = mod.useTransition();
            return h('p', null, String(inner[0]));
        },
    });
    await inst.render();
    assert.ok(Array.isArray(inner), 'useTransition must return a [isPending, startTransition] tuple');

    const [isPending, startTransition] = inner;
    assert.equal(isPending, false, 'idle before any transition');

    // Synchronous callback runs and returns its value.
    let ran = false;
    const out = startTransition(() => { ran = true; return 'sync-value'; });
    assert.equal(ran, true);
    assert.equal(out, 'sync-value');

    // Async callback reports pending until it settles.
    const promise = startTransition(() => Promise.resolve('async-value'));
    assert.equal(typeof promise.then, 'function', 'async callbacks stay awaitable');
    assert.equal(await promise, 'async-value');
});

test('notFound() throws a signal the router can catch', async () => {
    installDOM();
    const { router: mod } = await loadFramework(['router.js', 'runtime.js', 'hooks.js', 'route-match.js']);
    assert.throws(() => mod.notFound(), /AZIZ_NOT_FOUND/);
});

// Minimal browser-ish globals so router.render() can mount into a fake root.
function mountHarness(pathname) {
    const { document, Node } = installDOM();
    globalThis.window.location = { pathname, search: '', hash: '' };
    globalThis.window.scrollTo = () => {};
    globalThis.window.history = { pushState() {}, replaceState() {} };
    const root = new Node('div');
    document.getElementById = (id) => (id === 'root' ? root : null);
    return { root, document };
}

test('BUGFIX: notFound() swaps the page for the 404 screen', async () => {
    const { root } = mountHarness('/boom');
    const { router: mod, runtime } = await loadFramework(['router.js', 'runtime.js', 'hooks.js', 'route-match.js']);
    const router = mod.router;               // the router instance, not the namespace
    globalThis.h = runtime.h;

    router.register('/boom', { default: function Boom() { mod.notFound(); return h('div', null, 'unreachable'); } });
    router.registerNotFound({ default: () => h('h1', null, 'CUSTOM 404') });

    await router.render();
    assert.match(root.textContent, /CUSTOM 404/,
        `expected the 404 screen, got: ${JSON.stringify(root.textContent)}`);
    assert.doesNotMatch(root.textContent, /unreachable/);
});

test('a real page error is not swallowed as a 404', async () => {
    mountHarness('/crash');
    const { router: mod, runtime } = await loadFramework(['router.js', 'runtime.js', 'hooks.js', 'route-match.js']);
    const router = mod.router;
    globalThis.h = runtime.h;

    router.register('/crash', { default: () => { throw new Error('real bug'); } });
    await assert.rejects(() => router.render(), /real bug/,
        'only notFound() should be intercepted as a 404');
});

// ─── loading.js / error.js ───────────────────────────────────

const FRAMEWORK = ['router.js', 'runtime.js', 'hooks.js', 'route-match.js'];
async function loadRouter() {
    const mod = await loadFramework(FRAMEWORK);
    globalThis.h = mod.runtime.h;
    return mod;
}

test('error.js catches a render error and receives { error, reset }', async () => {
    const { root } = mountHarness('/boom');
    const { router: mod } = await loadRouter();
    const router = mod.router;

    router.register('/boom', { default: () => { throw new Error('kaboom'); } });
    let received = null;
    router.registerError('/', {
        default: function Boundary(props) {
            received = props;
            return h('p', null, 'BOUNDARY: ' + (props.error && props.error.message));
        },
    });

    await router.render();

    assert.match(root.textContent, /BOUNDARY: kaboom/,
        `expected the error boundary, got: ${JSON.stringify(root.textContent)}`);
    assert.ok(received, 'error.js must receive props');
    assert.ok(received.error instanceof Error);
    assert.equal(typeof received.reset, 'function', 'error.js must receive reset()');
});

test('without error.js the render error still propagates', async () => {
    mountHarness('/boom2');
    const { router: mod } = await loadRouter();
    const router = mod.router;
    router.register('/boom2', { default: () => { throw new Error('kaboom'); } });
    await assert.rejects(() => router.render(), /kaboom/);
});

// A page whose requests start in an effect, exactly like useFetch does.
function slowPage(hooks, label) {
    return function Page() {
        hooks.useEffect(() => {
            hooks.beginLoad();
            hooks.beginLoad();
        }, []);
        return h('p', null, label);
    };
}

test('loading.js replaces the page while requests are in flight, then restores it', async () => {
    const { root } = mountHarness('/slow');
    const { router: mod, hooks } = await loadRouter();
    const router = mod.router;

    router.register('/slow', { default: slowPage(hooks, 'REAL PAGE') });
    router.registerLoading('/', { default: () => h('p', null, 'LOADING UI') });

    await router.render();
    await sleep(20);
    assert.match(root.textContent, /REAL PAGE/, 'page paints first');

    await sleep(320);                       // past the 200ms guard
    assert.match(root.textContent, /LOADING UI/,
        `expected loading.js, got: ${JSON.stringify(root.textContent)}`);

    hooks.endLoad();
    hooks.endLoad();
    await sleep(60);
    assert.match(root.textContent, /REAL PAGE/,
        `expected the page to be restored, got: ${JSON.stringify(root.textContent)}`);
});

test('a fast route never flashes loading.js', async () => {
    const { root } = mountHarness('/fast');
    const { router: mod, hooks } = await loadRouter();
    const router = mod.router;

    router.register('/fast', { default: slowPage(hooks, 'REAL PAGE') });
    router.registerLoading('/', { default: () => h('p', null, 'LOADING UI') });

    await router.render();
    // Resolve well inside the 200ms guard.
    await sleep(30);
    hooks.endLoad();
    hooks.endLoad();
    await sleep(320);

    assert.doesNotMatch(root.textContent, /LOADING UI/,
        'a route that resolves quickly must not show a spinner');
    assert.match(root.textContent, /REAL PAGE/);
});

test('no loading.js means no transition machinery', async () => {
    const { root } = mountHarness('/plain');
    const { router: mod, hooks } = await loadRouter();
    const router = mod.router;

    router.register('/plain', { default: slowPage(hooks, 'REAL PAGE') });
    // deliberately no registerLoading

    await router.render();
    await sleep(320);
    assert.match(root.textContent, /REAL PAGE/);
    hooks.endLoad();
    hooks.endLoad();
});

test('nested loading.js overrides the root one for that subtree', async () => {
    const { root } = mountHarness('/blog');
    const { router: mod, hooks } = await loadRouter();
    const router = mod.router;

    router.register('/blog', { default: slowPage(hooks, 'BLOG PAGE') });
    router.registerLoading('/', { default: () => h('p', null, 'ROOT LOADING') });
    router.registerLoading('/blog', { default: () => h('p', null, 'BLOG LOADING') });

    await router.render();
    await sleep(340);

    assert.match(root.textContent, /BLOG LOADING/,
        `expected the deeper loading.js, got: ${JSON.stringify(root.textContent)}`);
    assert.doesNotMatch(root.textContent, /ROOT LOADING/);

    hooks.endLoad();
    hooks.endLoad();
    await sleep(60);
    assert.match(root.textContent, /BLOG PAGE/);
});