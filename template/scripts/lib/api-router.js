// ============================================================
//  Aziz.js — server-side API route system
//  - Scans api/**/*.js|mjs  →  /api/**
//  - Scans app/api/**/route.js|mjs → /api/**  (Next.js style)
//  - Dynamic segments ([id]) and catch-alls ([...all])
//  - CJS + ESM (.mjs) route modules
//  - Request/Response helpers (cookies, params, query, json…)
// ============================================================

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// ─── Pattern matching ────────────────────────────────────────
// Supports: /api/users, /api/users/[id], /api/files/[...path]

function matchApiPattern(pattern, pathname) {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);
    const params = {};

    const catchAll = patternParts.findIndex(p => p.startsWith('[...'));
    const prefixLen = catchAll === -1 ? patternParts.length : catchAll;

    if (catchAll === -1) {
        if (patternParts.length !== pathParts.length) return null;
    } else if (pathParts.length < patternParts.length) {
        // /api/files/[...path] requires at least /api/files/x
        return null;
    }

    for (let i = 0; i < prefixLen; i++) {
        const p = patternParts[i];
        if (p.startsWith('[') && p.endsWith(']')) {
            params[p.slice(1, -1)] = pathParts[i];
        } else if (p !== pathParts[i]) {
            return null;
        }
    }

    if (catchAll !== -1) {
        params[patternParts[catchAll].slice(4, -1)] = pathParts.slice(catchAll);
    }

    return params;
}

// Specificity: more static segments first, catch-alls last.
function patternScore(pattern) {
    const parts = pattern.split('/').filter(Boolean);
    let statics = 0;
    let dynamics = 0;
    let catchAll = 0;
    for (const p of parts) {
        if (p.startsWith('[...')) catchAll++;
        else if (p.startsWith('[')) dynamics++;
        else statics++;
    }
    return { statics, dynamics, catchAll, depth: parts.length };
}

function compareSpecificity(a, b) {
    if (a.catchAll !== b.catchAll) return a.catchAll - b.catchAll;
    if (a.statics !== b.statics) return b.statics - a.statics;
    if (a.dynamics !== b.dynamics) return a.dynamics - b.dynamics;
    return b.depth - a.depth;
}

function findApiRoute(routes, pathname) {
    for (const route of routes) {
        const params = matchApiPattern(route.pattern, pathname);
        if (params !== null) return { route, params };
    }
    return null;
}

// ─── Route discovery ─────────────────────────────────────────

function scanDirForRoutes(dir, urlBase, suffixes, out) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const seg = entry.name; // keeps [param] syntax for the matcher
            scanDirForRoutes(full, urlBase === '/' ? '/' + seg : urlBase + '/' + seg, suffixes, out);
        } else {
            for (const suffix of suffixes) {
                if (entry.name === suffix || entry.name === suffix.replace(/\.js$/, '.mjs')) {
                    let pattern = urlBase;
                    if (entry.name === 'route.js' || entry.name === 'route.mjs') {
                        pattern = urlBase; // /app/api/users/route.js → /api/users
                    } else {
                        pattern = (urlBase === '/' ? '' : urlBase) + '/' + entry.name.replace(/\.(m)?js$/, '');
                    }
                    if (!pattern.startsWith('/')) pattern = '/' + pattern;
                    // normalize double slashes
                    pattern = pattern.replace(/\/+/g, '/');
                    out.push({ pattern, file: full });
                }
            }
        }
    }
}

function discoverApiFiles(ROOT) {
    const found = [];

    // Next.js style: app/api/**/route.js
    const appApiDir = path.join(ROOT, 'app', 'api');
    if (fs.existsSync(appApiDir)) {
        const walk = (dir, urlBase) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full, urlBase === '/' ? '/' + entry.name : urlBase + '/' + entry.name);
                } else if (entry.name === 'route.js' || entry.name === 'route.mjs') {
                    found.push({ pattern: urlBase.replace(/\/+/g, '/'), file: full });
                }
            }
        };
        walk(appApiDir, '/api');
    }

    // Classic style: api/**/<name>.js
    const apiDir = path.join(ROOT, 'api');
    if (fs.existsSync(apiDir)) {
        const walk = (dir, urlBase) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full, urlBase === '/' ? '/' + entry.name : urlBase + '/' + entry.name);
                } else if (/\.(m)?js$/.test(entry.name)) {
                    const name = entry.name.replace(/\.(m)?js$/, '');
                    const pattern = (urlBase === '/' ? '' : urlBase) + '/' + name;
                    found.push({ pattern: pattern.replace(/\/+/g, '/'), file: full });
                }
            }
        };
        walk(apiDir, '/api');
    }

    return found;
}

// ─── Module loading (CJS require + ESM .mjs / export-syntax) ─

async function loadRouteModule(filePath) {
    if (filePath.endsWith('.mjs')) {
        return import(pathToFileURL(filePath).href + '?t=' + Date.now());
    }
    try {
        delete require.cache[require.resolve(filePath)];
        return require(filePath);
    } catch (err) {
        if (err.code === 'ERR_REQUIRE_ESM' || err instanceof SyntaxError) {
            try {
                return await import(pathToFileURL(filePath).href + '?t=' + Date.now());
            } catch (err2) {
                throw new Error(
                    `${filePath}: ${err2.message}\n` +
                    `  Hint: API routes can export { GET, POST, … } via module.exports, ` +
                    `or use the .mjs extension for native ESM.`
                );
            }
        }
        throw err;
    }
}

// Normalize any module shape into { methods, legacy }
//  - module.exports = { GET, POST }            (CJS named)
//  - export function GET                        (ESM named)
//  - export default function (req, res)         (legacy Express-style)
//  - module.exports = fn                        (legacy)
function normalizeHandlers(mod) {
    const methods = {};
    let legacy = null;

    if (mod && typeof mod === 'object') {
        const candidates = [mod];
        if (mod.default && typeof mod.default === 'object') candidates.push(mod.default);
        if (typeof mod.default === 'function') legacy = mod.default;

        for (const c of candidates) {
            if (!c || typeof c !== 'object') continue;
            for (const m of METHODS) {
                if (typeof c[m] === 'function') methods[m] = c[m];
            }
        }
    } else if (typeof mod === 'function') {
        legacy = mod;
    }

    return { methods, legacy };
}

async function loadApiRoutes(ROOT, { verbose = true } = {}) {
    const files = discoverApiFiles(ROOT);
    const routes = [];
    const errors = [];

    for (const { pattern, file } of files) {
        try {
            const mod = await loadRouteModule(file);
            const { methods, legacy } = normalizeHandlers(mod);
            if (Object.keys(methods).length === 0 && !legacy) {
                errors.push(`${file}: no HTTP method exports (expected GET, POST, …)`);
                continue;
            }
            const score = patternScore(pattern);
            routes.push({ pattern, file, methods, legacy, ...score });
        } catch (err) {
            errors.push(`${file}: ${err.message}`);
        }
    }

    routes.sort(compareSpecificity);

    if (verbose) {
        console.log(`📡 Loading ${routes.length} API route(s):`);
        for (const r of routes) {
            const names = Object.keys(r.methods);
            const label = names.length ? `[${names.join(', ')}]` : '[legacy handler]';
            console.log(`   ✅ ${r.pattern} ${label}`);
        }
        for (const e of errors) console.log(`   ❌ ${e}`);
        console.log('');
    }

    return { routes, errors };
}

// ─── Request helpers ─────────────────────────────────────────

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i === -1) continue;
        try {
            out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
        } catch {
            out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
        }
    }
    return out;
}

function jsonParseError(message) {
    const err = new SyntaxError(message);
    err.status = 400;
    return err;
}

// Build the framework Request object handed to route handlers.
function buildRequest(req, params, rawBody, port) {
    const url = new URL(req.url, `http://localhost:${port || 3000}`);
    const contentType = req.headers['content-type'] || '';

    let parsedBody;
    if (rawBody && contentType.includes('application/json')) {
        try {
            parsedBody = JSON.parse(rawBody);
        } catch {
            parsedBody = undefined; // json() will re-throw a clean 400
        }
    } else {
        parsedBody = rawBody;
    }

    const alreadyParsed = parsedBody !== undefined && parsedBody !== rawBody;

    return {
        method: req.method,
        url: url.href,
        nextUrl: url,
        params,
        query: url.searchParams,
        headers: req.headers,
        cookies: parseCookies(req.headers.cookie),
        rawBody,
        body: alreadyParsed ? parsedBody : rawBody,

        json: async () => {
            if (alreadyParsed) return parsedBody;
            if (!rawBody) throw jsonParseError('Unexpected end of JSON input');
            try {
                return JSON.parse(rawBody);
            } catch {
                throw jsonParseError('Invalid JSON in request body');
            }
        },

        text: async () => (typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)),

        formData: async () => {
            if (contentType.includes('application/x-www-form-urlencoded')) {
                const params2 = new URLSearchParams(rawBody);
                const obj = {};
                for (const [k, v] of params2) obj[k] = v;
                return obj;
            }
            if (alreadyParsed) return parsedBody;
            throw new Error(`Unsupported content type for formData(): ${contentType || '(none)'}`);
        },
    };
}

// ─── Response sending ────────────────────────────────────────

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function headersToPlain(headers) {
    const out = {};
    if (!headers) return out;
    if (headers instanceof Map) {
        for (const [k, v] of headers) out[k] = v;
    } else if (typeof headers.forEach === 'function') {
        // Headers instance (or array of pairs)
        if (Array.isArray(headers)) {
            for (const [k, v] of headers) out[k] = v;
        } else {
            headers.forEach((v, k) => { out[k] = v; });
        }
    } else if (typeof headers === 'object') {
        Object.assign(out, headers);
    }
    return out;
}

function looksLikeJSON(str) {
    if (typeof str !== 'string') return false;
    const t = str.trimStart();
    return t.startsWith('{') || t.startsWith('[');
}

function sendJson(res, status, data, headOnly) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS });
    res.end(headOnly ? undefined : JSON.stringify(data));
}

function isResponseLike(result) {
    if (!result || typeof result !== 'object') return false;
    if (result.body !== undefined) return true;                       // NextResponse / Response
    return typeof result.status === 'number' && result.headers != null;
}

function sendHandlerResult(result, res, { headOnly = false } = {}) {
    if (res.writableEnded) return;

    if (result === undefined || result === null) {
        return sendJson(res, 500, {
            error: 'API handler returned no response',
            hint: 'Return NextResponse.json(...), a plain object, or use the legacy res.json(...) API.',
        }, headOnly);
    }

    if (typeof result === 'string') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...CORS_HEADERS });
        res.end(headOnly ? undefined : result);
        return;
    }

    if (isResponseLike(result)) {
        const headers = headersToPlain(result.headers);
        if (!headers['Content-Type'] && looksLikeJSON(result.body)) {
            headers['Content-Type'] = 'application/json; charset=utf-8';
        }
        if (!headers['Access-Control-Allow-Origin']) {
            Object.assign(headers, CORS_HEADERS);
        }
        const status = typeof result.status === 'number' ? result.status : 200;
        res.writeHead(status, headers);
        res.end(headOnly ? undefined : (result.body ?? null));
        return;
    }

    // Plain object / array → JSON
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS });
    res.end(headOnly ? undefined : JSON.stringify(result));
}

// Legacy (req, res) handler support — Express/Next-pages style.
function legacyResponseShim(req, res, request) {
    return {
        statusCode: 200,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        json(data) {
            res.writeHead(this.statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...this.headers });
            res.end(JSON.stringify(data));
        },
        send(data) {
            const type = typeof data === 'object' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
            res.writeHead(this.statusCode, { 'Content-Type': type, ...CORS_HEADERS, ...this.headers });
            res.end(typeof data === 'object' ? JSON.stringify(data) : data);
        },
        setHeader(k, v) { this.headers[k] = v; return this; },
        redirect(url, code = 307) {
            res.writeHead(code, { 'Location': url, ...CORS_HEADERS, ...this.headers });
            res.end();
        },
        // Enriched request fields for legacy handlers
        params: request.params,
        cookies: request.cookies,
        nextUrl: request.nextUrl,
        query: Object.fromEntries(request.query),
    };
}

// ─── Full request dispatcher ─────────────────────────────────

async function handleApiRequest(req, res, { routes, port }) {
    const rawPath = req.url.split('?')[0];
    let pathname;
    try {
        pathname = decodeURIComponent(rawPath);
    } catch {
        return sendJson(res, 400, { error: 'Malformed URL' });
    }
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

    const match = findApiRoute(routes, pathname);

    // OPTIONS preflight (route exists or not)
    if (req.method === 'OPTIONS') {
        const allow = match
            ? Object.keys(match.route.methods).concat(match.route.legacy ? METHODS : []).join(', ')
            : 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS';
        res.writeHead(204, { 'Allow': allow, ...CORS_HEADERS });
        res.end();
        return;
    }

    if (!match) {
        return sendJson(res, 404, { error: `API route ${pathname} not found` });
    }

    const { route, params } = match;
    const headOnly = req.method === 'HEAD';

    try {
        const rawBody = await parseBody(req);
        const request = buildRequest(req, params, rawBody, port);

        let methodFn = route.methods[req.method];
        if (!methodFn && headOnly) methodFn = route.methods.GET;

        if (!methodFn && !route.legacy) {
            res.writeHead(405, {
                'Content-Type': 'application/json; charset=utf-8',
                'Allow': Object.keys(route.methods).join(', '),
                ...CORS_HEADERS,
            });
            res.end(JSON.stringify({
                error: `Method ${req.method} not allowed`,
                allowed: Object.keys(route.methods),
            }));
            return;
        }

        if (methodFn) {
            const result = await methodFn(request);
            sendHandlerResult(result, res, { headOnly });
        } else {
            // Legacy (req, res) handler writes the response itself.
            const apiRes = legacyResponseShim(req, res, request);
            await route.legacy(request, apiRes);
            if (!res.writableEnded) {
                sendJson(res, 500, { error: 'Legacy handler never sent a response' });
            }
        }
    } catch (err) {
        const status = err && err.status ? err.status : (err instanceof SyntaxError ? 400 : 500);
        console.error(`❌ API Error ${req.method} ${pathname}:`, err);
        sendJson(res, status, { error: err.message || 'Internal Server Error' });
    }
}

// Purge require cache for project files (not node_modules) so
// API routes see fresh lib/ and models/ code after edits.
function purgeProjectRequireCache(ROOT) {
    const prefix = path.resolve(ROOT) + path.sep;
    for (const key of Object.keys(require.cache)) {
        if (key.startsWith(prefix) && !key.includes('node_modules')) {
            delete require.cache[key];
        }
    }
}

module.exports = {
    METHODS,
    matchApiPattern,
    patternScore,
    compareSpecificity,
    findApiRoute,
    discoverApiFiles,
    loadRouteModule,
    normalizeHandlers,
    loadApiRoutes,
    parseBody,
    parseCookies,
    buildRequest,
    sendHandlerResult,
    handleApiRequest,
    purgeProjectRequireCache,
    headersToPlain,
};
