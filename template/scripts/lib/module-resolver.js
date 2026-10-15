// ============================================================
//  Aziz.js — node_modules resolver for browser bare imports
//  Maps /_modules/<pkg>… to a real file inside node_modules.
//  Supports: package.json "exports", "browser", "module", "main".
// ============================================================

const fs = require('fs');
const path = require('path');

const EXTENSIONS = ['.js', '.mjs', '.cjs', '.json'];

function statIsFile(p) {
    try { return fs.statSync(p).isFile(); } catch { return false; }
}

function firstExisting(candidates) {
    for (const c of candidates) {
        if (statIsFile(c)) return c;
        for (const ext of EXTENSIONS) {
            if (statIsFile(c + ext)) return c + ext;
        }
        if (statIsFile(path.join(c, 'index.js'))) return path.join(c, 'index.js');
    }
    return null;
}

// Resolve a value from the "exports" field (string or nested conditions).
// Condition order prefers browser builds, then ESM, then CJS.
function resolveExportsValue(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        for (const v of value) {
            const r = resolveExportsValue(v);
            if (r) return r;
        }
        return null;
    }
    if (value && typeof value === 'object') {
        for (const cond of ['browser', 'import', 'module', 'default', 'require']) {
            if (cond in value) {
                const r = resolveExportsValue(value[cond]);
                if (r) return r;
            }
        }
    }
    return null;
}

function resolveExportsField(exportsField, subPath) {
    if (!exportsField) return null;

    // "exports": "./index.js"
    if (typeof exportsField === 'string') {
        return subPath ? null : exportsField;
    }

    // Conditional exports at the top level (no subpaths)
    if (!subPath) {
        if ('.' in exportsField || Object.keys(exportsField).some(k => k.startsWith('./'))) {
            return '.' in exportsField ? resolveExportsValue(exportsField['.']) : null;
        }
        return resolveExportsValue(exportsField);
    }

    // Subpath exports
    const key = './' + subPath;
    if (key in exportsField) return resolveExportsValue(exportsField[key]);

    // Wildcard patterns: "./*": "./dist/*.js"
    for (const patternKey of Object.keys(exportsField)) {
        if (!patternKey.includes('*')) continue;
        const [pre, post = ''] = patternKey.split('*');
        if (key.startsWith(pre) && key.endsWith(post) && key.length >= pre.length + post.length) {
            const star = key.slice(pre.length, key.length - post.length);
            const target = resolveExportsValue(exportsField[patternKey]);
            if (target) return target.replace('*', star);
        }
    }

    return null;
}

// Resolve a bare specifier ("pkg", "pkg/sub", "@scope/pkg/sub")
// to an absolute file path inside ROOT/node_modules.
function resolveNodeModule(specifier, ROOT) {
    const parts = specifier.split('/');
    const isScoped = parts[0].startsWith('@');
    const pkgName = isScoped ? parts[0] + '/' + parts[1] : parts[0];
    const subPath = isScoped ? parts.slice(2).join('/') : parts.slice(1).join('/');

    const pkgDir = path.join(ROOT, 'node_modules', pkgName);
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return null;

    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    } catch {
        return null;
    }

    // 1. package.json "exports" (modern packages)
    if (pkg.exports) {
        const target = resolveExportsField(pkg.exports, subPath);
        if (target) {
            const resolved = firstExisting([path.join(pkgDir, target)]);
            if (resolved) return resolved;
        }
        // "exports" exists but didn't resolve — fall through only when
        // no subpath was requested, so legacy entry fields can still win.
        if (subPath) return null;
    }

    if (subPath) {
        return firstExisting([
            path.join(pkgDir, subPath),
            path.join(pkgDir, 'dist', subPath),
            path.join(pkgDir, 'src', subPath),
        ]);
    }

    // 2. Legacy entry fields: browser (string) → module → main
    const entries = [];
    if (typeof pkg.browser === 'string') entries.push(pkg.browser);
    if (pkg.module) entries.push(pkg.module);
    if (pkg.main) entries.push(pkg.main);
    entries.push('index.js');

    return firstExisting(entries.map(e => path.join(pkgDir, e)));
}

module.exports = { resolveNodeModule, resolveExportsField };
