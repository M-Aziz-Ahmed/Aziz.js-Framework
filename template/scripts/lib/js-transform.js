// ============================================================
//  Aziz.js — JS/JSX transform pipeline (server-side)
//  - JSX → h() calls via @babel/standalone
//  - Bare / @/ import rewriting to browser-servable URLs
//  - mtime-based transform cache (big dev-server speed win)
// ============================================================

const path = require('path');
const fs = require('fs');

// ─── Babel loading (lazy) ─────────────────────────────────────
//
// Babel is ~3 MB of parser and ~64 MB of resident memory once
// evaluated. A production server that loads precompiled modules
// never needs it, so it is resolved on first use instead of at
// import time. require.resolve() (no evaluation) is used to answer
// "is it installed?" without paying that cost.

let Babel = null;
let babelTried = false;

function babelCandidates() {
    const candidates = [
        path.join(__dirname, '..', '..', 'node_modules', '@babel', 'standalone'),
        path.join(process.cwd(), 'node_modules', '@babel', 'standalone'),
    ];

    // The framework repo itself: template/ has no node_modules of its own
    // in CI, so the repo root is the fallback — but only when that really
    // is the framework repo, never for a user's app.
    const repoRoot = path.join(__dirname, '..', '..', '..');
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
        if (pkg.name === 'create-aziz-app') {
            candidates.push(path.join(repoRoot, 'node_modules', '@babel', 'standalone'));
        }
    } catch { /* not the framework repo */ }

    return candidates;
}

function loadBabel() {
    if (Babel || babelTried) return Babel;
    babelTried = true;
    try {
        Babel = require('@babel/standalone');
    } catch (e) {
        for (const fb of babelCandidates()) {
            try { Babel = require(fb); break; } catch { /* keep looking */ }
        }
    }
    return Babel;
}

// True when Babel can be used (loads it).
function hasBabel() {
    return !!loadBabel();
}

// True when Babel is installed — without evaluating it.
function hasBabelAvailable() {
    if (Babel) return true;
    try {
        require.resolve('@babel/standalone');
        return true;
    } catch {
        return babelCandidates().some(dir => {
            try { require.resolve(dir); return true; } catch { return false; }
        });
    }
}

// Thrown whenever a module needs compiling but Babel is unavailable.
// Never fall back to the untransformed source: the browser cannot execute
// JSX, the module import rejects, and the router silently renders its
// built-in 404 — a missing dependency disguised as a routing bug.
const BABEL_MISSING_MESSAGE =
    '@babel/standalone is not installed, so JSX cannot be compiled. ' +
    'Run "npm install" in the project folder, then restart the dev server.';

// ─── JSX transform ───────────────────────────────────────────

function isFrameworkPath(filePath) {
    return filePath.includes('/_framework/') || filePath.includes('\\_framework\\');
}

function presetsFor(filename) {
    const presets = [];
    const lower = String(filename).toLowerCase();

    // TypeScript: strip types before JSX so `<Foo<T> />` and generics in
    // expressions parse. isTSX must match the real extension.
    if (/\.tsx?$/.test(lower) || /\.mtsx?$/.test(lower)) {
        presets.push(['typescript', { isTSX: lower.endsWith('tsx'), allExtensions: true }]);
    }

    // runtime: 'classic' is required. Babel 8 defaults to the automatic
    // runtime, which rejects an explicit pragma ("pragma and pragmaFrag
    // cannot be set when runtime is automatic"). We compile to the
    // global `h`/`Fragment` that boot.js installs, not to jsx-runtime.
    presets.push(['react', { runtime: 'classic', pragma: 'h', pragmaFrag: 'Fragment' }]);
    return presets;
}

function transformJSX(code, filename) {
    const babel = loadBabel();
    if (!babel) throw new Error(BABEL_MISSING_MESSAGE);

    const result = babel.transform(code, {
        filename,
        presets: presetsFor(filename),
        plugins: [],
        sourceType: 'module',
    });
    return result.code;
}

// Compile an ES module to CommonJS for the server renderer / edge runtime.
function transformCommonJS(code, filename) {
    const babel = loadBabel();
    if (!babel) throw new Error(BABEL_MISSING_MESSAGE);

    const result = babel.transform(code, {
        filename,
        presets: presetsFor(filename),
        plugins: ['transform-modules-commonjs'],
        sourceType: 'module',
    });
    return result.code;
}

// ─── Import rewriting ─────────────────────────────────────────
//  import X from 'mongoose'      → '/_modules/mongoose'
//  import X from '@/lib/db'      → '/lib/db'
//  import X from '/absolute.js'  → unchanged
//  import('pkg')                 → import('/_modules/pkg')
//
// Runs on the whole module (not line-by-line) so multi-line
// import statements are handled correctly.
//
// Only keywords sitting in CODE position are rewritten. A `from`
// or `import` inside a string literal / template literal / comment
// is prose (e.g. documentation text in JSX) and must be left alone
// — rewriting it corrupts the module and the page fails to load.

// Uint8Array marking every character that is in code position
// (outside string literals, template literals and comments).
function codePositions(code) {
    const n = code.length;
    const isCode = new Uint8Array(n);
    const stack = [];          // '{' for blocks, 'tpl' for ${ … } in templates
    let mode = 'code';         // code | ' | " | ` | // | /*
    let i = 0;

    while (i < n) {
        const c = code[i];

        if (mode === 'code') {
            isCode[i] = 1;
            if (c === '\\') { i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') mode = c;
            else if (c === '/' && code[i + 1] === '/') mode = '//';
            else if (c === '/' && code[i + 1] === '*') mode = '/*';
            else if (c === '{') stack.push('{');
            else if (c === '}') { if (stack.pop() === 'tpl') mode = '`'; }
            i++;
        } else if (mode === "'" || mode === '"' || mode === '`') {
            if (c === '\\') { i += 2; continue; }
            if (c === mode) mode = 'code';
            else if (mode === '`' && c === '$' && code[i + 1] === '{') {
                stack.push('tpl');
                mode = 'code';
                isCode[i] = 1;
                isCode[i + 1] = 1;
                i += 2;
                continue;
            }
            i++;
        } else if (mode === '//') {
            if (c === '\n') mode = 'code';
            i++;
        } else { // block comment
            if (c === '*' && code[i + 1] === '/') { mode = 'code'; i += 2; continue; }
            i++;
        }
    }
    return isCode;
}

function isRelativeOrAbsolute(spec) {
    return spec.startsWith('/') ||
           spec.startsWith('./') ||
           spec.startsWith('../') ||
           spec.startsWith('#') ||
           spec.startsWith('node:') ||
           spec.startsWith('data:') ||
           spec.startsWith('file:') ||
           /^https?:\/\//.test(spec);
}

function mapSpecifier(spec) {
    if (isRelativeOrAbsolute(spec)) return spec;
    if (spec.startsWith('@/')) return '/' + spec.slice(2);
    return '/_modules/' + spec;
}

// `mapper` lets the build step point local imports at content-hashed
// artifacts instead of their source paths. Returning null/undefined from
// the mapper leaves the specifier untouched.
function rewriteImports(code, mapper) {
    const isCode = codePositions(code);
    const map = typeof mapper === 'function' ? mapper : mapSpecifier;

    // from 'specifier'  (covers `import ... from`, `export ... from`)
    code = code.replace(/(\bfrom\s*)(['"])([^'"\n]+)\2/g, (m, from, q, spec, offset) => {
        if (!isCode[offset]) return m;
        const mapped = map(spec);
        return !mapped || mapped === spec ? m : `${from}${q}${mapped}${q}`;
    });

    // side-effect imports: import 'specifier';
    // (requires the quote right after `import`, so `import(` is not matched)
    code = code.replace(/(\bimport\s+)(['"])([^'"\n]+)\2/g, (m, kw, q, spec, offset) => {
        if (!isCode[offset]) return m;
        const mapped = map(spec);
        return !mapped || mapped === spec ? m : `${kw}${q}${mapped}${q}`;
    });

    // dynamic imports: import('specifier')
    code = code.replace(/(\bimport\s*\(\s*)(['"])([^'"\n]+)\2(\s*\))/g, (m, pre, q, spec, post, offset) => {
        if (!isCode[offset]) return m;
        const mapped = map(spec);
        return !mapped || mapped === spec ? m : `${pre}${q}${mapped}${q}${post}`;
    });

    return code;
}

// ─── mtime-keyed transform cache ─────────────────────────────

const cache = new Map(); // filePath → { mtimeMs, code }

function transformModule(code, filePath, mtimeMs) {
    // Framework internals contain no JSX and only use absolute imports.
    if (isFrameworkPath(filePath)) return code;

    const hit = cache.get(filePath);
    if (hit && hit.mtimeMs === mtimeMs) return hit.code;

    let out;
    try {
        out = transformJSX(code, path.basename(filePath));
    } catch (err) {
        if (err.message === BABEL_MISSING_MESSAGE) {
            // Startup prints an actionable banner — don't repeat it for every file.
            out = `throw new Error(${JSON.stringify(BABEL_MISSING_MESSAGE)});`;
        } else {
            console.error(`❌ JSX transform error in ${filePath}:`, err.message);
            out = `throw new Error(${JSON.stringify('JSX transform error in ' + filePath + ': ' + err.message)});`;
        }
    }
    out = rewriteImports(out);
    cache.set(filePath, { mtimeMs, code: out });
    return out;
}

function invalidate(filePath) {
    cache.delete(filePath);
}

function clearCache() {
    cache.clear();
}

function cacheSize() {
    return cache.size;
}

module.exports = {
    hasBabel,
    hasBabelAvailable,
    loadBabel,
    BABEL_MISSING_MESSAGE,
    transformJSX,
    transformCommonJS,
    rewriteImports,
    mapSpecifier,
    isRelativeOrAbsolute,
    transformModule,
    invalidate,
    clearCache,
    cacheSize,
    isFrameworkPath,
};
