# 12 · Production & Deployment

Aziz.js doesn't "bundle" to a huge build — it serves your source, compiles JSX on demand, and serves `/_modules/*` straight from `node_modules`. There's nothing to compile to a `dist/` directory.

`npm run build` **does** precompile your modules, though: that is what keeps the
production server fast. See [Precompiled build output](#precompiled-build-output).

## npm scripts

```json
{
  "scripts": {
    "dev":   "node scripts/dev-server.js",
    "build": "node scripts/build.js",
    "start": "node scripts/dev-server.js --production",
    "css:build": "node scripts/build-css.js"
  }
}
```

**Running with `--production` (or `NODE_ENV=production`) changes behavior:**

- **Precompiled modules** from `.aziz/compiled` are used instead of compiling
  JSX on demand — the server never loads Babel.
- **Prerendered HTML** from `.aziz/static` is served first; ISR entries from
  `.aziz/cache/isr` are served stale-while-revalidate.
- **Hashed asset URLs** (`/_compiled/app/page.<hash>.js`) are served with
  `Cache-Control: public, max-age=31536000, immutable`.
- **Tailwind** is compiled to `styles/tailwind.output.css` during `npm run build`
  when the app links it. No CDN is involved.
- **Responses are compressed** (brotli or gzip) when the client accepts it.
- **Security headers** are added: `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`.
- **Streaming** stays on unless `AZIZ_STREAMING=0` (the build sets this for
  prerendering).
- **No WebSocket live reload** server/client — the client script becomes an empty no-op.
- **Cache headers**: HTML/JSON are `no-cache` (check ETag), most static assets get long-lived cache with `ETag` still checked.
- **No verbose "Browser connected" / watcher spam** in the logs.
- **Routes manifest still served** same way.

## Precompiled build output

`npm run build` compiles every module **once, at build time**, instead of on
every server start:

```
.aziz/compiled/
├── browser/app/page.<hash>.js    ESM, JSX stripped, imports → hashed URLs
├── server/app/page.js.cjs        CommonJS for the server renderer
└── manifest.json                 url ⇄ source map + dependency report
```

What that buys you, measured on a 300-page app:

| | runtime Babel | precompiled |
|---|---|---|
| first request after a deploy | 194 ms | 52 ms |
| median request | 2 ms | 2 ms |
| resident memory per worker | 80 MB | 62 MB |
| Babel in the production process | loaded | **never loaded** |

The hash is derived from the file's source, so a URL only changes when the
code changes — that is what makes `immutable` caching safe.

**Deploy `.aziz/compiled`.** It is build output, so it is git-ignored: either
run `npm run build` on the host, or build in CI and ship the `.aziz` directory
along with the source.

If `.aziz/compiled` is missing, the production server still works — it falls
back to compiling on demand and says so in the log.

## Dependency report (the no-bundler trap)

A framework without a bundler can only ship packages that work in a browser.
The build inspects every bare import and reports the two failure modes:

```txt
📦 3 browser dependencies: lodash@4.17.21, date-fns@4.1.0, zod@3.23.8
⚠️  CommonJS-only (no browser/ESM build) — these will fail in the browser:
     - moment: import it in an API route, or use a package with an ESM build.
❌ Missing dependencies: vue
```

- **Missing** → the build fails. Run `npm install` and build again.
- **CommonJS-only** → the build warns. A CommonJS package throws
  `require is not defined` in the browser; the fix is to use it from an API
  route (server-side) or pick a package with an ESM build.

## Compression

Text responses (HTML, JS, CSS, JSON, SVG) are compressed with brotli or gzip
when the client sends `Accept-Encoding`. No dependency, no configuration.
This matters more than usual here: without a bundler the browser downloads
dozens of small ES modules, and every one of them is compressible.

If a reverse proxy already compresses, it will simply pass through.

## Health check

```txt
GET /_aziz/health
```

```json
{
  "ok": true,
  "status": "healthy",
  "uptime": 42,
  "pid": 4711,
  "memory": { "rss": 62, "heapUsed": 21 },
  "precompiled": true,
  "babel": "not loaded"
}
```

`babel: "not loaded"` proves the production path never evaluated the
compiler. Use it as a readiness probe.

## Graceful shutdown

`SIGTERM`/`SIGINT` stop the listener, finish in-flight requests, and exit
with code 0. Systemd, Docker and Kubernetes all send `SIGTERM` before
killing, so a rolling deploy will not cut responses in half.

## Running several instances

A single process is fine for a small app. For more, run several instances
behind a proxy — they are stateless apart from the cache.

### Share the ISR cache

The ISR cache is the only runtime state. Point every instance at the same
directory (a mounted volume, an NFS/EFS share, a Kubernetes PVC):

```bash
AZIZ_CACHE_DIR=/data/aziz node scripts/dev-server.js --production
```

- **Writes are atomic** (temp file + rename), so an instance never reads a
  half-written entry.
- **Regeneration is locked** with a lock file, so one instance re-renders a
  stale page while the others keep serving the stale copy. A lock left behind
  by a crashed process is broken after 60 seconds.
- The prerendered pages from `npm run build` are *not* shared: they are
  identical on every instance, so they ship with the image.

### Or plug in your own cache

For Redis, Memcached or a KV store, set `AZIZ_CACHE_ADAPTER` to a module:

```js
// redis-cache.js
module.exports = {
    create({ isrCacheRoot }) {
        return {
            async readStatic(root, pathname) { /* … */ },
            async writeStatic(root, pathname, html, meta) { /* … */ },
            async readISR(root, pathname) { /* … */ },
            async writeISR(root, pathname, entry) { /* … */ },
        };
    },
};
```

```bash
AZIZ_CACHE_ADAPTER=/app/redis-cache.js node scripts/dev-server.js --production
```

The adapter's methods may be async. This seam is how you get a shared cache
without the framework taking a dependency on a client library.

## Docker

Every generated app ships with a `Dockerfile` and a `.dockerignore`:

```bash
docker build -t my-app .
docker run -p 3000:3000 my-app
```

The image is built in three stages:

1. **deps** — production dependencies only (`npm ci --omit=dev`).
2. **build** — `npm run build`, so the precompiled modules and the
   prerendered pages are baked in. The dev dependencies are then deleted.
3. **runtime** — the server, running as a non-root user, with **no
   `@babel/standalone` inside the image**.

The image sets `AZIZ_CACHE_DIR=/data/aziz` and declares `/data` as a volume,
so the ISR cache survives restarts. Mount the same volume on every replica to
share it. `HEALTHCHECK` polls `/_aziz/health`, so `docker ps` and orchestrators
know when the app is actually up.

## Continuous integration

A minimal pipeline for a generated app:

```yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: docker build -t my-app .
```

`npm run build` is the important step: it fails the build when a dependency is
missing, when a page cannot be prerendered, or when the JSX does not compile.

## Locally testing production

```bash
npm run build  # prerender static pages into .aziz/static
npm start      # serve at http://localhost:3000 with production headers
```

Visiting `/_framework/routes.json` returns `"dev": false` in production.

## Deploying to a host

Any host that can run **Node.js 18+** works. Examples: Render, Railway, Fly.io, Hetzner, DigitalOcean, Vercel (with a custom Node server), or a VPS.

### 1) Prepare the project

```bash
cd my-app
npm ci        # clean install in CI/host
npm run build # precompile + prerender (writes .aziz/)
```

### 2) Environment variables

Set anything your API routes need: `MONGODB_URI`, `JWT_SECRET`, `PORT` etc. The server reads `process.env.PORT`.

### 3) Start it

On the host, run:

```bash
NODE_ENV=production node scripts/dev-server.js
```

Or `npm start` if you prefer.

If the platform requires a specific `start` command and binds to `$PORT`, this is fine — the server already respects `process.env.PORT`.

### 4) Proxy / reverse proxy (optional but recommended)

Put Nginx, Caddy, or your load balancer in front for:

- HTTPS termination
- Caching static assets aggressively
- Forwarding `X-Forwarded-For` / real IPs (the dev server doesn't trust proxy headers — treat as internal unless you add it)

Compression is already handled by the server, so `encode` is optional.

Caddy example:

```txt
example.com {
  reverse_proxy localhost:3000
}
```

## Static hosting?

You **cannot** drop the whole project into a static bucket, because pages still
run through the Node server for hydration data, `api/**` and `app/api/**`
routes. But you can deploy the prerendered documents from `.aziz/static/` to a
CDN for fully static pages (no API routes, no dynamic params) while proxying
`/api/*` and `/_framework/*` to the Node server.

A fully static export is not a separate mode: `npm run build` produces real HTML
in `.aziz/static`, and `npm start` serves it with the runtime behind it.

## Security notes

- **Path traversal**: the server confines all static file requests to the project root. Attempts to escape (e.g. `..%2f..%2fpackage.json`) return `403`. Compiled assets are served from an allow-list built at build time, so `/_compiled/…` cannot be used to reach anything else.
- **API CORS**: preflight `OPTIONS` and responses include permissive CORS headers — tighten if you only serve from one origin.
- **JWT secrets**: never commit `.env`. Don't ship `node_modules` unnecessarily in git.
- **Dependencies**: `@babel/standalone` is a devDependency and is only needed to *build* now. Your own deps go in `dependencies`.
- **ETag**: conditional requests use strong-ish ETag based on `mtimeMs`+`size`; fine for this use case.

## What "production mode" doesn't do

- No code splitting / tree shaking
- No minification of JS/CSS (though you can pre-minify and reference extra files)
- No `.env` auto-loading (you must set environment variables)
- No multi-process clustering (run several instances behind a proxy)

**Production mode does do:** SSR, SSG/ISR (`npm run build` + `revalidate`),
streaming Suspense, server-rendered metadata, image resizing when `sharp` is
available (installed by default as an optional dependency), font preloads,
edge API routes, i18n routing, compression, hashed immutable assets and a
health endpoint.

## Performance tips

- **Lean deps**: avoid pulling huge libraries unless needed (the `/_modules` transform isn't magic; it still ships bytes).
- **Memoize** in hooks (`useMemo`, `useCallback`) for expensive computations.
- **Keep keys stable** in lists (`key={id}`).
- **Use HTTP caching** via a proxy for immutable assets (`.woff2`, images) if you add them.
- **Close DB connections** or use a proper pool (the examples above do a singleton pool).
- **Run the build in CI**: the precompiled output removes compile time from the request path entirely.

## Continue

→ [Internals](./13-internals.md)
