const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..');
const TEMPLATE = path.join(REPO, 'template');

let PORT = 4900 + Math.floor(Math.random() * 200);

// Request helper that keeps the headers — compression and caching are
// the point of these tests.
function req(port, p, headers = {}) {
    return new Promise((resolve) => {
        const r = require('http').request({ host: '127.0.0.1', port, path: p, headers }, (res) => {
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
        r.end();
    });
}

const sleep = ms => new Promise(s => setTimeout(s, ms));

function scaffold(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aziz-prod-'));
    for (const sub of ['scripts', '_framework', 'styles']) {
        fs.cpSync(path.join(TEMPLATE, sub), path.join(dir, sub), { recursive: true });
    }
    fs.copyFileSync(path.join(TEMPLATE, 'index.html'), path.join(dir, 'index.html'));
    // @babel/standalone is a devDependency. Link the package itself (not
    // its parent directory) so the app resolves it like a real install.
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

async function withServer(dir, fn) {
    const port = PORT++;
    const srv = spawn(process.execPath, ['scripts/dev-server.js', '--production'], {
        cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'ignore'],
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
        import Button from '../components/Button.jsx';
        export const metadata = { title: 'Prod page' };
        export default function Page() {
            return <main><h1>hello production</h1><Button label="go" /></main>;
        }
    `,
    'components/Button.jsx': `
        export default function Button({ label }) {
            return <button className="btn">{label}</button>;
        }
    `,
};

// ─── Precompiler ───────────────────────────────────────────────

test('precompile emits content-hashed browser artifacts and CommonJS server artifacts', () => {
    const dir = scaffold(APP);
    try {
        const precompile = require(path.join(TEMPLATE, 'scripts', 'lib', 'precompile.js'));
        const result = precompile.compileProject(dir);
        assert.ok(result.ok, result.reason);

        const manifest = result.manifest;
        const page = manifest.files['app/page.js'];
        assert.ok(page, 'app/page.js must be in the manifest');
        assert.match(page.url, /^\/_compiled\/app\/page\.[0-9a-f]{10}\.js$/);

        // The browser artifact exists, has no JSX left, and points at the
        // hashed URL of the component it imports.
        const browserFile = path.join(dir, '.aziz', 'compiled', 'browser', page.browser);
        assert.ok(fs.existsSync(browserFile));
        const code = fs.readFileSync(browserFile, 'utf8');
        assert.ok(!/<\w+>/.test(code), 'JSX must be compiled away');
        assert.ok(code.includes('h('), 'JSX must compile to h() calls');
        assert.ok(code.includes(manifest.files['components/Button.jsx'].url),
            'local imports must point at the hashed artifact URL');

        // The server artifact is CommonJS so the renderer can evaluate it.
        const serverFile = path.join(dir, '.aziz', 'compiled', 'server', 'app', 'page.js.cjs');
        assert.ok(fs.existsSync(serverFile));
        const cjs = fs.readFileSync(serverFile, 'utf8');
        assert.ok(cjs.includes('exports'), 'server artifact must be CommonJS');
        assert.ok(!cjs.includes('import '), 'server artifact must not keep ESM imports');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('precompile follows imports into directories outside the default source set', () => {
    const dir = scaffold({
        'app/page.js': `
            import Widget from '../shared/ui/Widget';
            export default function Page() { return <Widget />; }
        `,
        'shared/ui/Widget.jsx': `
            import { tone } from './tone.js';
            export default function Widget() { return <div className={tone}>shared</div>; }
        `,
        'shared/ui/tone.js': `export const tone = 'muted';\n`,
        'server/secret.js': `export const secret = 'server-only';\n`,
    });
    try {
        const precompile = require(path.join(TEMPLATE, 'scripts', 'lib', 'precompile.js'));
        const result = precompile.compileProject(dir);
        assert.ok(result.ok, result.reason);

        const widget = result.manifest.files['shared/ui/Widget.jsx'];
        const tone = result.manifest.files['shared/ui/tone.js'];
        assert.ok(widget, 'extensionless imports outside SOURCE_DIRS must be discovered');
        assert.ok(tone, 'transitive relative imports must be discovered');
        assert.ok(!result.manifest.files['server/secret.js'], 'server-only files must stay out of the browser build');

        const code = fs.readFileSync(
            path.join(dir, '.aziz', 'compiled', 'browser', widget.browser), 'utf8');
        assert.ok(code.includes(tone.url), 'discovered imports must be rewritten to hashed URLs');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('React imports map to the framework shim, not a missing npm package', () => {
    const dir = scaffold({
        'app/page.js': `
            import React, { useState } from 'react';
            export default function Page() {
                const [count] = useState(3);
                return <p>{React.createElement('b', null, count)}</p>;
            }
        `,
    });
    try {
        const precompile = require(path.join(TEMPLATE, 'scripts', 'lib', 'precompile.js'));
        const result = precompile.compileProject(dir);
        assert.ok(result.ok, result.reason);
        assert.ok(!result.manifest.deps.missing.includes('react'),
            'react must not be reported as a missing package');

        const page = result.manifest.files['app/page.js'];
        const code = fs.readFileSync(
            path.join(dir, '.aziz', 'compiled', 'browser', page.browser), 'utf8');
        assert.ok(code.includes('/_framework/react.js'), 'react imports must map to the shim');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('precompile reports missing and CommonJS-only dependencies', () => {
    const dir = scaffold({
        ...APP,
        'app/page.js': `
            import missing from 'not-installed-pkg';
            import legacy from 'legacy-cjs-pkg';
            export default function Page() { return <p>{missing}{legacy}</p>; }
        `,
        'node_modules/legacy-cjs-pkg/package.json': JSON.stringify({
            name: 'legacy-cjs-pkg', version: '1.0.0', main: 'index.js',
        }),
        'node_modules/legacy-cjs-pkg/index.js': 'module.exports = 1;',
    });
    try {
        const precompile = require(path.join(TEMPLATE, 'scripts', 'lib', 'precompile.js'));
        const result = precompile.compileProject(dir);
        assert.ok(result.ok);
        assert.ok(result.manifest.deps.missing.includes('not-installed-pkg'),
            'a missing package must be reported');
        assert.ok(result.manifest.deps.commonjsOnly.includes('legacy-cjs-pkg'),
            'a CommonJS-only package must be reported');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('precompile never emits server-only modules to the browser', () => {
    const dir = scaffold({
        ...APP,
        'lib/db.server.js': 'export const secret = "SERVER_ONLY_SECRET";\n',
    });
    try {
        const precompile = require(path.join(TEMPLATE, 'scripts', 'lib', 'precompile.js'));
        const result = precompile.compileProject(dir);
        assert.ok(result.ok);
        assert.ok(!result.manifest.files['lib/db.server.js'],
            '*.server.js must not be compiled for the browser');
        const browserDir = path.join(dir, '.aziz', 'compiled', 'browser');
        const found = fs.existsSync(browserDir) ? fs.readdirSync(browserDir, { recursive: true }) : [];
        assert.ok(!found.some(f => String(f).includes('db.server')),
            'no server-only artifact may exist on disk');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

// ─── Production server ─────────────────────────────────────────

test('the production server serves precompiled, immutable, hashed assets', async () => {
    const dir = scaffold(APP);
    try {
        const precompile = require(path.join(TEMPLATE, 'scripts', 'lib', 'precompile.js'));
        const result = precompile.compileProject(dir);
        assert.ok(result.ok);

        await withServer(dir, async (port) => {
            const manifest = await req(port, '/_framework/routes.json');
            assert.equal(manifest.status, 200);
            const routes = JSON.parse(manifest.body).routes;
            const page = routes.find(r => r.type === 'page');
            assert.match(page.filePath, /^\/_compiled\/app\/page\.[0-9a-f]{10}\.js$/,
                'the browser must import the hashed artifact');
            assert.ok(!manifest.body.includes(dir), 'the manifest must not leak server paths');

            const asset = await req(port, page.filePath);
            assert.equal(asset.status, 200);
            assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
            assert.equal(asset.headers['x-content-type-options'], 'nosniff');
            assert.ok(!asset.body.includes('<h1'), 'the artifact must be compiled JS');

            // The page still renders server-side.
            const page1 = await req(port, '/');
            assert.equal(page1.status, 200);
            assert.ok(page1.body.includes('hello production'),
                'SSR must still work with precompiled modules');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('the health endpoint reports a precompiled runtime that never loaded Babel', async () => {
    const dir = scaffold(APP);
    try {
        const precompile = require(path.join(TEMPLATE, 'scripts', 'lib', 'precompile.js'));
        precompile.compileProject(dir);

        await withServer(dir, async (port) => {
            const health = await req(port, '/_aziz/health');
            assert.equal(health.status, 200);
            const data = JSON.parse(health.body);
            assert.equal(data.ok, true);
            assert.equal(data.precompiled, true);
            assert.equal(data.babel, 'not loaded',
                'a precompiled production server must not evaluate Babel');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('a source path redirects to its precompiled artifact instead of compiling on demand', async () => {
    const dir = scaffold(APP);
    try {
        const precompile = require(path.join(TEMPLATE, 'scripts', 'lib', 'precompile.js'));
        const compiled = precompile.compileProject(dir);
        assert.ok(compiled.ok, compiled.reason);
        const page = compiled.manifest.files['app/page.js'];
        assert.ok(page, 'app/page.js must be in the manifest');

        await withServer(dir, async (port) => {
            // The browser loads the module from its hashed URL…
            const asset = await req(port, page.url);
            assert.equal(asset.status, 200);
            assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');

            // …so the source path must not become a second URL that
            // compiles on demand (which would pull Babel into production).
            const source = await req(port, '/app/page.js');
            assert.equal(source.status, 302);
            assert.equal(source.headers.location, page.url);

            const health = await req(port, '/_aziz/health');
            assert.equal(JSON.parse(health.body).babel, 'not loaded',
                'redirecting must not load Babel');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('responses are compressed when the client accepts it', async () => {
    const dir = scaffold({
        ...APP,
        'app/page.js': `
            export default function Page() {
                return <main><h1>hello production</h1><p>{'compressible content '.repeat(200)}</p></main>;
            }
        `,
    });
    try {
        const precompile = require(path.join(TEMPLATE, 'scripts', 'lib', 'precompile.js'));
        precompile.compileProject(dir);

        await withServer(dir, async (port) => {
            const plain = await req(port, '/');
            assert.equal(plain.status, 200);
            assert.ok(!plain.headers['content-encoding']);

            const gz = await req(port, '/', { 'Accept-Encoding': 'gzip' });
            assert.equal(gz.headers['content-encoding'], 'gzip');
            assert.equal(gz.headers['vary'], 'Accept-Encoding');
            assert.ok(Number(gz.headers['content-length']) < plain.body.length,
                'gzip must be smaller than the raw body');

            const br = await req(port, '/', { 'Accept-Encoding': 'br, gzip' });
            assert.equal(br.headers['content-encoding'], 'br');
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('font preloads are cached instead of re-scanning the project per request', () => {
    const dir = scaffold({
        ...APP,
        'styles/fonts.css': '@font-face { font-family: X; src: url("/x.woff2"); }\n',
    });
    try {
        const fontOptimizer = require(path.join(TEMPLATE, 'scripts', 'lib', 'font-optimizer.js'));

        // Count directory reads to prove the project is not walked twice.
        let scans = 0;
        const original = fs.readdirSync;
        fs.readdirSync = (...args) => { scans++; return original(...args); };
        try {
            const first = fontOptimizer.collectFontPreloads(dir, { ttl: 10_000 });
            assert.equal(first.length, 1, 'the local font must be preloaded');
            const afterFirst = scans;
            assert.ok(afterFirst > 0, 'the first call must scan');

            fontOptimizer.collectFontPreloads(dir, { ttl: 10_000 });
            assert.equal(scans, afterFirst, 'the second call must be served from cache');

            fontOptimizer.invalidateFontPreloads();
            fontOptimizer.collectFontPreloads(dir, { ttl: 10_000 });
            assert.ok(scans > afterFirst, 'invalidate must force a rescan');
        } finally {
            fs.readdirSync = original;
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('the ISR cache can be moved to a shared volume (AZIZ_CACHE_DIR)', async () => {
    const dir = scaffold(APP);
    const shared = path.join(dir, 'shared-cache');
    const previous = process.env.AZIZ_CACHE_DIR;
    process.env.AZIZ_CACHE_DIR = shared;
    try {
        const staticStore = require(path.join(TEMPLATE, 'scripts', 'lib', 'static-store.js'));
        await staticStore.writeISR(dir, '/hello', { html: '<h1>isr</h1>', revalidate: 30 });

        assert.ok(fs.existsSync(path.join(shared, 'isr')),
            'the ISR entry must land in the shared cache root');
        assert.ok(!fs.existsSync(path.join(dir, '.aziz', 'cache')),
            'nothing may be written to the project-local ISR cache');

        const read = await staticStore.readISR(dir, '/hello');
        assert.match(read.html, /isr/);

        // Prerendered pages are build output: they stay next to the source
        // so they can ship inside the image.
        await staticStore.writeStatic(dir, '/hello', '<h1>static</h1>', { revalidate: 60 });
        assert.ok(fs.existsSync(path.join(dir, '.aziz', 'static', 'hello', 'index.html')),
            'prerendered pages stay in the project');
    } finally {
        if (previous === undefined) delete process.env.AZIZ_CACHE_DIR;
        else process.env.AZIZ_CACHE_DIR = previous;
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('ISR regeneration is locked so one instance regenerates a stale page', async () => {
    const dir = scaffold(APP);
    try {
        const staticStore = require(path.join(TEMPLATE, 'scripts', 'lib', 'static-store.js'));

        const release = staticStore.acquireLock(dir, '/blog/post');
        assert.ok(release, 'the first instance must get the lock');
        assert.equal(staticStore.acquireLock(dir, '/blog/post'), null,
            'a second instance must not get the lock');

        release();
        const again = staticStore.acquireLock(dir, '/blog/post');
        assert.ok(again, 'the lock must be released again');
        again();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('the cache is pluggable: a custom adapter replaces the file store', async () => {
    const dir = scaffold(APP);
    const staticStore = require(path.join(TEMPLATE, 'scripts', 'lib', 'static-store.js'));
    const seen = [];

    staticStore.setAdapter({
        async readStatic(root, pathname) {
            seen.push(['readStatic', pathname]);
            return { html: '<h1>from adapter</h1>', meta: { status: 200 } };
        },
        async writeStatic() { seen.push(['writeStatic']); },
        async readISR(root, pathname) {
            seen.push(['readISR', pathname]);
            return { html: '<h1>isr</h1>', at: Date.now(), revalidate: 30 };
        },
        async writeISR() { seen.push(['writeISR']); },
    });

    try {
        const staticEntry = await staticStore.readStatic(dir, '/x');
        assert.match(staticEntry.html, /from adapter/);
        const isrEntry = await staticStore.readISR(dir, '/x');
        assert.match(isrEntry.html, /isr/);
        assert.ok(seen.some(s => s[0] === 'readStatic'));
        assert.ok(seen.some(s => s[0] === 'readISR'));
    } finally {
        staticStore.setAdapter(null);
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('a crafted /_compiled/ path cannot escape the compiled directory', async () => {
    const dir = scaffold(APP);
    try {
        const precompile = require(path.join(TEMPLATE, 'scripts', 'lib', 'precompile.js'));
        precompile.compileProject(dir);

        await withServer(dir, async (port) => {
            for (const p of [
                '/_compiled/../package.json',
                '/_compiled/..%2f..%2fpackage.json',
                '/_compiled/app/../../index.html',
            ]) {
                const res = await req(port, p);
                assert.notEqual(res.status, 200, `${p} must not be served`);
                assert.ok(!res.body.includes('"dependencies"'),
                    `${p} must not leak package.json`);
            }
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('the server shuts down gracefully when it receives SIGTERM', async () => {
    const dir = scaffold(APP);
    try {
        const precompile = require(path.join(TEMPLATE, 'scripts', 'lib', 'precompile.js'));
        precompile.compileProject(dir);

        const port = PORT++;
        // Windows does not deliver real signals to child processes, so the
        // signal is raised in-process. The handler under test is the same.
        const boot = `
            process.argv = [process.argv[0], 'scripts/dev-server.js', '--production'];
            setTimeout(() => process.emit('SIGTERM'), 1200);
            require('./scripts/dev-server.js');
        `;
        const srv = spawn(process.execPath, ['-e', boot], {
            cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'ignore'],
        });
        const exited = new Promise((resolve) => srv.once('exit', (code) => resolve(code)));
        try {
            for (let i = 0; i < 60; i++) {
                if ((await req(port, '/_framework/routes.json')).status === 200) break;
                await sleep(100);
            }
            const code = await Promise.race([
                exited,
                sleep(10_000).then(() => 'timeout'),
            ]);
            assert.notEqual(code, 'timeout', 'the server must exit on SIGTERM');
            assert.equal(code, 0, 'a graceful shutdown exits cleanly');
        } finally {
            srv.kill();
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});
