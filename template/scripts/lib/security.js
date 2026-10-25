// ============================================================
//  Aziz.js — built-in security
//
//  Three things a framework should not leave to every application:
//
//    1. Response headers   (CSP, HSTS, frame options, …)
//    2. CSRF protection    (origin validation + optional token)
//    3. Rate limiting      (per-IP, fixed window)
//
//  All three are configured from `aziz.config.js` and are on by
//  default. Nothing here adds a dependency — it is plain Node.
//
//  aziz.config.js
//    module.exports = {
//      security: {
//        csrf: 'origin',              // 'origin' | 'strict' | false
//        cors: { origin: false },     // false | '*' | 'https://app.example.com'
//        rateLimit: { windowMs: 60000, max: 300 },
//        trustProxy: false,           // honour X-Forwarded-For
//      },
//    };
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_FILES = ['aziz.config.js', 'aziz.config.cjs'];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const CSRF_COOKIE = '__aziz_csrf';
const CSRF_HEADER = 'x-aziz-csrf';        // incoming header, lower-cased
const CSRF_HEADER_OUT = 'X-Aziz-CSRF';    // outgoing header, as sent by the browser

const DEFAULT_CSP = [
    "default-src 'self'",
    // The framework ships hydration and live-reload as inline scripts, so
    // 'unsafe-inline' is required. Everything else is same-origin —
    // except cdn.jsdelivr.net, which the Bootstrap scaffolder uses.
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' ws: wss:",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
].join('; ');

const DEFAULT_SECURITY = {
    // 'origin'  → validate Origin/Referer/Sec-Fetch-Site on writes
    // 'strict'  → the above, plus a double-submit token
    // false     → no CSRF checks
    csrf: 'origin',

    // CORS is same-origin only by default. Listing origins opts in.
    cors: {
        origin: false,
        methods: 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
        headers: 'Content-Type, Authorization, X-Aziz-CSRF',
        credentials: false,
        maxAge: 600,
    },

    rateLimit: {
        enabled: true,
        windowMs: 60_000,
        max: 300,
    },

    // Only enable behind a proxy you control — X-Forwarded-For is
    // attacker-controlled otherwise.
    trustProxy: false,

    headers: {
        'Content-Security-Policy': DEFAULT_CSP,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'X-XSS-Protection': '0',
    },

    // Sent in production only.
    hsts: 'max-age=31536000; includeSubDomains',
};

// ─── Config ───────────────────────────────────────────────────

function mergeConfig(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const rawSecurity = source.security && typeof source.security === 'object' ? source.security : {};

    const headers = { ...DEFAULT_SECURITY.headers };
    for (const [key, value] of Object.entries(rawSecurity.headers || {})) {
        // `null` removes a header entirely.
        if (value === null || value === false) delete headers[key];
        else headers[key] = String(value);
    }

    const security = {
        ...DEFAULT_SECURITY,
        ...rawSecurity,
        cors: { ...DEFAULT_SECURITY.cors, ...(rawSecurity.cors || {}) },
        rateLimit: { ...DEFAULT_SECURITY.rateLimit, ...(rawSecurity.rateLimit || {}) },
        headers,
    };

    return { ...source, security };
}

// Loads aziz.config.js from the project root. Never throws: a broken
// config must not take the server down.
function loadConfig(ROOT) {
    for (const name of CONFIG_FILES) {
        const file = path.join(ROOT, name);
        if (!fs.existsSync(file)) continue;
        try {
            delete require.cache[require.resolve(file)];
            const loaded = require(file);
            const raw = loaded && loaded.default ? loaded.default : loaded;
            return mergeConfig(raw);
        } catch (err) {
            console.warn(`⚠️  Failed to load ${name}: ${err.message}`);
            return mergeConfig({});
        }
    }
    return mergeConfig({});
}

// ─── Response headers ─────────────────────────────────────────

function securityHeaders(config, { production = false } = {}) {
    const headers = { ...(config.headers || {}) };
    if (production && config.hsts) headers['Strict-Transport-Security'] = config.hsts;
    return headers;
}

function hasHeader(headers, name) {
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lower) return true;
    }
    return false;
}

// Node's writeHead has four shapes:
//   writeHead(status)
//   writeHead(status, headers)
//   writeHead(status, statusMessage, headers)
//   writeHead(status, rawHeaderArray)   // [name, value, name, value, …]
function mergeHeaders(headers, extra, names) {
    if (Array.isArray(headers)) {
        const out = headers.slice();
        for (const name of names) {
            const present = out.some((v, i) => i % 2 === 0 && String(v).toLowerCase() === name.toLowerCase());
            if (!present) out.push(name, extra[name]);
        }
        return out;
    }
    const out = { ...(headers || {}) };
    for (const name of names) {
        if (!hasHeader(out, name)) out[name] = extra[name];
    }
    return out;
}

// Wraps res.writeHead so a set of headers lands on every response —
// including API responses, redirects, streamed documents and error paths,
// which is where a hand-written header list usually leaks.
function patchWriteHead(res, extraHeaders) {
    const original = res.writeHead.bind(res);
    const names = Object.keys(extraHeaders);

    res.writeHead = function writeHead(statusCode, ...rest) {
        let args = rest.slice();

        if (typeof args[0] === 'string') {
            // writeHead(status, statusMessage, headers)
            const message = args.shift();
            args = [message, mergeHeaders(args[0], extraHeaders, names)];
        } else if (args.length === 0) {
            args = [mergeHeaders(null, extraHeaders, names)];
        } else {
            args[0] = mergeHeaders(args[0], extraHeaders, names);
        }

        return original(statusCode, ...args);
    };

    return res;
}

function installSecurityHeaders(res, headers) {
    if (!headers || !res || res.__azizSecurityHeaders) return res;
    const names = Object.keys(headers);
    if (!names.length) return res;

    res.__azizSecurityHeaders = true;
    return patchWriteHead(res, headers);
}

// ─── Cookies ──────────────────────────────────────────────────

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    for (const part of String(header).split(';')) {
        const i = part.indexOf('=');
        if (i === -1) continue;
        const key = part.slice(0, i).trim();
        if (!key) continue;
        try {
            out[key] = decodeURIComponent(part.slice(i + 1).trim());
        } catch {
            out[key] = part.slice(i + 1).trim();
        }
    }
    return out;
}

// ─── Origins ──────────────────────────────────────────────────

function requestOrigin(req) {
    const host = req.headers.host || 'localhost';
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    return `${proto || 'http'}://${host}`;
}

function originOf(value) {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

function allowedOriginList(config) {
    const origin = config.cors && config.cors.origin;
    if (!origin || origin === false || origin === null) return [];
    if (origin === '*') return ['*'];
    return Array.isArray(origin) ? origin : [origin];
}

// Same-origin (the request's own host) or an explicitly allowed origin.
function isOriginAllowed(origin, req, config) {
    if (!origin) return false;
    const allowed = allowedOriginList(config);
    if (allowed.includes('*')) return true;
    if (allowed.includes(origin)) return true;

    const own = originOf(requestOrigin(req));
    return !!own && origin === own;
}

// ─── CSRF ─────────────────────────────────────────────────────

function timingSafeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function createCsrfToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function csrfCookieHeader(token) {
    // Readable by the browser on purpose: the client echoes it back in a
    // header, which a cross-origin attacker cannot do.
    return `${CSRF_COOKIE}=${token}; Path=/; SameSite=Lax; Max-Age=43200`;
}

function csrfEnabled(config) {
    const mode = config.csrf;
    if (mode === false || mode === null || mode === undefined) return false;
    return mode === 'strict' ? 'strict' : 'origin';
}

// Returns { ok: true } or { ok: false, status, reason }.
//
//  Layer 1 — the request must be same-origin. Browsers send Origin on
//            every state-changing request, and Sec-Fetch-Site on all of
//            them; a mismatch is a cross-site request.
//
//  Layer 2 — 'strict' mode only: if the browser sent the CSRF cookie,
//            it must also send the matching token header. The attacker
//            cannot read the cookie, so it cannot produce the header.
function checkCsrf(req, config) {
    const mode = csrfEnabled(config);
    if (!mode) return { ok: true };

    const method = (req.method || 'GET').toUpperCase();
    if (SAFE_METHODS.has(method)) return { ok: true };

    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite === 'cross-site') {
        return { ok: false, status: 403, reason: 'Cross-site request blocked (Sec-Fetch-Site: cross-site)' };
    }

    const origin = req.headers.origin;
    if (origin) {
        if (origin === 'null') {
            return { ok: false, status: 403, reason: 'Cross-site request blocked (opaque origin)' };
        }
        if (!isOriginAllowed(origin, req, config)) {
            return { ok: false, status: 403, reason: `Cross-origin request blocked (origin: ${origin})` };
        }
    } else {
        const referer = req.headers.referer;
        if (referer) {
            const refOrigin = originOf(referer);
            if (refOrigin && !isOriginAllowed(refOrigin, req, config)) {
                return { ok: false, status: 403, reason: `Cross-origin request blocked (referer: ${refOrigin})` };
            }
        }
    }

    if (mode === 'strict') {
        // The token is only meaningful for a browser. A server-side render
        // calling its own API has no Sec-Fetch-Site and no Origin, and it
        // must not be asked for a token it cannot have.
        const browserLike = !!req.headers['sec-fetch-site'] || !!req.headers.origin;
        const cookieToken = browserLike ? parseCookies(req.headers.cookie)[CSRF_COOKIE] : null;
        if (cookieToken) {
            const headerToken = req.headers[CSRF_HEADER];
            if (!headerToken || !timingSafeEqual(headerToken, cookieToken)) {
                return {
                    ok: false,
                    status: 403,
                    reason: 'Missing or invalid CSRF token. Send the __aziz_csrf cookie value in the X-Aziz-CSRF header.',
                };
            }
        }
    }

    return { ok: true };
}

// ─── Rate limiting ────────────────────────────────────────────

// Fixed window, per key. Cheap, predictable, and enough to stop a
// runaway client or a single-IP flood.
function createRateLimiter({ enabled = true, windowMs = 60_000, max = 300 } = {}) {
    const buckets = new Map();
    let requests = 0;

    function sweep(now) {
        for (const [key, bucket] of buckets) {
            if (now >= bucket.resetAt) buckets.delete(key);
        }
    }

    return {
        get size() { return buckets.size; },

        check(key, now = Date.now()) {
            if (!enabled) {
                return { allowed: true, limit: max, remaining: max, resetAt: 0, retryAfter: 0 };
            }

            let bucket = buckets.get(key);
            if (!bucket || now >= bucket.resetAt) {
                bucket = { count: 0, resetAt: now + windowMs };
                buckets.set(key, bucket);
            }
            bucket.count++;

            // Amortised cleanup so the map cannot grow without bound.
            if (++requests % 500 === 0) sweep(now);

            const allowed = bucket.count <= max;
            return {
                allowed,
                limit: max,
                remaining: Math.max(0, max - bucket.count),
                resetAt: bucket.resetAt,
                retryAfter: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
            };
        },

        reset(key) { buckets.delete(key); },
        clear() { buckets.clear(); },
    };
}

function clientIp(req, config) {
    if (config.trustProxy) {
        const forwarded = req.headers['x-forwarded-for'];
        if (forwarded) return String(forwarded).split(',')[0].trim();
    }
    return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

// ─── CORS ─────────────────────────────────────────────────────

// Returns the CORS headers for this request, or null when cross-origin
// access is not allowed. Same-origin requests never need them.
function corsHeaders(config, req) {
    const cors = config.cors || {};
    const origin = cors.origin;
    if (!origin || origin === false) return null;

    const requestOriginHeader = req.headers.origin;
    if (!requestOriginHeader) return null;

    const allowed = origin === '*' ? ['*'] : (Array.isArray(origin) ? origin : [origin]);
    if (!allowed.includes('*') && !allowed.includes(requestOriginHeader)) return null;

    const headers = {
        'Access-Control-Allow-Methods': cors.methods || DEFAULT_SECURITY.cors.methods,
        'Access-Control-Allow-Headers': cors.headers || DEFAULT_SECURITY.cors.headers,
        'Access-Control-Max-Age': String(cors.maxAge ?? DEFAULT_SECURITY.cors.maxAge),
        'Vary': 'Origin',
    };

    if (origin === '*') {
        headers['Access-Control-Allow-Origin'] = '*';
    } else {
        headers['Access-Control-Allow-Origin'] = requestOriginHeader;
        if (cors.credentials) headers['Access-Control-Allow-Credentials'] = 'true';
    }

    return headers;
}

// Adds CORS headers to a response without clobbering ones the app set.
function installCorsHeaders(res, headers) {
    if (!headers || !res || res.__azizCorsHeaders) return res;
    res.__azizCorsHeaders = true;
    return patchWriteHead(res, headers);
}

module.exports = {
    CONFIG_FILES,
    CSRF_COOKIE,
    CSRF_HEADER,
    CSRF_HEADER_OUT,
    DEFAULT_CSP,
    DEFAULT_SECURITY,
    SAFE_METHODS,

    loadConfig,
    mergeConfig,
    securityHeaders,
    installSecurityHeaders,
    installCorsHeaders,

    parseCookies,
    requestOrigin,
    originOf,
    isOriginAllowed,
    allowedOriginList,

    csrfEnabled,
    checkCsrf,
    createCsrfToken,
    csrfCookieHeader,
    timingSafeEqual,

    createRateLimiter,
    clientIp,

    corsHeaders,
};
