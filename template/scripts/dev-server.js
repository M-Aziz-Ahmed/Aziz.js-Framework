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

const { hasBabel, transformModule, invalidate: invalidateTransform } = require('./lib/js-transform');
const { resolveNodeModule } = require('./lib/module-resolver');
const apiRouter = require('./lib/api-router');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const ROOT = process.cwd();
const PRODUCTION = process.argv.includes('--production') || process.env.NODE_ENV === 'production';

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

    if (BLOCKED_FILES.has(file)) return 'project metadata file';

    if (parts[0] === 'scripts') {
        return ALLOWED_SCRIPT_FILES.has(file) ? null : 'dev-server internals';
    }

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

if (!hasBabel()) {
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

console.log(`🚀 Aziz.js dev server starting${PRODUCTION ? ' (production mode)' : ''}...\n`);

// ─── Route Manifest ──────────────────────────────────────────
// Scans app/ and builds the page/layout/not-found/loading/error list for the
// client router.

const PAGE_NAMES     = ['page.js', 'page.jsx'];
const LAYOUT_NAMES   = ['layout.js', 'layout.jsx'];
const LOADING_NAMES  = ['loading.js', 'loading.jsx'];
const ERROR_NAMES    = ['error.js', 'error.jsx'];
// Next.js calls it not-found.js; 404.js is accepted as a friendlier alias.
const NOTFOUND_NAMES = ['not-found.js', 'not-found.jsx', '404.js', '404.jsx'];

function buildRouteManifest() {
    const manifest = [];
    const appDir = path.join(ROOT, 'app');
    if (!fs.existsSync(appDir)) return manifest;

    const filePathFor = (routeBase, fileName) =>
        '/app' + (routeBase === '/' ? '' : routeBase) + '/' + fileName;

    function scan(dir, routeBase) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                // Keep [slug] as-is — the router matcher expects bracket syntax
                const segment = entry.name;
                scan(fullPath, routeBase === '/' ? '/' + segment : routeBase + '/' + segment);
                continue;
            }

            const name = entry.name;

            if (PAGE_NAMES.includes(name)) {
                manifest.push({ type: 'page', pathname: routeBase || '/', filePath: filePathFor(routeBase, name) });
            } else if (LAYOUT_NAMES.includes(name)) {
                manifest.push({ type: 'layout', pathname: routeBase || '/', filePath: filePathFor(routeBase, name) });
            } else if (LOADING_NAMES.includes(name)) {
                manifest.push({ type: 'loading', pathname: routeBase || '/', filePath: filePathFor(routeBase, name) });
            } else if (ERROR_NAMES.includes(name)) {
                manifest.push({ type: 'error', pathname: routeBase || '/', filePath: filePathFor(routeBase, name) });
            } else if (NOTFOUND_NAMES.includes(name) && routeBase === '/') {
                // filePath must use the real name — the old code hardcoded .js,
                // which broke not-found.jsx.
                manifest.push({ type: 'not-found', pathname: '/not-found', filePath: filePathFor(routeBase, name) });
            }
            // route.js files are API routes — handled by api-router, not the page router
        }
    }

    scan(appDir, '/');
    return manifest;
}

// ─── API routes ──────────────────────────────────────────────

async function reloadApiRoutes(verbose = true) {
    apiRouter.purgeProjectRequireCache(ROOT);
    const { routes } = await apiRouter.loadApiRoutes(ROOT, { verbose });
    apiRoutes = routes;
}

// ─── HTTP Server ─────────────────────────────────────────────

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.jsx':  'text/javascript; charset=utf-8',
    '.mjs':  'text/javascript; charset=utf-8',
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

    // ── API routes (api/** and app/api/**/route.js)
    if (urlWithoutQuery === '/api' || urlWithoutQuery.startsWith('/api/')) {
        await apiRouter.handleApiRequest(req, res, { routes: apiRoutes, port: server.address()?.port || PORT });
        return;
    }

    // ── Route manifest (used by the client router to discover pages)
    if (urlWithoutQuery === '/_framework/routes.json') {
        const manifest = buildRouteManifest();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...NO_CACHE });
        res.end(JSON.stringify({ dev: !PRODUCTION, routes: manifest }));
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
        };

        // Conditional request → 304
        if (req.headers['if-none-match'] === headers.ETag) {
            res.writeHead(304, headers);
            res.end();
            return;
        }

        let content = fs.readFileSync(filePath);

        // Transform JS/JSX: JSX → h() + rewrite imports (mtime-cached)
        if (fileExt === '.js' || fileExt === '.jsx' || fileExt === '.mjs') {
            const code = transformModule(content.toString(), filePath, stat.mtimeMs);
            content = Buffer.from(code);
        }

        res.writeHead(200, headers);
        res.end(content);
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

if (!PRODUCTION) {
    console.log('👀 Watching:');
    watchDirs.forEach(dir => {
        const full = path.join(ROOT, dir);
        if (!fs.existsSync(full)) return;
        console.log(`   - ${dir}/`);

        try {
            fs.watch(full, { recursive: true }, (_, filename) => {
                if (!filename) return;
                const ext = path.extname(filename);
                if (!['.js', '.jsx', '.mjs', '.css', '.json'].includes(ext)) return;

                console.log(`\n📝 Changed: ${dir}/${filename}`);

                // Keep the transform cache fresh
                invalidateTransform(path.join(full, filename));

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
}

// ─── Start ────────────────────────────────────────────────────

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

reloadApiRoutes().then(() => startServer(PORT)).catch(err => {
    console.error('❌ Failed to load API routes:', err);
    startServer(PORT);
});
