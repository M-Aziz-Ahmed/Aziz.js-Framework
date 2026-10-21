#!/usr/bin/env node

// ============================================================
//  Aziz.js Dev Server
//  - Serves the app with server-side JSX transform (cached)
//  - API routes: api/** and app/api/**/route.js
//  - node_modules bare-import resolution (/_modules/…)
//  - WebSocket live reload (development only)
//  - Production mode: node scripts/dev-server.js --production
// ============================================================

const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const crypto = require('crypto');

const { hasBabelAvailable, transformModule, invalidate: invalidateTransform } = require('./lib/js-transform');
const { resolveNodeModule } = require('./lib/module-resolver');
const apiRouter = require('./lib/api-router');
const { buildRouteManifest, buildServerRoutes } = require('./lib/route-manifest');
const pageRouter = require('./lib/page-router');
const { ServerModuleLoader } = require('./lib/module-loader');
const renderer = require('./lib/renderer');
const staticStore = require('./lib/static-store');
const imageOptimizer = require('./lib/image-optimizer');
const fontOptimizer = require('./lib/font-optimizer');
const tailwind = require('./lib/tailwind');
const precompile = require('./lib/precompile');
const compression = require('./lib/compression');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const ROOT = process.cwd();
const PRODUCTION = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const TAILWIND = tailwind.isEnabled(ROOT);

// ─── Production build output ─────────────────────────────────
//
// `npm run build` precompiles every module to .aziz/compiled. When
// that output exists the production server reads it instead of
// invoking Babel, and the browser imports content-hashed URLs that
// can be cached forever.
const COMPILE_MANIFEST = PRODUCTION ? precompile.readManifest(ROOT) : null;
const COMPILED_URLS = precompile.browserUrlMap(COMPILE_MANIFEST);
const COMPILED_ASSETS = precompile.browserAssetMap(COMPILE_MANIFEST);
const PRECOMPILED_SERVER = precompile.serverArtifactMap(ROOT, COMPILE_MANIFEST);

if (TAILWIND && process.env.AZIZ_SKIP_CSS !== '1') {
    const css = tailwind.build(ROOT, { minify: PRODUCTION });
    if (css.ok) {
        console.log('🎨 Tailwind CSS compiled');
    } else {
        console.warn(`⚠️  Tailwind CSS failed: ${css.reason}`);
    }
}

const clients = new Set();
let apiRoutes = [];

// ─── Files that must never reach the browser ───────────────────
//
// Aziz.js has no bundler, so every importable module is served straight
// from disk. That is what makes `import User from '@/models/User'` work —
// but it also means anything on disk is one HTTP request away, including
// .env secrets. These rules are the boundary between "code the browser
// may import" and "everything else".

const BLOCKED_FILES = new Set([
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lockb',
    'tsconfig.json',
    'jsconfig.json',
    // Middleware runs server-side and routinely holds JWT secrets and auth
    // logic. It is a hook, never an importable browser module.
    'middleware.js',
    'middleware.mjs',
    'middleware.cjs',
    'middleware.ts',
]);

// Directories that only ever hold server-side code or data.
const BLOCKED_DIRS = new Set([
    'node_modules',   // reachable via /_modules/<pkg> instead
    'server',         // convention: server-only modules
    'data',           // convention: flat-file persistence (sessions, users)
]);

// scripts/ holds the dev server itself, but index.html needs one file from it.
const ALLOWED_SCRIPT_FILES = new Set(['live-reload-client.js']);

// Explicit server-only modules: anything named *.server.{js,mjs,jsx}
const SERVER_MODULE_RE = /\.server\.(m?js|jsx)$/;

function forbiddenReason(urlPath) {
    const parts = urlPath.split('/').filter(Boolean);
    if (parts.length === 0) return null;

    // Any dotfile or dot-directory: .env, .env.local, .git/config, .npmrc …
    if (parts.some(p => p.startsWith('.'))) return 'dotfile';

    const file = parts[parts.length - 1];

    if (BLOCKED_FILES.has(file)) return 'project metadata or server hook';

    if (parts[0] === 'scripts') {
        return ALLOWED_SCRIPT_FILES.has(file) ? null : 'dev-server internals';
    }

    // app/api/** is served by the API router under /api/**. The source files
    // themselves are server-only and must never be fetched as modules.
    if (parts[0] === 'app' && parts[1] === 'api') return 'server-only API route';

    if (parts.some(p => BLOCKED_DIRS.has(p))) return 'server-only directory';
    if (SERVER_MODULE_RE.test(file)) return 'server-only module';

    return null;
}

function box(lines) {
    const width = Math.max(...lines.map(l => l.length)) + 2;
    const bar = '─'.repeat(width + 2);
    return [
        '',
        '┌' + bar + '┐',
        ...lines.map(l => '│ ' + l.padEnd(width) + ' │'),
        '└' + bar + '┘',
        ''
    ].join('\n');
}

// Babel is only needed when something must be compiled at runtime. A
// production server running precompiled modules never loads it.
if (!hasBabelAvailable() && !(PRODUCTION && COMPILE_MANIFEST)) {
    console.log(box([
        '@babel/standalone is NOT installed — JSX cannot be compiled.',
        '',
        'Every page and layout will fail to load in the browser, so the',
        'router falls back to its built-in 404 page. This looks like a',
        'routing bug, but it is a missing dependency.',
        '',
        `Fix:  ${fs.existsSync(path.join(ROOT, 'node_modules')) ? 'npm install --save-dev @babel/standalone' : 'npm install'}`,
        `      in ${ROOT}`,
        '',
        'Then restart the dev server.',
    ]));
}

if (!imageOptimizer.hasSharp()) {
    console.log('🖼️  sharp is unavailable — <Image> still caches and lazy-loads, but will not resize.');
    console.log('    Fix: npm install sharp (it ships as an optional dependency)\n');
}

if (PRODUCTION) {
    if (COMPILE_MANIFEST) {
        const count = Object.keys(COMPILE_MANIFEST.files || {}).length;
        console.log(`⚡ Precompiled build loaded — ${count} module(s), no Babel in the request path.`);
    } else {
        console.log('⚠️  No build output found (.aziz/compiled). Run "npm run build" to precompile.');
        console.log('    Falling back to on-the-fly compilation (slower cold start).\n');
    }
}

console.log(`🚀 Aziz.js dev server starting${PRODUCTION ? ' (production mode)' : ''}...\n`);

// ─── Route Manifest ──────────────────────────────────────────
// Scans app/ and builds the page/layout/not-found/loading/error list for the
// client router.

// ─── Page routes / SSR state ─────────────────────────────────

let pageLoader = new ServerModuleLoader(ROOT, { precompiled: PRECOMPILED_SERVER });
let serverRoutes = { pages: {}, layouts: [], i18n: null, notFoundFile: null };
const isrInFlight = new Map();

async function reloadPageRoutes(verbose = true) {
    serverRoutes = buildServerRoutes(ROOT, { compiled: COMPILED_URLS });
    pageLoader.clear();
    if (verbose) {
        const count = Object.keys(serverRoutes.pages).length;
        console.log(`📄 ${count} page route(s)${serverRoutes.i18n ? ` · i18n: ${serverRoutes.i18n.locales.join(', ')}` : ''}`);
    }
    return serverRoutes;
}

// ─── API routes ──────────────────────────────────────────────

async function reloadApiRoutes(verbose = true) {
    apiRouter.purgeProjectRequireCache(ROOT);
    const { routes } = await apiRouter.loadApiRoutes(ROOT, { verbose });
    apiRoutes = routes;
}

// ─── HTTP Server ─────────────────────────────────────────────

// ─── Middleware ──────────────────────────────────────────────
//
// Next-parity: an optional root-level middleware.{js,mjs,ts} runs before
// page routes and API routes. It can rewrite, redirect, short-circuit with a
// response, or add response headers — the common cases being auth guards and
// locale prefixes.
//
// export default function middleware(request) {
//     if (!request.cookies.token && !isPublic(request.pathname)) {
//         return NextResponse.redirect(new URL('/login', request.url));
//     }
//     return NextResponse.next();
// }

const MIDDLEWARE_NAMES = ['middleware.js', 'middleware.mjs', 'middleware.cjs', 'middleware.ts'];

let middlewareFn = null;
let middlewareConfig = { matcher: null };

function findMiddlewareFile() {
    for (const name of MIDDLEWARE_NAMES) {
        const p = path.join(ROOT, name);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

async function loadMiddleware() {
    const file = findMiddlewareFile();
    if (!file) return null;
    try {
        apiRouter.purgeProjectRequireCache(ROOT);
        const mod = require(file);
        const fn = typeof mod === 'function' ? mod : (mod.default || mod.middleware);
        if (typeof fn !== 'function') {
            console.warn(`⚠️  ${path.basename(file)} does not export a function — ignoring.`);
            return null;
        }
        middlewareConfig = (mod.config && mod.config.matcher) || null;
        return fn;
    } catch (err) {
        console.warn(`⚠️  Failed to load middleware: ${err.message}`);
        return null;
    }
}

function middlewareMatches(pathname) {
    const m = middlewareConfig;
    if (!m) return true;
    const list = Array.isArray(m) ? m : [m];
    return list.some(entry => {
        if (!entry || !entry.source) return true;
        try {
            return new RegExp('^' + entry.source).test(pathname);
        } catch {
            return true;
        }
    });
}

function parseRequestCookies(header) {
    const out = {};
    if (!header) return out;
    for (const part of String(header).split(';')) {
        const i = part.indexOf('=');
        if (i === -1) continue;
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

// NextResponse.headers is a Map with case-sensitive keys, while the DOM
// Headers object is case-insensitive — so look the name up defensively.
function headerValue(headers, name) {
    if (!headers) return undefined;
    const lower = name.toLowerCase();
    if (typeof headers.entries === 'function') {
        for (const [k, v] of headers.entries()) {
            if (String(k).toLowerCase() === lower) return v;
        }
        return undefined;
    }
    for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === lower) return v;
    }
    return undefined;
}

function sendMiddlewareResponse(res, result, method) {
    const headers = {};
    const raw = result.headers;
    if (raw) {
        const entries = typeof raw.forEach === 'function' && typeof raw.get === 'function'
            ? [...raw.entries()]
            : Object.entries(raw);
        for (const [k, v] of entries) headers[k] = v;
    }
    if (!headers['Content-Type'] && typeof result.body === 'string') {
        headers['Content-Type'] = 'application/json; charset=utf-8';
    }
    res.writeHead(result.status || 200, headers);
    res.end(method === 'HEAD' ? undefined : result.body ?? '');
}

// ─── Page rendering (SSR / SSG / ISR / streaming) ────────────

function looksLikeBrowserModule(urlPath) {
    let decoded;
    try { decoded = decodeURIComponent(urlPath); } catch { return false; }
    const base = path.join(ROOT, decoded);
    const root = path.resolve(ROOT);
    if (!path.resolve(base).startsWith(root + path.sep) && path.resolve(base) !== root) return false;
    if (fs.existsSync(base) && fs.statSync(base).isFile()) return true;
    for (const ext of ['.js', '.jsx', '.ts', '.tsx', '.mjs']) {
        if (fs.existsSync(base + ext)) return true;
        if (fs.existsSync(path.join(base, 'index' + ext))) return true;
    }
    return false;
}

function getCookie(header, name) {
    if (!header) return null;
    for (const part of String(header).split(';')) {
        const i = part.indexOf('=');
        if (i === -1) continue;
        if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return null;
}

function pageCacheHeaders(dynamic, revalidate) {
    if (!PRODUCTION) return NO_CACHE;
    if (dynamic === 'force-dynamic') return { 'Cache-Control': 'no-store' };
    if (revalidate) {
        return { 'Cache-Control': `public, max-age=0, s-maxage=${revalidate}, stale-while-revalidate=${revalidate}` };
    }
    return { 'Cache-Control': 'public, max-age=0, must-revalidate' };
}

// ─── Response helpers ─────────────────────────────────────────

// Security headers applied to every production response. Cheap, and
// they close the obvious holes (MIME sniffing, clickjacking, referrer
// leaking).
const SECURITY_HEADERS = PRODUCTION ? {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
} : {};

function sendHtml(req, res, html, status = 200, extraHeaders = {}) {
    const body = Buffer.from(String(html));
    const headers = {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Aziz-Render': 'server',
        ...SECURITY_HEADERS,
        ...extraHeaders,
    };

    const compressed = compression.compress(req, body, headers['Content-Type']);
    if (compressed) {
        res.writeHead(status, {
            ...headers,
            ...compressed.headers,
            'Content-Length': compressed.body.length,
        });
        res.end(req.method === 'HEAD' ? undefined : compressed.body);
        return;
    }

    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : html);
}

// Sends a buffer with compression when it helps.
function sendBuffer(req, res, buffer, headers, status = 200) {
    const compressed = compression.compress(req, buffer, headers['Content-Type']);
    if (compressed) {
        res.writeHead(status, {
            ...headers,
            ...compressed.headers,
            'Content-Length': compressed.body.length,
        });
        res.end(req.method === 'HEAD' ? undefined : compressed.body);
        return;
    }
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : buffer);
}

function notFoundInfo(pathname) {
    const layouts = pageRouter.collectLayouts(serverRoutes.layouts, pathname).map(l => l.file);
    return {
        pageFile: serverRoutes.notFoundFile || null,
        layoutFiles: layouts,
        loadingFile: null,
        errorFile: null,
        notFoundFile: serverRoutes.notFoundFile || null,
    };
}

function resolvePage(primaryPathname, fallbackPathname) {
    let match = pageRouter.resolveRoute(serverRoutes.pages, primaryPathname);
    if (!match && fallbackPathname && fallbackPathname !== primaryPathname) {
        match = pageRouter.resolveRoute(serverRoutes.pages, fallbackPathname);
    }
    return {
        match,
        info: match ? match.value : notFoundInfo(primaryPathname),
        params: match ? match.params : {},
        found: !!match,
    };
}

async function renderDocument({ req, info, pathname, params, locale, indexHtml, seedData }) {
    const origin = `http://127.0.0.1:${server.address()?.port || PORT}`;
    const indexText = indexHtml || fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    return renderer.renderPage({
        loader: pageLoader,
        pageFile: info.pageFile,
        layoutFiles: info.layoutFiles || [],
        loadingFile: info.loadingFile || null,
        errorFile: info.errorFile || null,
        notFoundFile: info.notFoundFile || null,
        pathname,
        params,
        searchParams: new URL(req.url, origin).searchParams,
        locale,
        i18n: serverRoutes.i18n,
        origin,
        requestHeaders: req.headers,
        streaming: process.env.AZIZ_STREAMING !== '0',
        data: seedData || {},
        indexHtml: indexText,
        headLinks: fontOptimizer.collectFontPreloads(ROOT),
    });
}

function safeScriptJSON(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

function streamReplacementScript(html) {
    return `<script>(function(){var html=${safeScriptJSON(String(html))};` +
        `if(window.__azizStreamReplace){window.__azizStreamReplace(html);}` +
        `else{(window.__azizStreamQueue=window.__azizStreamQueue||[]).push(html);}})();</script>`;
}

function streamDataScript(serialized) {
    return `<script>(function(){window.__AZIZ_SSR__=window.__AZIZ_SSR__||{};` +
        `window.__AZIZ_SSR__.data=${safeScriptJSON(serialized.data || {})};` +
        `window.__AZIZ_SSR__.serialized=${safeScriptJSON(serialized)};})();</script>`;
}

async function servePage(req, res, url, rawPath) {
    const requestPath = pageRouter.normalizePath(rawPath);
    let pathname = requestPath;
    let locale = null;
    const i18n = serverRoutes.i18n;

    if (i18n) {
        const redirectTo = pageRouter.localeRedirect(
            pathname,
            i18n,
            req.headers['accept-language'],
            getCookie(req.headers.cookie, i18n.cookie)
        );
        if (redirectTo && req.method !== 'HEAD') {
            res.writeHead(307, { Location: redirectTo, Vary: 'Accept-Language, Cookie', ...NO_CACHE });
            res.end();
            return;
        }
        const detected = pageRouter.detectLocale(pathname, i18n);
        pathname = detected.pathname;
        locale = detected.locale;
    }

    // Pre-rendered documents win in production, including ISR entries.
    if (PRODUCTION) {
        const staticEntry = await staticStore.readStatic(ROOT, requestPath);
        const info = resolvePage(requestPath, pathname);
        const mod = info.info.pageFile ? safeLoadPage(info.info.pageFile) : null;
        const revalidate = mod && Number(mod.revalidate);

        // A regenerated ISR entry is newer than the build-time document.
        const isrEntry = await staticStore.readISR(ROOT, requestPath);
        if (isrEntry && (!staticEntry || isrEntry.at > (staticEntry.meta.generatedAt || 0))) {
            sendHtml(req, res, isrEntry.html, isrEntry.status || 200, {
                ...pageCacheHeaders('auto', isrEntry.revalidate),
                'X-Aziz-Render': 'isr',
            });
            if (isrEntry.revalidate && Date.now() - isrEntry.at > isrEntry.revalidate * 1000) {
                regenerateISR(req, requestPath, pathname, info, locale, isrEntry.revalidate);
            }
            return;
        }

        if (staticEntry) {
            sendHtml(req, res, staticEntry.html, staticEntry.meta.status || 200, {
                ...pageCacheHeaders(mod && mod.dynamic, revalidate),
                'X-Aziz-Render': 'static',
            });
            if (revalidate && Date.now() - (staticEntry.meta.generatedAt || 0) > revalidate * 1000) {
                regenerateISR(req, requestPath, pathname, info, locale, revalidate);
            }
            return;
        }

        if (isrEntry) {
            sendHtml(req, res, isrEntry.html, isrEntry.status || 200, {
                ...pageCacheHeaders('auto', isrEntry.revalidate),
                'X-Aziz-Render': 'isr',
            });
            if (isrEntry.revalidate && Date.now() - isrEntry.at > isrEntry.revalidate * 1000) {
                regenerateISR(req, requestPath, pathname, info, locale, isrEntry.revalidate);
            }
            return;
        }
    }

    const resolved = resolvePage(requestPath, pathname);
    const status = resolved.found ? 200 : 404;

    let result;
    try {
        result = await renderDocument({
            req,
            info: resolved.info,
            pathname: requestPath,
            params: resolved.params,
            locale,
            indexHtml: null,
        });
    } catch (err) {
        console.error('❌ SSR error:', err);
        sendHtml(req, res, `<!doctype html><html><body><h1>500 — Server render failed</h1><pre>${renderer.escapeHtml(err.message)}</pre></body></html>`, 500, NO_CACHE);
        return;
    }

    if (result && result.redirect) {
        res.writeHead(result.status || 307, { Location: result.redirect, ...NO_CACHE });
        res.end();
        return;
    }

    const finalStatus = result.status && result.status !== 200 ? result.status : status;
    const docResult = { ...result, status: finalStatus };
    const lang = locale || 'en';

    if (result.done) {
        const shellDoc = renderer.buildPageHTML(
            fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
            docResult,
            { lang }
        );
        res.writeHead(finalStatus, {
            'Content-Type': 'text/html; charset=utf-8',
            ...pageCacheHeaders('auto', null),
            'X-Aziz-Render': 'stream',
            'X-Accel-Buffering': 'no',
        });
        if (req.method === 'HEAD') { res.end(); return; }
        res.write(shellDoc);

        try {
            const final = await result.done;
            if (result.mode === 'shell') {
                res.write(streamReplacementScript(final.html || ''));
            }
            if (final.serialized) res.write(streamDataScript(final.serialized));
            for (const chunk of final.chunks || []) res.write(chunk);
        } catch (err) {
            res.write(streamReplacementScript(`<h1>500 — ${renderer.escapeHtml(err.message)}</h1>`));
        }
        res.end();
        return;
    }

    const doc = renderer.buildPageHTML(
        fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
        docResult,
        { lang }
    );

    // ISR: pages that opt in are cached after the first render.
    const pageMod = resolved.info.pageFile ? safeLoadPage(resolved.info.pageFile) : null;
    const revalidate = pageMod && Number(pageMod.revalidate);
    if (PRODUCTION && resolved.found && revalidate > 0) {
        await staticStore.writeISR(ROOT, requestPath, {
            html: doc,
            status: finalStatus,
            revalidate,
        });
    }

    sendHtml(req, res, doc, finalStatus, pageCacheHeaders(pageMod && pageMod.dynamic, revalidate));
}

function safeLoadPage(file) {
    try { return pageLoader.load(file); } catch (err) {
        console.warn(`⚠️  Failed to load ${path.relative(ROOT, file)}: ${err.message}`);
        return null;
    }
}

function regenerateISR(req, storePath, pathname, info, locale, revalidate) {
    if (isrInFlight.has(storePath)) return isrInFlight.get(storePath);

    // Cross-process lock: with several instances sharing a cache
    // volume, only one regenerates the stale page. The others keep
    // serving the stale copy until the new one lands.
    const release = staticStore.acquireLock(ROOT, storePath);
    if (!release) return null;

    const job = (async () => {
        try {
            const result = await renderDocument({
                req,
                info: info.info,
                pathname: storePath,
                params: info.params,
                locale,
                indexHtml: null,
            });
            if (result && result.redirect) return;
            const final = result.done ? await result.done : result;
            const doc = renderer.buildPageHTML(
                fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
                { ...result, ...final, done: undefined, shell: undefined },
                { lang: locale || 'en' }
            );
            await staticStore.writeISR(ROOT, storePath, {
                html: doc,
                status: final.status || 200,
                revalidate,
            });
        } catch (err) {
            console.warn(`⚠️  ISR regeneration failed for ${storePath}: ${err.message}`);
        } finally {
            isrInFlight.delete(storePath);
            release();
        }
    })();
    isrInFlight.set(storePath, job);
    return job;
}

// ─── HTTP Server ─────────────────────────────────────────────

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.jsx':  'text/javascript; charset=utf-8',
    '.mjs':  'text/javascript; charset=utf-8',
    '.ts':   'text/javascript; charset=utf-8',
    '.tsx':  'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
    '.map':  'application/json',
    '.txt':  'text/plain; charset=utf-8',
};

const IMMUTABLE_EXTS = new Set(['.woff', '.woff2', '.ttf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico']);

const NO_CACHE = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
};

function cacheHeadersFor(fileExt, isHtml) {
    if (!PRODUCTION) return NO_CACHE;
    if (isHtml || fileExt === '.json') {
        return { 'Cache-Control': 'no-cache, must-revalidate' };
    }
    if (IMMUTABLE_EXTS.has(fileExt)) {
        return { 'Cache-Control': 'public, max-age=86400, immutable' };
    }
    return { 'Cache-Control': 'no-cache, must-revalidate' };
}

function etagFor(stat) {
    return `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
}

const server = http.createServer(async (req, res) => {
    const rawUrl = req.url;
    const urlWithoutQuery = rawUrl.split('?')[0];
    const middlewareHeaders = [];

    // ── Middleware (auth guards, redirects, rewrites)
    if (middlewareFn) {
        const pathname = urlWithoutQuery;
        const isAsset = pathname.startsWith('/_framework/') ||
                        pathname.startsWith('/_modules/') ||
                        pathname.startsWith('/scripts/') ||
                        /\.[a-z0-9]+$/i.test(pathname);
        if (!isAsset && middlewareMatches(pathname)) {
            try {
                const { NextResponse } = require(path.join(ROOT, '_framework', 'next-response.js'));
                const request = {
                    url: `http://${req.headers.host || 'localhost'}${req.url}`,
                    method: req.method,
                    pathname,
                    headers: req.headers,
                    cookies: parseRequestCookies(req.headers.cookie),
                };
                const result = await middlewareFn(request, { NextResponse });

                if (result) {
                    const status = typeof result.status === 'number' ? result.status : 200;
                    const location = headerValue(result.headers, 'location');

                    if (status >= 300 && status < 400 && location) {
                        res.writeHead(status, { Location: location, ...NO_CACHE });
                        res.end();
                        return;
                    }

                    // A body means "handle this request yourself".
                    if (result.body !== undefined && result.body !== null &&
                        result.status !== 200 && typeof result.status === 'number') {
                        sendMiddlewareResponse(res, result, req.method);
                        return;
                    }
                    if (result.headers) {
                        middlewareHeaders.push(result.headers);
                    }
                    if (result.rewrite) {
                        req.url = result.rewrite;
                    }
                }
            } catch (err) {
                console.error('❌ Middleware error:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Middleware error', detail: err.message }));
                return;
            }
        }
    }

    // ── API routes (api/** and app/api/**/route.js)
    if (urlWithoutQuery === '/api' || urlWithoutQuery.startsWith('/api/')) {
        await apiRouter.handleApiRequest(req, res, { routes: apiRoutes, port: server.address()?.port || PORT });
        return;
    }

    // ── Health check (load balancers, uptime monitors, k8s probes)
    if (urlWithoutQuery === '/_aziz/health' || urlWithoutQuery === '/healthz') {
        const body = Buffer.from(JSON.stringify({
            ok: true,
            status: 'healthy',
            uptime: Math.round(process.uptime()),
            pid: process.pid,
            version: process.env.AZIZ_VERSION || null,
            memory: {
                rss: Math.round(process.memoryUsage().rss / 1048576),
                heapUsed: Math.round(process.memoryUsage().heapUsed / 1048576),
            },
            precompiled: !!COMPILE_MANIFEST,
            // "not loaded" proves the production path never touched Babel.
            babel: Object.keys(require.cache).some(k => k.includes('@babel')) ? 'loaded' : 'not loaded',
        }));
        sendBuffer(req, res, body, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...SECURITY_HEADERS,
        });
        return;
    }

    // ── Route manifest (used by the client router to discover pages)
    if (urlWithoutQuery === '/_framework/routes.json') {
        const manifest = buildRouteManifest(ROOT, { compiled: COMPILED_URLS });
        const body = Buffer.from(JSON.stringify({
            dev: !PRODUCTION,
            // `file` holds an absolute server path — never send it to the browser.
            routes: manifest.map(({ pathname, filePath, type }) => ({ pathname, filePath, type })),
            i18n: serverRoutes.i18n,
        }));
        sendBuffer(req, res, body, {
            'Content-Type': 'application/json; charset=utf-8',
            ...NO_CACHE,
            ...SECURITY_HEADERS,
        });
        return;
    }

    // ── Image optimization
    if (urlWithoutQuery === '/_aziz/image' || urlWithoutQuery === '/__aziz/image') {
        const url = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
        await imageOptimizer.handleImageRequest(req, res, url, ROOT);
        return;
    }

    // ── Server metadata for client-side navigations
    if (urlWithoutQuery === '/__aziz/meta') {
        try {
            const url = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
            const requestPath = pageRouter.normalizePath(url.searchParams.get('path') || '/');
            let pathname = requestPath;
            let locale = null;
            if (serverRoutes.i18n) {
                const detected = pageRouter.detectLocale(pathname, serverRoutes.i18n);
                pathname = detected.pathname;
                locale = detected.locale;
            }
            const resolved = resolvePage(requestPath, pathname);
            const modules = [
                ...(resolved.info.layoutFiles || []).map(f => pageLoader.load(f)),
                resolved.info.pageFile ? pageLoader.load(resolved.info.pageFile) : null,
            ];
            const runtime = require('./lib/server-runtime');
            const ctx = runtime.createRenderContext({
                pathname: requestPath,
                params: resolved.params,
                searchParams: url.searchParams,
                locale,
                i18n: serverRoutes.i18n,
            });
            const metadata = await renderer.collectMetadata(modules, ctx);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...NO_CACHE });
            res.end(JSON.stringify({ metadata, pathname, locale }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', ...NO_CACHE });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // ── In production, neutralize the live-reload client (no WS server)
    if (PRODUCTION && urlWithoutQuery === '/scripts/live-reload-client.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
        res.end('/* live reload disabled in production */\n');
        return;
    }

    // ── node_modules bare imports: /_modules/mongoose → node_modules/mongoose
    if (urlWithoutQuery.startsWith('/_modules/')) {
        let specifier;
        try {
            specifier = decodeURIComponent(urlWithoutQuery.slice('/_modules/'.length));
        } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Malformed module specifier' }));
            return;
        }

        const filePath = resolveNodeModule(specifier, ROOT);

        if (!filePath) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Module not found: ${specifier}. Run: npm install ${specifier.split('/')[0]}` }));
            return;
        }

        try {
            const stat = fs.statSync(filePath);
            let code = fs.readFileSync(filePath, 'utf8');
            code = transformModule(code, filePath, stat.mtimeMs);
            res.writeHead(200, {
                'Content-Type': 'text/javascript; charset=utf-8',
                ...cacheHeadersFor('.js', false),
                'ETag': etagFor(stat),
            });
            res.end(code);
        } catch (err) {
            res.writeHead(500);
            res.end('Error reading module: ' + err.message);
        }
        return;
    }

    // ── Precompiled assets: /_compiled/app/page.<hash>.js
    //
    // Content-hashed, so they can be cached forever. Produced by
    // `npm run build`; the browser never sees the source path.
    if (urlWithoutQuery.startsWith('/_compiled/')) {
        // Only artifacts the build declared are reachable — a crafted
        // path cannot escape the compiled directory.
        const rel = COMPILED_ASSETS.get(urlWithoutQuery);
        if (!rel) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...NO_CACHE });
            res.end('Not found');
            return;
        }
        const target = path.join(ROOT, '.aziz', 'compiled', 'browser', rel);
        if (!fs.existsSync(target)) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...NO_CACHE });
            res.end('Not found');
            return;
        }
        const stat = fs.statSync(target);
        const body = fs.readFileSync(target);
        sendBuffer(req, res, body, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'ETag': `"${stat.size.toString(36)}-${stat.mtimeMs.toString(36)}"`,
            ...SECURITY_HEADERS,
        });
        return;
    }

    // ── Static files + SPA fallback
    let filePath;

    // Refuse secrets and server internals before touching the filesystem.
    const blocked = forbiddenReason(urlWithoutQuery);
    if (blocked) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', ...NO_CACHE });
        res.end(JSON.stringify({
            error: 'Not found',
            detail: `'${urlWithoutQuery}' is not served by Aziz.js (${blocked}).`,
            hint: 'Server-only code belongs in api/, server/, or a *.server.mjs file — import it from an API route, never from a page.',
        }));
        return;
    }

    // ── Pages: SSR / SSG / ISR / streaming
    //
    // A request with no file extension is a page unless a module with that
    // path is importable from the browser (then it is an extensionless
    // `import Foo from '@/components/Foo'` request).
    if ((req.method === 'GET' || req.method === 'HEAD') &&
        !path.extname(urlWithoutQuery) &&
        !urlWithoutQuery.startsWith('/_framework/') &&
        !urlWithoutQuery.startsWith('/_modules/') &&
        !urlWithoutQuery.startsWith('/scripts/') &&
        !looksLikeBrowserModule(urlWithoutQuery)) {
        try {
            await servePage(req, res, new URL(rawUrl, `http://${req.headers.host || 'localhost'}`), urlWithoutQuery);
        } catch (err) {
            console.error('❌ Page render failed:', err);
            sendHtml(req, res, `<!doctype html><html><body><h1>500 — Page render failed</h1><pre>${renderer.escapeHtml(err.message)}</pre></body></html>`, 500, NO_CACHE);
        }
        return;
    }

    try {
        if (urlWithoutQuery === '/' || urlWithoutQuery === '') {
            filePath = path.join(ROOT, 'index.html');
        } else {
            let decoded;
            try {
                decoded = decodeURIComponent(urlWithoutQuery);
            } catch {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Bad request');
                return;
            }

            // Security: resolve and CONFINE to the project root (blocks path traversal)
            const resolved = path.resolve(ROOT, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded));
            const rootResolved = path.resolve(ROOT);
            if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                res.end('Forbidden');
                return;
            }
            filePath = resolved;

            // SPA fallback: path with no file extension → serve index.html
            // so the client-side router handles it
            const ext = path.extname(filePath);
            if (!ext && !fs.existsSync(filePath)) {
                filePath = path.join(ROOT, 'index.html');
            }
        }
    } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad request');
        return;
    }

    if (!fs.existsSync(filePath)) {
        // Try appending .js / .jsx (import specifiers without extension)
        if (fs.existsSync(filePath + '.js')) {
            filePath = filePath + '.js';
        } else if (fs.existsSync(filePath + '.jsx')) {
            filePath = filePath + '.jsx';
        } else if (path.extname(filePath) === '' && fs.existsSync(path.join(ROOT, 'index.html'))) {
            filePath = path.join(ROOT, 'index.html');
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found: ' + urlWithoutQuery);
            return;
        }
    }

    try {
        const stat = fs.statSync(filePath);
        const fileExt = path.extname(filePath).toLowerCase();
        const isHtml = fileExt === '.html';
        const contentType = MIME[fileExt] || 'application/octet-stream';
        const headers = {
            'Content-Type': contentType,
            ...cacheHeadersFor(fileExt, isHtml),
            'ETag': etagFor(stat),
            ...SECURITY_HEADERS,
        };

        // Conditional request → 304
        if (req.headers['if-none-match'] === headers.ETag) {
            res.writeHead(304, headers);
            res.end();
            return;
        }

        let content = fs.readFileSync(filePath);

        // Transform JS/JSX/TS: JSX → h(), types stripped, imports rewritten (mtime-cached)
        if (['.js', '.jsx', '.mjs', '.ts', '.tsx'].includes(fileExt)) {
            const code = transformModule(content.toString(), filePath, stat.mtimeMs);
            content = Buffer.from(code);
        } else if (fileExt === '.css') {
            // Font optimization: ensure font-display:swap is present.
            content = Buffer.from(fontOptimizer.optimizeCSS(content.toString()));
        }

        sendBuffer(req, res, content, headers);
    } catch (err) {
        res.writeHead(500);
        res.end('Server error: ' + err.message);
    }
});

// ─── WebSocket (live reload, development only) ───────────────

if (!PRODUCTION) {
    server.on('upgrade', (req, socket) => {
        const key = req.headers['sec-websocket-key'];
        if (!key) { socket.destroy(); return; }
        const accept = crypto.createHash('sha1')
            .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
            .digest('base64');

        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );

        const client = {
            send(msg) {
                const buf = Buffer.from(msg);
                if (buf.length > 125) return; // control messages are tiny
                const frame = Buffer.alloc(buf.length + 2);
                frame[0] = 0x81;
                frame[1] = buf.length;
                buf.copy(frame, 2);
                socket.write(frame);
            }
        };

        clients.add(client);
        console.log(`🔌 Browser connected (${clients.size} total)`);

        socket.on('close', () => { clients.delete(client); });
        socket.on('error', () => { clients.delete(client); });
    });
}

function notifyClients() {
    if (clients.size === 0) return;
    console.log(`🔄 Reloading ${clients.size} browser(s)...`);
    clients.forEach(c => { try { c.send('reload'); } catch { clients.delete(c); } });
}

// ─── File Watcher (development only) ─────────────────────────
//
// NOTE: on Windows, Node's directory watcher can abort the process with
// "Assertion failed: !_wcsnicmp(filename, dir, dirlen)" (src\win\fs-event.c).
// It is a native assertion that try/catch cannot intercept, it is unrelated
// to recursive:true (a non-recursive watcher hits it too), and it only shows
// up on trees with nested subdirectories — roughly 1 start in 8 on the
// machine this was observed on. It is reproducible enough to be worth
// reporting upstream, and rare enough that switching watcher strategies
// costs more than it saves. Restarting the dev server always clears it.

const watchDirs = ['app', 'api', 'components', 'lib', 'models', 'styles', '_framework'];
const SERVER_CODE_DIRS = new Set(['api', 'lib', 'models']);
let reloadTimer = null;
let tailwindTimer = null;

function rebuildTailwind() {
    if (!TAILWIND || PRODUCTION) return;
    clearTimeout(tailwindTimer);
    tailwindTimer = setTimeout(() => {
        const css = tailwind.build(ROOT, { minify: false });
        if (css.ok) notifyClients();
        else console.warn(`⚠️  Tailwind CSS failed: ${css.reason}`);
    }, 200);
}

if (!PRODUCTION) {
    console.log('👀 Watching:');
    watchDirs.forEach(dir => {
        const full = path.join(ROOT, dir);
        if (!fs.existsSync(full)) return;
        console.log(`   - ${dir}/`);


        try {
            fs.watch(full, { recursive: true }, (_, filename) => {
                if (!filename) return;
                if (dir === 'styles' &&
                    (filename === 'tailwind.output.css' || filename.endsWith('.map'))) return;

                const ext = path.extname(filename);
                if (!['.js', '.jsx', '.mjs', '.ts', '.tsx', '.css', '.json'].includes(ext)) return;

                if (ext === '.css') fontOptimizer.invalidateFontPreloads();

                rebuildTailwind();

                console.log(`\n📝 Changed: ${dir}/${filename}`);

                // Keep both the transform and server module caches fresh
                const changed = path.join(full, filename);
                invalidateTransform(changed);
                pageLoader.invalidate(changed);

                if (dir === 'app') {
                    clearTimeout(reloadTimer);
                    reloadTimer = setTimeout(() => {
                        reloadPageRoutes(false);
                        notifyClients();
                    }, 200);
                    return;
                }

                if (SERVER_CODE_DIRS.has(dir)) {
                    // API routes may import from lib/ and models/ — reload them
                    clearTimeout(reloadTimer);
                    reloadTimer = setTimeout(() => {
                        reloadApiRoutes(false).then(notifyClients);
                    }, 200);
                    return;
                }

                clearTimeout(reloadTimer);
                reloadTimer = setTimeout(notifyClients, 300);
            });
        } catch (err) {
            console.warn(`   ⚠️ Could not watch ${dir}/: ${err.message}`);
        }
    });

    for (const name of ['i18n.js', 'i18n.cjs', 'i18n.mjs', 'i18n.json']) {
        const file = path.join(ROOT, name);
        if (!fs.existsSync(file)) continue;
        console.log(`   - ${name}`);
        try {
            fs.watch(file, () => {
                console.log(`\n📝 Changed: ${name}`);
                clearTimeout(reloadTimer);
                reloadTimer = setTimeout(() => {
                    reloadPageRoutes(false).then(notifyClients);
                }, 200);
            });
        } catch (err) {
            console.warn(`   ⚠️ Could not watch ${name}: ${err.message}`);
        }
    }

    if (TAILWIND) {
        const config = path.join(ROOT, 'tailwind.config.js');
        console.log('   - tailwind.config.js');
        try {
            fs.watch(config, () => {
                console.log('\n🎨 Changed: tailwind.config.js');
                rebuildTailwind();
            });
        } catch (err) {
            console.warn(`   ⚠️ Could not watch tailwind.config.js: ${err.message}`);
        }
    }
}

// ─── Start ────────────────────────────────────────────────────

// Slowloris protection and connection hygiene.
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 0;

// ─── Graceful shutdown ────────────────────────────────────────
//
// A production server must finish in-flight requests when the process
// manager (systemd, Docker, Kubernetes) asks it to stop. Without this
// the container is SIGKILLed mid-response.
let shuttingDown = false;

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n👋 ${signal} received — shutting down gracefully...`);

    // Tell live-reload clients to stop reconnecting.
    for (const client of clients) {
        try { client.send('shutdown'); } catch { /* ignore */ }
    }
    clients.clear();

    const force = setTimeout(() => {
        console.log('⚠️  Forcing exit after 10s');
        process.exit(1);
    }, 10_000);
    force.unref();

    server.close(() => {
        console.log('✅ Shutdown complete');
        process.exit(0);
    });
    // Stop accepting new keep-alive connections.
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled rejection:', reason);
});

function startServer(port) {
    server.listen(port, () => {
        console.log(`\n✅ Server running!`);
        console.log(`🌐 http://localhost:${port}/`);
        console.log(PRODUCTION ? '⏹️  Ctrl+C to stop\n' : '⏹️  Ctrl+C to stop\n');
    }).on('error', err => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️  Port ${port} busy, trying ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('❌', err);
        }
    });
}

reloadPageRoutes()
    .then(() => reloadApiRoutes())
    .then(async () => {
        middlewareFn = await loadMiddleware();
        if (middlewareFn) {
            console.log(`🛡️  Middleware active (${path.basename(findMiddlewareFile())})`);
        }
    })
    .then(() => startServer(PORT))
    .catch(err => {
        console.error('❌ Failed to load routes:', err);
        startServer(PORT);
    });
