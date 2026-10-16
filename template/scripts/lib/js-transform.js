// ============================================================
//  Aziz.js — JS/JSX transform pipeline (server-side)
//  - JSX → h() calls via @babel/standalone
//  - Bare / @/ import rewriting to browser-servable URLs
//  - mtime-based transform cache (big dev-server speed win)
// ============================================================

const path = require('path');
const fs = require('fs');

// ─── Babel loading (with fallback resolution for monorepos/tests) ───
let Babel = null;
try {
    Babel = require('@babel/standalone');
} catch (e) {
    const fallbacks = [
        path.join(__dirname, '..', '..', 'node_modules', '@babel', 'standalone'),
        path.join(process.cwd(), 'node_modules', '@babel', 'standalone'),
    ];
    for (const fb of fallbacks) {
        try { Babel = require(fb); break; } catch { /* keep looking */ }
    }
}

function hasBabel() {
    return !!Babel;
}

// ─── JSX transform ───────────────────────────────────────────

function isFrameworkPath(filePath) {
    return filePath.includes('/_framework/') || filePath.includes('\\_framework\\');
}

function transformJSX(code, filename) {
    if (!Babel) return code;
    const result = Babel.transform(code, {
        filename,
        presets: [
            ['react', { pragma: 'h', pragmaFrag: 'Fragment' }]
        ],
        plugins: [],
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

function rewriteImports(code) {
    const isCode = codePositions(code);

    // from 'specifier'  (covers `import ... from`, `export ... from`)
    code = code.replace(/(\bfrom\s*)(['"])([^'"\n]+)\2/g, (m, from, q, spec, offset) => {
        if (!isCode[offset]) return m;
        const mapped = mapSpecifier(spec);
        return mapped === spec ? m : `${from}${q}${mapped}${q}`;
    });

    // side-effect imports: import 'specifier';
    // (requires the quote right after `import`, so `import(` is not matched)
    code = code.replace(/(\bimport\s+)(['"])([^'"\n]+)\2/g, (m, kw, q, spec, offset) => {
        if (!isCode[offset]) return m;
        const mapped = mapSpecifier(spec);
        return mapped === spec ? m : `${kw}${q}${mapped}${q}`;
    });

    // dynamic imports: import('specifier')
    code = code.replace(/(\bimport\s*\(\s*)(['"])([^'"\n]+)\2(\s*\))/g, (m, pre, q, spec, post, offset) => {
        if (!isCode[offset]) return m;
        const mapped = mapSpecifier(spec);
        return mapped === spec ? m : `${pre}${q}${mapped}${q}${post}`;
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
        console.error(`❌ JSX transform error in ${filePath}:`, err.message);
        out = `throw new Error(${JSON.stringify('JSX transform error in ' + filePath + ': ' + err.message)});`;
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
    transformJSX,
    rewriteImports,
    transformModule,
    invalidate,
    clearCache,
    cacheSize,
    isFrameworkPath,
};
