# 12 · Production & Deployment

Aziz.js doesn't "bundle" to a huge build — it serves your source, compiles JSX on demand, and serves `/_modules/*` straight from `node_modules`. There's nothing to compile to a `dist/` directory.

## npm scripts

```json
{
  "scripts": {
    "dev":   "node scripts/dev-server.js",
    "build": "node scripts/dev-server.js --production",
    "start": "node scripts/dev-server.js --production"
  }
}
```

**Running with `--production` (or `NODE_ENV=production`) changes behavior:**

- **No WebSocket live reload** server/client — the client script becomes an empty no-op.
- **Cache headers**: HTML/JSON are `no-cache` (check ETag), most static assets get long-lived cache with `ETag` still checked.
- **No verbose "Browser connected" / watcher spam** in the logs.
- **Routes manifest still served** same way.

## Locally testing production

```bash
npm run build  # or npm start
# Server runs at http://localhost:3000 with production headers
```

Visiting `/_framework/routes.json` returns `"dev": false` in production.

## Deploying to a host

Any host that can run **Node.js 18+** works. Examples: Render, Railway, Fly.io, Hetzner, DigitalOcean, Vercel (with a custom Node server), or a VPS.

### 1) Prepare the project

```bash
cd my-app
npm ci        # clean install in CI/host
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
- Compression (gzip/brotli)
- Caching static assets aggressively
- Forwarding `X-Forwarded-For` / real IPs (the dev server doesn't trust proxy headers — treat as internal unless you add it)

Caddy example:

```txt
example.com {
  reverse_proxy localhost:3000
  encode zstd gzip
}
```

## Static hosting?

You **cannot** just drop `template/` into a static S3 bucket. API routes (`api/**` and `app/api/**/route.js`) run on the **Node server**. The browser needs the dev server to:

- serve transformed JS (JSX → h())
- serve the route manifest
- resolve bare imports via `/_modules/*`
- handle `/api/*`

If you want a 100% static site, you'd need a separate SSR/bundler — that's not what this lightweight framework does.

## Security notes

- **Path traversal**: the server confines all static file requests to the project root. Attempts to escape (e.g. `..%2f..%2fpackage.json`) return `403`.
- **API CORS**: preflight `OPTIONS` and responses include permissive CORS headers — tighten if you only serve from one origin.
- **JWT secrets**: never commit `.env`. Don't ship `node_modules` unnecessarily in git.
- **Dependencies**: only `@babel/standalone` in `devDependencies` (needed to transform JSX on-the-fly). Your own deps go in `dependencies`.
- **ETag**: conditional requests use strong-ish ETag based on `mtimeMs`+`size`; fine for this use case.

## What "production mode" doesn't do

- No code splitting / tree shaking
- No minification of JS/CSS (though you can pre-minify and reference extra files)
- No image optimization
- No prerendering/SSG
- No `.env` auto-loading (you must set environment variables)

This is by design for simplicity and speed. For most small–medium apps it's perfectly usable.

## Performance tips

- **Lean deps**: avoid pulling huge libraries unless needed (the `/_modules` transform isn't magic; it still ships bytes).
- **Memoize** in hooks (`useMemo`, `useCallback`) for expensive computations.
- **Keep keys stable** in lists (`key={id}`).
- **Use HTTP caching** via a proxy for immutable assets (`.woff2`, images) if you add them.
- **Close DB connections** or use a proper pool (the examples above do a singleton pool).

## Health check (optional)

You can hit `/api/hello` to quickly verify the server is up.

## Continue

→ [Internals](./13-internals.md)
