# 16 · Security

Aziz.js ships with the defences that are easy to forget and expensive to miss:
CSRF validation, a rate limit, same-origin CORS, and a security header set on
every response. All of it is on by default and configured from one optional
file.

What the framework does **not** do is decide who your users are. Authentication
and authorization are application problems — see
[Authentication](./11-authentication.md).

## The short version

```js
// aziz.config.js — optional. Without it, these are the defaults.
module.exports = {
  security: {
    csrf: 'origin',            // 'origin' | 'strict' | false
    cors: { origin: false },   // false | '*' | 'https://app.example.com'
    rateLimit: { windowMs: 60_000, max: 300 },
    trustProxy: false,
    headers: { /* override or remove any default header */ },
  },
};
```

The server prints its posture at startup:

```
🔒 CSRF: origin · CORS: same-origin only · Rate limit: 300/60s per IP
🛡️  Security headers: Content-Security-Policy, X-Content-Type-Options, …
```

## CSRF

A cross-site request forgery is a page on `evil.example` making the browser
send a request to your API with the user's cookies attached. The server cannot
tell that request from a legitimate one by looking at the body, so it looks at
where the request came from.

Aziz.js checks three things on every state-changing request (`POST`, `PUT`,
`PATCH`, `DELETE`):

| Signal | Meaning |
|---|---|
| `Sec-Fetch-Site` | `cross-site` → blocked outright |
| `Origin` | must be your own origin, or an origin you allow-listed |
| `Referer` | checked when `Origin` is absent |

Safe methods (`GET`, `HEAD`, `OPTIONS`) are never blocked.

A request with **no** `Origin`, no `Referer` and no `Sec-Fetch-Site` is not
coming from a browser — `curl`, a mobile app, another server — so it is
allowed. Browsers always send at least one of those headers.

### strict mode

`'origin'` covers browsers. `'strict'` adds a **double-submit token** for
defence in depth:

1. Every document response sets a `__aziz_csrf` cookie (readable by
   JavaScript, `SameSite=Lax`).
2. The client sends the cookie value back in the `X-Aziz-CSRF` header. The
   framework's own client does this for you — `window.fetch` is patched once,
   so `api.post()`, `useFetch()`, `fetchResource()` and your own `fetch()`
   calls all send it.
3. The server compares the two with a timing-safe compare.

A cross-site attacker can neither read the cookie nor set the header, so the
request fails even if `Origin` were somehow spoofed.

```js
// aziz.config.js
module.exports = { security: { csrf: 'strict' } };
```

In strict mode a request from your own page that forgot the header gets a
`403` with a message telling you exactly what to send. A server-side render
calling its own API is not a browser and is not asked for a token.

### Turning it off

```js
module.exports = { security: { csrf: false } };
```

Only do this if another mechanism protects the route (a bearer token in the
`Authorization` header, for example).

## CORS

By default the API sends **no** `Access-Control-Allow-Origin` header, which
means a browser on another origin cannot call it. Same-origin requests are
unaffected.

To allow another origin, list it:

```js
module.exports = {
  security: {
    cors: {
      origin: ['https://app.example.com', 'https://admin.example.com'],
      credentials: true,   // sends Access-Control-Allow-Credentials
    },
  },
};
```

`origin: '*'` is allowed but refuses to send credentials, and is worth a second
thought in production: any site can then call your API from a browser.

`cors.methods`, `cors.headers` and `cors.maxAge` tune the preflight response.
`X-Aziz-CSRF` is already in the allowed-headers list.

## Rate limiting

Every request to `/api/**` is counted per client IP in a fixed window:

```js
module.exports = {
  security: {
    rateLimit: { windowMs: 60_000, max: 300 },
  },
};
```

Over the limit, the response is `429` with a `Retry-After` header:

```json
{ "error": "Too Many Requests", "retryAfter": 42, "limit": 300, "windowMs": 60000 }
```

Every API response also carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`
and `X-RateLimit-Reset`.

The counter is per process. Behind more than one instance, each instance
enforces its own limit — put a shared limiter in front if you need a global
one.

`trustProxy` is `false` by default, so `X-Forwarded-For` is ignored and the
socket address is used. Turn it on only behind a proxy that overwrites the
header:

```js
module.exports = { security: { trustProxy: true } };
```

## Security headers

Every response — HTML, API, static file, redirect, 404, 500 — carries:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'` plus the allowances the framework needs |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation and payment off |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `X-XSS-Protection` | `0` (the modern recommendation) |
| `Strict-Transport-Security` | production only, `max-age=31536000; includeSubDomains` |

Override or remove any of them:

```js
module.exports = {
  security: {
    headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.example.com",
      'X-Frame-Options': null,   // null removes the header
    },
  },
};
```

A header you set yourself always wins over the default.

> **The CSP allows `'unsafe-inline'` for scripts.** The framework ships
> hydration and live reload as inline scripts, so a strict policy would break
> the page. If you serve only pre-rendered HTML from a CDN, tighten it.

## What stays on the server

Because there is no bundler, every importable module is served from disk. The
server enforces the boundary, and these are never served — in development and
in production:

| Rule | Examples |
|---|---|
| Dotfiles | `.env`, `.env.local`, `.npmrc`, `.git/config` |
| Project metadata | `package.json`, `package-lock.json`, `tsconfig.json` |
| Server hooks | `middleware.js`, `aziz.config.js` |
| API route source | `app/api/**` (the routes live at `/api/**`) |
| Server-only directories | `server/`, `data/` |
| Server-only modules | `*.server.{js,mjs,jsx,ts}` |
| Build output | `.aziz/` |
| Dev server internals | `scripts/` except `live-reload-client.js` |

`lib/` and `models/` stay public **by design**, so
`import User from '@/models/User'` keeps working. Put anything secret in
`server/` or name it `*.server.mjs`.

## What is still your job

- **Authentication and authorization.** There is no built-in user store, session
  store or JWT helper. Use `middleware.js` as the guard — see
  [Authentication](./11-authentication.md).
- **Input validation.** The framework parses JSON bodies and query strings; it
  does not know which fields your schema allows.
- **File uploads.** Nothing is scanned, sized or sniffed for you.
- **Query safety.** The framework never builds SQL. Parameterise it.
- **Secrets.** Keep them in environment variables, never in `lib/`.

## Continue

→ [Server Rendering, SSG, ISR, Streaming, Images & i18n](./15-server-rendering-ssg-streaming.md)
