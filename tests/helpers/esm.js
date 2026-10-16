// Copies Aziz.js framework modules into a temporary "type: module"
// directory so they can be imported by Node's ESM loader during tests.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const FRAMEWORK_DIR = path.join(__dirname, '..', '..', 'template', '_framework');

let counter = 0;

function copyFramework(names) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aziz-test-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    for (const name of names) {
        const src = fs.readFileSync(path.join(FRAMEWORK_DIR, name), 'utf8');
        // Framework modules import siblings by absolute browser path
        // ("/_framework/runtime.js"), which Node's ESM loader cannot resolve.
        // Rewrite to sibling-relative so the copy runs under Node.
        const rewritten = src.replace(/(['"])\/_framework\/([^'"]+)\1/g, "'./$2'");
        fs.writeFileSync(path.join(dir, name), rewritten);
    }
    return dir;
}

function moduleURL(dir, name) {
    return pathToFileURL(path.join(dir, name)).href;
}

// Import framework modules (returns { runtime, hooks, api, routeMatch, dir })
async function loadFramework(names) {
    const dir = copyFramework(names);
    const out = { dir };
    const mapping = {
        'runtime.js': 'runtime',
        'hooks.js': 'hooks',
        'api.js': 'api',
        'route-match.js': 'routeMatch',
        'router.js': 'router',
    };
    for (const name of names) {
        out[mapping[name] || name] = await import(moduleURL(dir, name));
    }
    return out;
}

function freshModuleDir() {
    return copyFramework([]);
}

module.exports = { loadFramework, copyFramework, moduleURL, freshModuleDir, FRAMEWORK_DIR };
