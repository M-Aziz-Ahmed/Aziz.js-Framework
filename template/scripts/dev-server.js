#!/usr/bin/env node

const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();
const clients = new Set();
const apiHandlers = {};

// ─── Babel JSX Transform ──────────────────────────────────────
// Transform JSX → h() calls server-side before sending to browser

let Babel;
try {
    Babel = require('@babel/standalone');
} catch (e) {
    console.warn('⚠️  @babel/standalone not found. Run: npm install --save-dev @babel/standalone');
    Babel = null;
}

function transformJSX(code, filename, filePath) {
    if (!Babel) return code;
    
    // Skip framework internals — they have no JSX
    if (filePath.includes('/_framework/') || filePath.includes('\\_framework\\')) {
        return code;
    }
    
    try {
        const result = Babel.transform(code, {
            filename,
            presets: [
                ['react', { pragma: 'h', pragmaFrag: 'Fragment' }]
            ],
            plugins: [],
            sourceType: 'module',
        });
        return result.code;
    } catch (err) {
        console.error(`❌ JSX transform error in ${filename}:`, err.message);
        return `throw new Error(${JSON.stringify('JSX transform error in ' + filename + ': ' + err.message)});`;
    }
}

console.log('🚀 Aziz.js dev server starting...\n');

// ─── Route Manifest ──────────────────────────────────────────
// Scans app/ folder and builds a list of pages and layouts

function buildRouteManifest() {
    const manifest = [];
    const appDir = path.join(ROOT, 'app');
    if (!fs.existsSync(appDir)) return manifest;

    function scan(dir, routeBase) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                // Keep [slug] as-is — router.js matchRoute expects square bracket syntax
                const segment = entry.name;
                scan(fullPath, routeBase === '/' ? '/' + segment : routeBase + '/' + segment);
            } else if (entry.name === 'page.js' || entry.name === 'page.jsx') {
                const pathname = routeBase || '/';
                const filePath = '/app' + (pathname === '/' ? '' : pathname) + '/' + entry.name;
                manifest.push({ type: 'page', pathname, filePath });
            } else if (entry.name === 'layout.js' || entry.name === 'layout.jsx') {
                const pathname = routeBase || '/';
                const filePath = '/app' + (pathname === '/' ? '' : pathname) + '/' + entry.name;
                manifest.push({ type: 'layout', pathname, filePath });
            }
        }
    }

    scan(appDir, '/');
    return manifest;
}

// ─── Bare Import Rewriter ─────────────────────────────────────
// Transforms: import X from 'mongoose'  →  import X from '/_modules/mongoose'
// Transforms: import X from '@/lib/db'  →  import X from '/lib/db.js'

function rewriteImports(code, filePath) {
    // Rewrite @/ alias to absolute path
    code = code.replace(
        /from\s+['"]@\/([^'"]+)['"]/g,
        (_, p) => `from '/${p}'`
    );

    // Rewrite bare specifiers (not starting with /, ./, ../)
    code = code.replace(
        /from\s+['"]([^'"./][^'"]*)['"]/g,
        (match, specifier) => `from '/_modules/${specifier}'`
    );

    // Same for dynamic imports
    code = code.replace(
        /import\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g,
        (_, specifier) => `import('/_modules/${specifier}')`
    );

    return code;
}

// ─── Module Resolver ─────────────────────────────────────────
// Serves node_modules files for bare imports

function resolveNodeModule(specifier) {
    // Try to find the package in node_modules
    const parts = specifier.split('/');
    const pkgName = parts[0].startsWith('@') ? parts[0] + '/' + parts[1] : parts[0];
    const subPath = parts[0].startsWith('@') ? parts.slice(2).join('/') : parts.slice(1).join('/');

    const nodeModulesDir = path.join(ROOT, 'node_modules');

    // Try package.json to find main/module entry
    const pkgJsonPath = path.join(nodeModulesDir, pkgName, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
        return null;
    }

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

    if (subPath) {
        // Specific file requested
        const candidates = [
            path.join(nodeModulesDir, pkgName, subPath),
            path.join(nodeModulesDir, pkgName, subPath + '.js'),
            path.join(nodeModulesDir, pkgName, subPath + '/index.js'),
        ];
        for (const c of candidates) {
            if (fs.existsSync(c)) return c;
        }
        return null;
    }

    // Use module > browser > main priority
    const entry = pkg.module || pkg.browser || pkg.main || 'index.js';
    const entryPath = path.join(nodeModulesDir, pkgName, entry);
    return fs.existsSync(entryPath) ? entryPath : null;
}

// ─── JSX Transform ───────────────────────────────────────────
// Adds /** @jsx h */ pragma if file uses JSX and doesn't have it

function ensureJsxPragma(code) {
    if (code.includes('@jsx') || !code.includes('<')) return code;
    // Simple heuristic: if it has JSX-like syntax, add pragma
    if (/<[A-Z]|<[a-z]+[\s/>]/.test(code)) {
        return '/** @jsx h */\n' + code;
    }
    return code;
}

// ─── API Route Loader ─────────────────────────────────────────

function loadApiRoutes() {
    const apiDir = path.join(ROOT, 'api');
    if (!fs.existsSync(apiDir)) return;

    const files = fs.readdirSync(apiDir).filter(f => f.endsWith('.js'));
    console.log(`📡 Loading ${files.length} API route(s):`);

    files.forEach(file => {
        const routeName = path.basename(file, '.js');
        const filePath  = path.join(apiDir, file);

        try {
            delete require.cache[require.resolve(filePath)];
            const mod = require(filePath);

            if (mod.GET || mod.POST || mod.PUT || mod.DELETE || mod.PATCH) {
                const methods = {};
                ['GET','POST','PUT','DELETE','PATCH'].forEach(m => { if (mod[m]) methods[m] = mod[m]; });
                apiHandlers[routeName] = methods;
                console.log(`   ✅ /api/${routeName} [${Object.keys(methods).join(', ')}]`);
            } else {
                const handler = mod.default || mod;
                if (typeof handler === 'function') {
                    apiHandlers[routeName] = handler;
                    console.log(`   ✅ /api/${routeName}`);
                }
            }
        } catch (err) {
            console.error(`   ❌ /api/${routeName} — ${err.message}`);
        }
    });

    console.log('');
}

// ─── Request Helpers ─────────────────────────────────────────

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            try {
                resolve(body && req.headers['content-type']?.includes('application/json')
                    ? JSON.parse(body) : body);
            } catch { resolve(body); }
        });
        req.on('error', reject);
    });
}

function parseQuery(url) {
    const q = {};
    const qs = url.split('?')[1];
    if (qs) qs.split('&').forEach(p => {
        const [k, v] = p.split('=');
        q[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return q;
}

// ─── API Request Handler ──────────────────────────────────────

async function handleApiRequest(req, res) {
    const urlPath   = req.url.split('?')[0];
    const routeName = urlPath.replace('/api/', '');
    const handler   = apiHandlers[routeName];

    if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `API route /api/${routeName} not found` }));
        return;
    }

    try {
        const body  = await parseBody(req);
        const query = parseQuery(req.url);

        if (typeof handler === 'function') {
            // Old style
            const apiReq = { method: req.method, body, query, headers: req.headers, url: req.url };
            const apiRes = {
                statusCode: 200, headers: {},
                status(c) { this.statusCode = c; return this; },
                json(d) {
                    res.writeHead(this.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...this.headers });
                    res.end(JSON.stringify(d));
                },
                send(d) {
                    res.writeHead(this.statusCode, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', ...this.headers });
                    res.end(d);
                },
                setHeader(k, v) { this.headers[k] = v; return this; }
            };
            await handler(apiReq, apiRes);
        } else {
            // New style: named exports
            const methodFn = handler[req.method];
            if (!methodFn) {
                res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': Object.keys(handler).join(', ') });
                res.end(JSON.stringify({ error: 'Method not allowed', allowed: Object.keys(handler) }));
                return;
            }

            const request = {
                method: req.method,
                headers: req.headers,
                url: `http://localhost:${PORT}${req.url}`,
                json: async () => body,
                text: async () => typeof body === 'string' ? body : JSON.stringify(body)
            };

            const result = await methodFn(request);

            if (result && result.body !== undefined) {
                const headers = { 'Access-Control-Allow-Origin': '*', ...Object.fromEntries(result.headers || []) };
                res.writeHead(result.status || 200, headers);
                res.end(result.body);
            }
        }
    } catch (err) {
        console.error(`❌ API Error /api/${routeName}:`, err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
    }
}

// ─── HTTP Server ──────────────────────────────────────────────

const MIME = {
    '.html': 'text/html',
    '.js':   'text/javascript',
    '.jsx':  'text/javascript',
    '.mjs':  'text/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
};

const NO_CACHE = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
};

const server = http.createServer(async (req, res) => {
    const urlWithoutQuery = req.url.split('?')[0];

    // ── CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
        res.end();
        return;
    }

    // ── API routes
    if (urlWithoutQuery.startsWith('/api/')) {
        await handleApiRequest(req, res);
        return;
    }

    // ── Route manifest (used by router.js to discover pages)
    if (urlWithoutQuery === '/_framework/routes.json') {
        const manifest = buildRouteManifest();
        res.writeHead(200, { 'Content-Type': 'application/json', ...NO_CACHE });
        res.end(JSON.stringify(manifest));
        return;
    }

    // ── node_modules bare imports: /_modules/mongoose → node_modules/mongoose
    if (urlWithoutQuery.startsWith('/_modules/')) {
        const specifier = urlWithoutQuery.slice('/_modules/'.length);
        const filePath  = resolveNodeModule(specifier);

        if (!filePath) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Module not found: ${specifier}. Run: npm install ${specifier.split('/')[0]}` }));
            return;
        }

        try {
            let code = fs.readFileSync(filePath, 'utf8');
            code = rewriteImports(code, filePath);
            res.writeHead(200, { 'Content-Type': 'text/javascript', ...NO_CACHE });
            res.end(code);
        } catch (err) {
            res.writeHead(500);
            res.end('Error reading module: ' + err.message);
        }
        return;
    }

    // ── Static files
    let filePath;

    // Root → index.html
    if (urlWithoutQuery === '/' || urlWithoutQuery === '') {
        filePath = path.join(ROOT, 'index.html');
    } else {
        filePath = path.join(ROOT, urlWithoutQuery);

        // SPA fallback: path with no file extension → serve index.html
        // so the client-side router handles it
        const ext = path.extname(urlWithoutQuery);
        if (!ext) {
            filePath = path.join(ROOT, 'index.html');
        }
    }

    if (!fs.existsSync(filePath)) {
        // Try appending .js
        if (fs.existsSync(filePath + '.js')) {
            filePath = filePath + '.js';
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found: ' + urlWithoutQuery);
            return;
        }
    }

    try {
        let content = fs.readFileSync(filePath);
        const fileExt = path.extname(filePath).toLowerCase();
        const contentType = MIME[fileExt] || 'application/octet-stream';

        // Transform JS/JSX files: JSX → h() + rewrite imports
        if (fileExt === '.js' || fileExt === '.jsx' || fileExt === '.mjs') {
            let code = content.toString();
            code = transformJSX(code, path.basename(filePath), filePath);
            code = rewriteImports(code, filePath);
            content = Buffer.from(code);
        }

        res.writeHead(200, { 'Content-Type': contentType, ...NO_CACHE });
        res.end(content);
    } catch (err) {
        res.writeHead(500);
        res.end('Server error: ' + err.message);
    }
});

// ─── WebSocket (live reload) ──────────────────────────────────

server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
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
            const frame = Buffer.alloc(buf.length + 2);
            frame[0] = 0x81; frame[1] = buf.length;
            buf.copy(frame, 2);
            socket.write(frame);
        }
    };

    clients.add(client);
    console.log(`🔌 Browser connected (${clients.size} total)`);

    socket.on('close', () => { clients.delete(client); });
    socket.on('error', () => { clients.delete(client); });
});

function notifyClients() {
    console.log(`🔄 Reloading ${clients.size} browser(s)...`);
    clients.forEach(c => { try { c.send('reload'); } catch { clients.delete(c); } });
}

// ─── File Watcher ─────────────────────────────────────────────

const watchDirs = ['app', 'api', 'components', 'lib', 'models', 'styles', '_framework'];
let reloadTimer = null;

console.log('👀 Watching:');
watchDirs.forEach(dir => {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) return;
    console.log(`   - ${dir}/`);

    fs.watch(full, { recursive: true }, (_, filename) => {
        if (!filename) return;
        const ext = path.extname(filename);
        if (!['.js', '.jsx', '.css', '.json'].includes(ext)) return;

        console.log(`\n📝 Changed: ${dir}/${filename}`);
        clearTimeout(reloadTimer);

        if (dir === 'api') {
            loadApiRoutes();
        }

        reloadTimer = setTimeout(notifyClients, 300);
    });
});

// ─── Start ────────────────────────────────────────────────────

function startServer(port) {
    server.listen(port, () => {
        console.log(`\n✅ Dev server running!`);
        console.log(`🌐 http://localhost:${port}/\n`);
        console.log('⏹️  Ctrl+C to stop\n');
    }).on('error', err => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️  Port ${port} busy, trying ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('❌', err);
        }
    });
}

loadApiRoutes();
startServer(PORT);
process.stdin.resume();
