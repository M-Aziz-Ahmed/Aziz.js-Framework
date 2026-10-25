// ============================================================
//  Aziz.js — build-time precompiler
//
//  The dev server compiles JSX/TypeScript on demand, which is
//  great while you write and terrible in production: every worker
//  loads @babel/standalone (~64 MB RSS, ~100 ms) and compiles
//  every module it touches (~22 ms/file, ~6.8 s for a 300-page
//  app) before it can answer a request.
//
//  This module moves that work into `npm run build`:
//
//    .aziz/compiled/browser/<rel>.<hash>.js   ESM, JSX stripped,
//                                              local imports point at
//                                              other hashed artifacts
//    .aziz/compiled/server/<rel>.js.cjs       CommonJS for the
//                                              server renderer
//    .aziz/compiled/manifest.json             url ⇄ source map +
//                                              dependency report
//
//  In production the server loads the precompiled CommonJS, so it
//  never needs Babel at all. The browser loads hashed URLs, so
//  assets can be cached forever (immutable).
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { transformJSX, transformCommonJS, rewriteImports, extractImports, hasBabel } = require('./js-transform');

// Directories whose files the browser may import.
const SOURCE_DIRS = ['app', 'components', 'lib', 'models'];

// Extensions we compile.
const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.mts']);

// Extensions tried when an import omits one.
const RESOLVE_EXT = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.mts', '.json'];

const SERVER_MODULE_RE = /\.server\.(?:[cm]?[jt]sx?)$/i;
const USE_SERVER_RE = /^\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]use server['"]/;

function isFile(p) {
    try { return fs.statSync(p).isFile(); } catch { return false; }
}

function hashOf(content) {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);
}

function walk(dir, root, out) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, root, out);
        } else if (entry.isFile()) {
            out.push(path.relative(root, full).replace(/\\/g, '/'));
        }
    }
}

// Files the browser must never receive: API routes, server-only
// modules, and the server hook.
function isServerOnly(rel) {
    if (rel.startsWith('app/api/')) return true;
    if (SERVER_MODULE_RE.test(rel)) return true;
    return false;
}

function collectSources(root) {
    const rels = [];
    for (const dir of SOURCE_DIRS) {
        const full = path.join(root, dir);
        if (!fs.existsSync(full)) continue;
        walk(full, root, rels);
    }
    return rels
        .filter(rel => CODE_EXT.has(path.extname(rel).toLowerCase()))
        .filter(rel => !isServerOnly(rel))
        .sort();
}

// Server-only locations that an import must never pull into the browser
// bundle, even when a page references them (the dev server blocks these
// URLs too).
function isPrivateImport(rel) {
    const parts = rel.split('/');
    if (parts.some(part => part.startsWith('.'))) return true;
    if (parts[0] === 'node_modules' || parts[0] === 'scripts') return true;
    if (parts[0] === 'server' || parts[0] === 'data' || parts[0] === 'api') return true;
    if (rel.startsWith('app/api/')) return true;
    if (rel === 'middleware.js' || rel === 'middleware.ts') return true;
    if (rel === 'aziz.config.js' || rel === 'aziz.config.mjs') return true;
    if (SERVER_MODULE_RE.test(rel)) return true;
    return false;
}

// The default source set only covers app/components/lib/models. Follow
// relative imports from those files so a component living anywhere else
// (shared/, ui/, …) is still compiled for production.
function followImports(root, seeds) {
    const seen = new Set(seeds);
    const queue = [...seeds];
    const previousRoot = ROOT_CACHE;
    ROOT_CACHE = root;

    try {
        while (queue.length > 0) {
            const rel = queue.shift();
            let source;
            try { source = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }

            for (const spec of extractImports(source)) {
                const local = resolveLocal(rel, spec);
                if (!local || seen.has(local)) continue;
                if (!CODE_EXT.has(path.extname(local).toLowerCase())) continue;
                if (isPrivateImport(local)) continue;
                seen.add(local);
                queue.push(local);
            }
        }
    } finally {
        ROOT_CACHE = previousRoot;
    }

    return [...seen].sort();
}

// Resolve an import specifier to a project-relative path, mirroring
// the dev server's rules ("@/x" → root-relative, "./x" → relative).
function resolveLocal(fromRel, spec) {
    let base;
    if (spec.startsWith('@/')) {
        base = spec.slice(2);
    } else if (spec.startsWith('.')) {
        base = path.posix.join(path.posix.dirname(fromRel), spec);
    } else if (spec.startsWith('/')) {
        base = spec.slice(1);
    } else {
        return null; // bare package
    }

    const normalized = path.posix.normalize(base).replace(/^\.\//, '');
    if (!normalized || normalized === '.' || normalized === '..' ||
        normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
        return null;
    }
    for (const ext of RESOLVE_EXT) {
        const candidate = normalized + ext;
        if (isFile(path.join(ROOT_CACHE, candidate))) return candidate;
    }
    for (const ext of ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.mts']) {
        const candidate = path.posix.join(normalized, 'index' + ext);
        if (isFile(path.join(ROOT_CACHE, candidate))) return candidate;
    }
    return null;
}

// ROOT_CACHE is set for the duration of a compile run so the resolver
// above can stat files without threading `root` through every call.
let ROOT_CACHE = '';

function packageNameOf(spec) {
    const parts = spec.split('/');
    return parts[0].startsWith('@') ? parts[0] + '/' + (parts[1] || '') : parts[0];
}

// A package is browser-safe when it ships an ESM/browser entry. A
// CommonJS-only package will throw "require is not defined" in the
// browser — the single most common way a no-bundler app breaks.
function inspectPackage(root, pkgName) {
    const pkgDir = path.join(root, 'node_modules', pkgName);
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return { installed: false };

    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')); } catch { /* keep {} */ }

    const hasEsm = !!(pkg.module || pkg.browser || pkg.exports || pkg.type === 'module');
    return {
        installed: true,
        version: pkg.version || null,
        esm: hasEsm,
        main: pkg.main || 'index.js',
    };
}

// ─── Compile ──────────────────────────────────────────────────

function compileProject(root, options = {}) {
    const started = Date.now();
    const outDir = path.join(root, '.aziz', 'compiled');
    const browserDir = path.join(outDir, 'browser');
    const serverDir = path.join(outDir, 'server');

    ROOT_CACHE = root;
    try {
        if (!hasBabel()) {
            return {
                ok: false,
                reason: '@babel/standalone is not installed — run "npm install" before building.',
            };
        }

        const rels = followImports(root, collectSources(root));
        const entries = rels.map(rel => {
            const abs = path.join(root, rel);
            const source = fs.readFileSync(abs, 'utf8');
            return { rel, abs, source, hash: hashOf(source) };
        });

        // Pass 1 — content hash per file, so an artifact URL changes
        // only when its source changes.
        const byRel = new Map();
        const usedUrls = new Set();
        for (const entry of entries) {
            const dir = path.posix.dirname(entry.rel);
            const base = path.posix.basename(entry.rel).replace(/\.[^.]+$/, '');
            let url = '/_compiled/' + (dir === '.' ? '' : dir + '/') + base + '.' + entry.hash + '.js';
            // Guard against two sources collapsing to one URL.
            if (usedUrls.has(url)) {
                const ext = path.posix.extname(entry.rel).replace('.', '');
                url = '/_compiled/' + (dir === '.' ? '' : dir + '/') + base + '.' + ext + '.' + entry.hash + '.js';
            }
            usedUrls.add(url);
            entry.url = url;
            byRel.set(entry.rel, entry);
        }

        // Pass 2 — compile. Local imports are rewritten to hashed
        // artifact URLs; bare imports keep the /_modules/ convention.
        const bareImports = new Set();
        const files = {};

        for (const entry of entries) {
            const mapper = (spec) => {
                if (spec.startsWith('/_framework/')) return spec;
                if (spec === 'react' || spec === 'react/jsx-runtime' || spec === 'react/jsx-dev-runtime') {
                    return '/_framework/react.js';
                }

                const local = resolveLocal(entry.rel, spec);
                if (local) {
                    const target = byRel.get(local);
                    if (target) return target.url;
                    // Not a module we compile (CSS, images, …). Serve it
                    // from the project root so the hashed URL does not
                    // break the relative path.
                    return '/' + local;
                }

                if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('/')) {
                    // Unresolvable local path — keep it root-absolute.
                    if (spec.startsWith('/')) return spec;
                    if (spec.startsWith('@/')) return '/' + spec.slice(2);
                    return spec;
                }

                bareImports.add(spec);
                return '/_modules/' + spec;
            };

            const browserCode = rewriteImports(transformJSX(entry.source, path.basename(entry.rel)), mapper);

            const browserRel = entry.url.replace(/^\/_compiled\//, '');
            const browserAbs = path.join(browserDir, browserRel);
            fs.mkdirSync(path.dirname(browserAbs), { recursive: true });
            fs.writeFileSync(browserAbs, browserCode);

            // Server artifact: CommonJS so the vm-based renderer can
            // evaluate it without Babel.
            const serverRel = entry.rel + '.cjs';
            const serverAbs = path.join(serverDir, serverRel);
            fs.mkdirSync(path.dirname(serverAbs), { recursive: true });
            const serverCode = transformCommonJS(entry.source, path.basename(entry.rel));
            fs.writeFileSync(serverAbs, serverCode);

            files[entry.rel] = {
                url: entry.url,
                hash: entry.hash,
                browser: browserRel,
                server: serverRel,
                serverModule: SERVER_MODULE_RE.test(entry.rel) ||
                    USE_SERVER_RE.test(entry.source),
            };
        }

        // ─── Dependency report ────────────────────────────────
        // No bundler means a package that is not browser-ready breaks
        // at runtime with a confusing error. Catch it at build time.
        const packages = new Set([...bareImports].map(packageNameOf));
        const deps = { packages: [], missing: [], commonjsOnly: [] };
        for (const pkgName of [...packages].sort()) {
            const info = inspectPackage(root, pkgName);
            if (!info.installed) {
                deps.missing.push(pkgName);
                continue;
            }
            deps.packages.push({ name: pkgName, version: info.version, esm: info.esm });
            if (!info.esm) deps.commonjsOnly.push(pkgName);
        }

        const manifest = {
            version: 1,
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - started,
            files,
            deps,
        };

        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

        return { ok: true, manifest, outDir, browserDir, serverDir };
    } finally {
        ROOT_CACHE = '';
    }
}

// ─── Read a previously written manifest ───────────────────────

function readManifest(root) {
    const file = path.join(root, '.aziz', 'compiled', 'manifest.json');
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Map an absolute source path to its precompiled server artifact.
function serverArtifactMap(root, manifest) {
    const map = new Map();
    if (!manifest || !manifest.files) return map;
    const serverDir = path.join(root, '.aziz', 'compiled', 'server');
    for (const [rel, info] of Object.entries(manifest.files)) {
        map.set(path.resolve(root, rel), {
            file: path.join(serverDir, info.server),
            serverModule: !!info.serverModule,
            hash: info.hash,
        });
    }
    return map;
}

// Map a project-relative source path to its hashed browser URL.
function browserUrlMap(manifest) {
    const map = new Map();
    if (!manifest || !manifest.files) return map;
    for (const [rel, info] of Object.entries(manifest.files)) {
        map.set(rel, info.url);
    }
    return map;
}

// Map a hashed browser URL to the artifact on disk. Serving goes
// through this map only, so a crafted path can never escape the
// compiled directory — and only files the build declared are reachable.
function browserAssetMap(manifest) {
    const map = new Map();
    if (!manifest || !manifest.files) return map;
    for (const info of Object.values(manifest.files)) {
        map.set(info.url, info.browser);
    }
    return map;
}

module.exports = {
    compileProject,
    readManifest,
    serverArtifactMap,
    browserUrlMap,
    browserAssetMap,
    collectSources,
    followImports,
    inspectPackage,
    packageNameOf,
    SOURCE_DIRS,
};
