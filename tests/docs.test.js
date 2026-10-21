const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const DOCS = path.join(REPO, 'template', 'docs');

// The flags bin/create-aziz-app.js actually parses. Anything else is a flag
// the CLI silently ignores, which is worse than not documenting it at all.
const REAL_FLAGS = ['-h', '--help', '-y', '--yes', '--port', '--css', '--no-docs'];

// --production/--test belong to the dev server and npm scripts, not the
// scaffolder, so they are legitimate outside a create-aziz-app invocation.
const NON_SCAFFOLDER_FLAGS = new Set(['--production', '--test']);

function docFiles() {
    if (!fs.existsSync(DOCS)) return [];
    return fs.readdirSync(DOCS).filter(f => f.endsWith('.md'));
}

// Only a line that is actually invoking, or documenting, the scaffolder can
// make a false claim about scaffolder flags.
function isScaffolderContext(line) {
    return line.includes('create-aziz-app') || /^\|\s*`?-{1,2}[a-z]/.test(line);
}

test('docs only document CLI flags that exist', () => {
    const offenders = [];
    for (const name of docFiles()) {
        const lines = fs.readFileSync(path.join(DOCS, name), 'utf8').split('\n');
        lines.forEach((line, i) => {
            if (!isScaffolderContext(line)) return;
            for (const m of line.matchAll(/(^|\s)(--[a-z][a-z-]+)/g)) {
                const flag = m[2];
                if (!REAL_FLAGS.includes(flag) && !NON_SCAFFOLDER_FLAGS.has(flag)) {
                    offenders.push(`${name}:${i + 1} references ${flag}`);
                }
            }
        });
    }
    assert.deepEqual(offenders, [],
        `docs advertise non-existent CLI flags:\n  ${offenders.join('\n  ')}`);
});

test('the CLI parser and the docs agree on the flag list', () => {
    // Guards against the docs being updated but the CLI not (or vice versa).
    const cli = fs.readFileSync(path.join(REPO, 'bin', 'create-aziz-app.js'), 'utf8');
    const body = cli.slice(cli.indexOf('function parseArgs'), cli.indexOf('function parseArgs') + 1200);
    for (const flag of REAL_FLAGS) {
        if (flag.startsWith('--')) {
            assert.ok(body.includes(`'${flag}'`), `parseArgs no longer handles ${flag}`);
        }
    }
});

test('docs index lists every guide that exists', () => {
    const index = fs.readFileSync(path.join(DOCS, 'README.md'), 'utf8');
    const missing = [];
    for (const name of docFiles()) {
        if (name === 'README.md') continue;
        if (!index.includes(name)) missing.push(name);
    }
    assert.deepEqual(missing, [], `guides not listed in docs/README.md: ${missing.join(', ')}`);
});

test('project-structure doc does not claim files that do not ship', () => {
    const doc = fs.readFileSync(path.join(DOCS, '02-project-structure.md'), 'utf8');
    // Files the CLI no longer scaffolds. Claiming them existed sent users
    // looking for folders that were never created.
    for (const ghost of ['components/Navbar.js', 'components/Footer.js',
                         'models/User.js', 'lib/db.js', 'api/hello.js']) {
        assert.ok(!doc.includes(ghost),
            `02-project-structure.md still claims ${ghost} ships`);
    }
    // And it should mention the modules 3.2.0 added.
    for (const real of ['metadata.js', 'suspense.js']) {
        assert.ok(doc.includes(real), `02-project-structure.md omits ${real}`);
    }
});

test('the shipped template is what 02 says it is', () => {
    const appDir = path.join(REPO, 'template', 'app');
    assert.ok(fs.existsSync(path.join(appDir, 'page.js')));
    assert.ok(fs.existsSync(path.join(appDir, 'layout.js')));
    // Nothing else should be created for the user.
    const entries = fs.readdirSync(appDir).filter(e => e.endsWith('.js') || e.endsWith('.jsx'));
    assert.deepEqual(entries.sort(), ['layout.js', 'page.js'],
        'template/app should contain only layout.js and page.js');
});