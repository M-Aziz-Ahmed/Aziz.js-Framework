const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveNodeModule } = require('../template/scripts/lib/module-resolver');
const { linkBabel } = require('./helpers/babel.js');

const REPO = path.join(__dirname, '..');
const TEMPLATE = path.join(REPO, 'template');

// Ask the OS for a free port instead of picking a random one: Windows
// services (e.g. WSDAPI on 5357) can answer a colliding port with 503,
// and another test file may own the port.
function freePort() {
    return new Promise((resolve, reject) => {
        const probe = require('net').createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

function req(port, p) {
    return new Promise((resolve) => {
        const r = require('http').request({ host: '127.0.0.1', port, path: p }, (res) => {
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aziz-imports-'));
    for (const sub of ['scripts', '_framework', 'styles']) {
        fs.cpSync(path.join(TEMPLATE, sub), path.join(dir, sub), { recursive: true });
    }
    fs.copyFileSync(path.join(TEMPLATE, 'index.html'), path.join(dir, 'index.html'));
    linkBabel(dir);
    for (const [rel, content] of Object.entries(files)) {
        const f = path.join(dir, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
    }
    return dir;
}

// Dev mode is the one that resolves extensionless imports on demand. The
// watcher is disabled unless a test is about live reload.
async function withDevServer(dir, fn, { watch = false } = {}) {
    const port = await freePort();
    const env = { ...process.env, PORT: String(port), AZIZ_STREAMING: '0' };
    if (watch) delete env.AZIZ_NO_WATCH;
    else env.AZIZ_NO_WATCH = '1';
    const srv = spawn(process.execPath, ['scripts/dev-server.js'], {
        cwd: dir,
        env,
        stdio: ['ignore', 'ignore', 'ignore'],
    });
    const exited = new Promise((resolve) => srv.once('exit', resolve));
    try {
        for (let i = 0; i < 60; i++) {
            if ((await req(port, '/_framework/routes.json')).status === 200) break;
            await sleep(100);
        }
        await sleep(150);
        return await fn(port);
    } finally {
        srv.kill();
        await exited;
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch { /* best effort */ }
    }
}

// ─── Resolver ─────────────────────────────────────────────────

test('module resolver rejects path traversal', () => {
    const dir = scaffold({
        'secret.txt': 'PROJECT_SECRET',
        'node_modules/demo/package.json': JSON.stringify({
            name: 'demo', version: '1.0.0', main: 'index.js',
            exports: { '.': './index.js' },
        }),
        'node_modules/demo/index.js': 'module.exports = 1;\n',
        'node_modules/demo/lib/util.js': 'module.exports = 2;\n',
    });
    try {
        for (const specifier of [
            '../secret.txt',
            'demo/../../../secret.txt',
            'demo/../../secret.txt',
            'demo/..',
            'demo/\0',
        ]) {
            assert.equal(resolveNodeModule(specifier, dir), null, `${specifier} must not resolve`);
        }

        assert.match(resolveNodeModule('demo', dir), /demo[\\/]index\.js$/);
        // "exports" does not list lib/, but the browser still needs the
        // package's own internal files for its relative imports.
        assert.match(resolveNodeModule('demo/lib/util.js', dir), /demo[\\/]lib[\\/]util\.js$/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ─── Extensionless component imports (the reported bug) ──────

const PAGE = `
    import Card from '../components/Card';
    import Panel from '../components/Panel';
    import Counter from '../components/Counter';
    import Note from '../components/Note';
    export default function Page() {
        return <main><Card /><Panel /><Counter /><Note /></main>;
    }
`;

const COMPONENTS = {
    'app/page.js': PAGE,
    'components/Card.jsx': `
        import Label from './Label';
        export default function Card() {
            return <div class="card"><Label /></div>;
        }
    `,
    'components/Label.tsx': `
        type Props = { text?: string };
        export default function Label({ text }: Props) {
            return <span class="label">{text || 'extensionless import works'}</span>;
        }
    `,
    'components/Counter.jsx': `
        import React, { useState } from 'react';
        export default function Counter() {
            const [count] = useState(7);
            return <strong>{React.createElement('em', null, 'react-import ')}{count}</strong>;
        }
    `,
    'components/Note.mts': `
        type Props = { text?: string };
        export default function Note({ text }: Props) {
            return h('aside', null, text || 'mts note');
        }
    `,
    'components/Panel/index.jsx': `
        export default function Panel() { return <section>panel</section>; }
    `,
};

test('dev server resolves extensionless component imports as JavaScript', async () => {
    const dir = scaffold(COMPONENTS);
    const results = await withDevServer(dir, async (port) => ({
        page: await req(port, '/'),
        card: await req(port, '/components/Card'),
        label: await req(port, '/components/Label'),
        counter: await req(port, '/components/Counter'),
        note: await req(port, '/components/Note'),
        panelDir: await req(port, '/components/Panel'),
        panel: await req(port, '/components/Panel/'),
    }));

    assert.equal(results.page.status, 200);
    assert.match(results.page.body, /extensionless import works/);

    assert.equal(results.card.status, 200);
    assert.match(results.card.headers['content-type'], /javascript/);
    assert.match(results.card.body, /import Label from '\.\/Label'/);
    assert.match(results.card.body, /h\("div"/);

    assert.equal(results.label.status, 200);
    assert.match(results.label.headers['content-type'], /javascript/);
    assert.doesNotMatch(results.label.body, /type Props/, 'TypeScript must be stripped');

    assert.match(results.page.body, /react-import/);
    assert.match(results.page.body, /7/);
    assert.equal(results.counter.status, 200);
    assert.match(results.counter.headers['content-type'], /javascript/);
    assert.match(results.counter.body, /from '\/_framework\/react\.js'/);

    assert.match(results.page.body, /mts note/);
    assert.equal(results.note.status, 200);
    assert.match(results.note.headers['content-type'], /javascript/);
    assert.doesNotMatch(results.note.body, /type Props/, '.mts types must be stripped');

    assert.equal(results.panelDir.status, 301, 'directory entries need a trailing slash');
    assert.equal(results.panelDir.headers.location, '/components/Panel/');
    assert.equal(results.panel.status, 200);
    assert.match(results.panel.headers['content-type'], /javascript/);
});

test('editing an imported component refreshes SSR and the browser module', async () => {
    const dir = scaffold({
        'app/page.js': `
            import Card from '../components/Card';
            export default function Page() { return <Card />; }
        `,
        'components/Card.js': `
            export default function Card() { return <span>OLD</span>; }
        `,
    });

    const result = await withDevServer(dir, async (port) => {
        assert.match((await req(port, '/')).body, /OLD/);

        fs.writeFileSync(path.join(dir, 'components', 'Card.js'),
            'export default function Card() { return <span>NEW</span>; }\n');

        let page = null;
        for (let i = 0; i < 30; i++) {
            await sleep(200);
            page = await req(port, '/');
            if (page.body.includes('NEW')) break;
        }
        return {
            page,
            module: await req(port, '/components/Card'),
        };
    }, { watch: true });

    assert.match(result.page.body, /NEW/, 'SSR must not keep the cached page module');
    assert.match(result.module.body, /NEW/, 'the browser module must be recompiled');
});

// ─── Bare package internals ───────────────────────────────────

const PACKAGE = {
    'app/page.js': 'export default function Page() { return <p>ok</p>; }\n',
    'node_modules/demo-esm/package.json': JSON.stringify({
        name: 'demo-esm', version: '1.0.0', type: 'module',
        module: 'dist/index.js',
        exports: { '.': './dist/index.js' },
    }),
    'node_modules/demo-esm/dist/index.js': `
        import { greet } from './greet.js';
        export default function Demo() { return greet('world'); }
    `,
    'node_modules/demo-esm/dist/greet.js': `
        export function greet(name) { return 'Hi ' + name; }
    `,
};

test('bare packages keep their directory structure so relative imports resolve', async () => {
    const dir = scaffold(PACKAGE);
    const results = await withDevServer(dir, async (port) => ({
        entry: await req(port, '/_modules/demo-esm'),
        index: await req(port, '/_modules/demo-esm/dist/index.js'),
        greet: await req(port, '/_modules/demo-esm/dist/greet.js'),
        traversal: await req(port, '/_modules/..%2Fpackage.json'),
    }));

    assert.equal(results.entry.status, 302);
    assert.equal(results.entry.headers.location, '/_modules/demo-esm/dist/index.js');
    assert.equal(results.index.status, 200);
    assert.match(results.index.body, /from '\.\/greet\.js'/);
    assert.equal(results.greet.status, 200);
    assert.equal(results.traversal.status, 404, 'traversal must not read project files');
});

test('server-only TypeScript modules are never served to the browser', async () => {
    const dir = scaffold({
        'app/page.js': 'export default function Page() { return <p>ok</p>; }\n',
        'lib/db.server.ts': 'export const secret = "SERVER_ONLY_TS";\n',
    });
    const result = await withDevServer(dir, (port) => req(port, '/lib/db.server.ts'));
    assert.equal(result.status, 404);
    assert.doesNotMatch(result.body, /SERVER_ONLY_TS/);
});

test('percent-encoded dotfiles cannot bypass the block list', async () => {
    const dir = scaffold({
        'app/page.js': 'export default function Page() { return <p>ok</p>; }\n',
        '.env': 'DB_PASSWORD=encoded_secret\n',
    });
    const result = await withDevServer(dir, (port) => req(port, '/%2eenv'));
    assert.equal(result.status, 404);
    assert.doesNotMatch(result.body, /encoded_secret/);
});
