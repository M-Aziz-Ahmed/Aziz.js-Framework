// ============================================================
//  Aziz.js — security configuration (optional)
//
//  Everything here is already the default. This file exists so you
//  can see what can be changed, and change it in one place.
//
//  It is never served to the browser.
// ============================================================

module.exports = {
    security: {
        // ─── CSRF ───────────────────────────────────────────────
        // 'origin'  → validate Origin / Referer / Sec-Fetch-Site on
        //             POST, PUT, PATCH and DELETE. (default)
        // 'strict'  → the above, plus a double-submit token: the server
        //             hands the browser a __aziz_csrf cookie and the
        //             client echoes it back in the X-Aziz-CSRF header.
        //             The bundled client does this for you.
        // false     → no CSRF checks. Only safe if another mechanism
        //             (a bearer token, say) protects the route.
        csrf: 'origin',

        // ─── CORS ───────────────────────────────────────────────
        // false → same-origin only: no Access-Control-Allow-Origin is
        //         sent, so another origin cannot call your API.
        // '*'   → allow any origin (never sends credentials).
        // list  → allow specific origins.
        cors: {
            origin: false,
            // credentials: true,   // also send Access-Control-Allow-Credentials
            // methods: 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
            // headers: 'Content-Type, Authorization, X-Aziz-CSRF',
            // maxAge: 600,
        },

        // ─── Rate limiting ──────────────────────────────────────
        // Per client IP, on /api/**. Over the limit you get 429 with a
        // Retry-After header.
        rateLimit: {
            enabled: true,
            windowMs: 60_000,
            max: 300,
        },

        // ─── Proxy ──────────────────────────────────────────────
        // X-Forwarded-For is attacker-controlled unless a proxy you
        // trust overwrites it. Leave this off behind an unknown proxy.
        trustProxy: false,

        // ─── Response headers ───────────────────────────────────
        // Override any default, or set one to null to remove it.
        // headers: {
        //     'Content-Security-Policy': "default-src 'self'",
        //     'X-Frame-Options': null,
        // },
    },
};
