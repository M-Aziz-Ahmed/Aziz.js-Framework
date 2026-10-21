# Changelog

## [3.4.0]

### Added
- **Shared ISR cache for multi-instance deployments.** `AZIZ_CACHE_DIR` moves the ISR cache to a shared volume, so several instances behind a proxy regenerate a stale page **once** instead of once per instance. Cache writes are atomic (temp file + rename), so an instance never reads a half-written entry, and regeneration takes a lock file — one instance re-renders, the rest keep serving the stale copy. A lock left by a crashed process is broken after 60 s. The prerendered pages stay with the build: they are identical everywhere, so they ship in the image.
- **Pluggable cache adapter.** `AZIZ_CACHE_ADAPTER=/path/to/module.js` replaces the file cache with your own (Redis, Memcached, KV). The module exports `create(ctx)` → `{ readStatic, writeStatic, readISR, writeISR }`; the methods may be async. This is how you get a shared cache without the framework taking a dependency on a client library.
- **`Dockerfile` + `.dockerignore` in every generated app.** A three-stage image: production dependencies, a build stage that precompiles the app and prerenders the pages, and a runtime stage that runs as a non-root user **without `@babel/standalone` in the image**. `AZIZ_CACHE_DIR=/data/aziz` is set and `/data` is a volume, and `HEALTHCHECK` polls `/_aziz/health`.
- **CI pipeline** (`.github/workflows/ci.yml`): tests on Node 18/20/22/24, a build + smoke test that scaffolds an app, installs it, builds it and queries the production server, a `npm pack` check, and a job that builds and runs the Docker image.

### Changed
- The cache layer is now async (`readStatic`/`writeStatic`/`readISR`/`writeISR`) so an adapter can be async.
- Prerendered page HTML is kept in memory (invalidated by the manifest's generation timestamp) instead of being re-read from disk on every request.
- The scaffolder renames `package-lock.json` along with `package.json`, so `npm ci` never sees a mismatched lockfile.

## [3.3.0]

### Added
- **Precompiled production build.** `npm run build` now compiles every module **once, at build time** into `.aziz/compiled` instead of compiling JSX on every server start. The build produces two artifacts per file: a browser ESM module (JSX/TypeScript stripped, local imports rewritten to content-hashed URLs) and a CommonJS module for the server renderer. The production server loads those artifacts directly, so **Babel is never evaluated in production** — `GET /_aziz/health` reports `"babel": "not loaded"`. If `.aziz/compiled` is missing the server falls back to on-the-fly compilation and says so.
- **Content-hashed asset URLs.** The browser imports `/_compiled/app/page.<hash>.js`, served with `Cache-Control: public, max-age=31536000, immutable`. The hash comes from the source, so a URL only changes when the code does. Compiled assets are served from a build-time allow-list, so a crafted path cannot escape the compiled directory.
- **Dependency preflight.** The build inspects every bare import: a **missing package fails the build**, a **CommonJS-only package warns** (it cannot run in a browser — `require is not defined`). The no-bundler failure mode is now caught before deploy instead of after.
- **Response compression.** Brotli and gzip for text responses (HTML, JS, CSS, JSON, SVG) when the client sends `Accept-Encoding`. No dependency, no configuration.
- **Health endpoint.** `GET /_aziz/health` returns status, uptime, pid, memory, whether a precompiled build is loaded, and whether Babel was loaded.
- **Graceful shutdown.** `SIGTERM`/`SIGINT` stop the listener, finish in-flight requests and exit 0 — a rolling deploy no longer cuts responses in half.
- **Security headers** in production: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Request timeouts** (`requestTimeout` 30 s, `headersTimeout` 35 s, `keepAliveTimeout` 5 s) to blunt slowloris.
- **Tailwind is compiled locally** — the CDN is gone. `tailwindcss` is a dev dependency, `styles/tailwind.output.css` is built by `npm run dev`, `npm run build` and `npm run css:build`, and the dev server rebuilds it when watched files change.
- **`sharp` ships as an optional dependency**, so a normal `npm install` gives you image resizing by default.

### Fixed
- **The production server walked the whole project on every request.** `collectFontPreloads()` re-scanned `styles/` and `app/` and re-read every CSS file, and `loadManifest()` re-parsed the whole prerender manifest, for *every* request. On a 300-page app the median response was **43 ms**; it is now **1–2 ms**. The preload list and the manifest are cached (mtime-keyed) and invalidated on change.
- **`@babel/standalone` was loaded eagerly** at import time, costing ~64 MB of RSS in every process even when nothing needed compiling. It is now loaded lazily on the first actual transform.
- **`staticStore.clear()` deleted the whole `.aziz/` directory**, which would have removed build output. It now clears only the prerendered pages and the ISR cache.
- **The route manifest leaked absolute server paths** to the browser (`file: "C:\\...\\app\\page.js"`). Only `pathname`, `filePath` and `type` are sent now.
- **The metadata client selector was malformed** (`name="description"]`), throwing `SyntaxError: Failed to execute 'querySelector'` on every page load. It is now `meta[name="description"]`.
- The test scaffold linked `@babel`'s parent directory instead of the package, so scaffolded apps could not compile JSX — the tests only passed because the parent process supplied Babel.

### Numbers (300-page app, 302 modules)

| | before | after |
| --- | --- | --- |
| first request after a deploy | 194 ms | 52 ms |
| median request | 43 ms | 1–2 ms |
| resident memory per worker | 80 MB | 62 MB |
| Babel loaded in production | yes | never |

## [3.2.0]

### Added
- **TypeScript support.** `.ts` and `.tsx` are recognised for `page`, `layout`, `loading`, `error`, `not-found`/`404` and API routes (`route.ts`, `api/*.ts`). Types are stripped at transform time — there is still **no type checking**. Previously `.tsx` was silently ignored and the route 404'd with no warning.
- **`middleware.js`** in the project root, Next-parity: runs before page routes and API routes. Supports `NextResponse.next()`, `.redirect()`, `.json()`, `.rewrite()`, optional `config.matcher`, and receives `{ url, method, pathname, headers, cookies }`. Assets skip it.
- **`app/loading.js`** — shown while a route's data is in flight, inherited by segment like `layout.js`. Guarded by a 200 ms delay so fast routes never flash a spinner.
- **`app/error.js`** — error boundary, receives `{ error, reset }` (Next.js shape). Without one, render errors still propagate and are logged rather than being swallowed.
- **`app/404.js`** as an alias for `app/not-found.js`.
- **Full metadata API.** `openGraph`, `twitter`, `keywords`, `author`, `robots`, `themeColor`, `viewport`, `canonical`, and `{ default, absolute }` titles. Page metadata deep-merges over layout metadata.
- **Route prefetching.** Pages declare `export const prefetch = ['/api/x']`; `<Link prefetch>` (or `router.prefetch()`) warms those URLs into the fetch cache on hover/focus/touch.
- **Page-level data suspension.** `createResource(promise)`, `fetchResource(url)` and `use(resource)` let a page suspend instead of threading `loading`/`error` flags. The nearest `loading.js` becomes the fallback and the page re-renders when the data lands; a failed resource routes to `error.js`, or to a built-in error screen when none exists. Resources cache and never refetch on re-render, and lazy functions (`() => import(...)`) run once.
- **Next.js-style navigation globals:** `usePathname`, `useNavigation`, `useTransition`, `redirect`, `notFound`, `replace`, `back`, `forward`, `refresh`.
- `useFetch` response cache (5 s TTL) plus `clearFetchCache()`, so re-mounting a page does not refetch.

### Security
- **Fixed a critical file-exposure bug.** `.env`, `.env.local`, `.npmrc`, other dotfiles, `package.json`, lockfiles, `node_modules/`, `scripts/`, `server/`, `data/` and `*.server.*` were all served to the browser. They now return 404 in both dev and production. See the README's security model.
- **Also blocked `middleware.*`.** The new middleware feature holds JWT secrets and auth logic server-side; the file itself must never be fetchable.
- **Also blocked `app/api/**`.** API route *source* was served as a module. The routes themselves are reachable at `/api/**`, which is the only URL they should answer on.
- Documented the `server/` + `*.server.mjs` convention for server-only modules.

### Fixed
- A missing `@babel/standalone` silently served **raw JSX**, which failed in the browser and surfaced as a misleading built-in 404. It now fails loudly with a startup banner and a self-describing module error.
- `@babel/standalone` v8 (resolved by an unpinned `npm install --save-dev`) broke JSX compilation via its automatic runtime default. The transform now pins `runtime: 'classic'`, working with both v7 and v8.
- `not-found.jsx` pointed at a hardcoded `/app/not-found.js` that did not exist. The manifest now uses the real filename.
- `request.params` was silently empty for API routes documented with a second handler argument.
- `useApi` is documented as an alias of `useFetch`; `useFetch().error` is a string, not an `Error`.

### Known issues
- On Windows, Node's directory watcher can abort the process at startup with `Assertion failed: !_wcsnicmp` (native, uncatchable). ~1 in 8 starts on projects with nested subdirectories. Not caused by `recursive: true`; restart clears it.

## [3.1.0] - 2026

### Breaking Fixes (Behavioral Correctness)
- Runtime: `h()` now returns **lazy vnodes for ALL tags** (including string elements). This fixes eager materialization so nested components render with the correct context stack and providers wrap their descendants properly. ([context test covered])
- Runtime: `mountPage` and layout passing — components/contexts are materialized in correct top-down scope, ensuring `app/layout.js` receives `children`.

### Added
- Test suite: `tests/` with helpers (`dom.js`, `esm.js`), unit tests for `route-match`, `runtime`+`hooks`, `api.js` client, `js-transform`, `api-router` + `next-response`.
- Fixtures for API router (CJS + `.mjs`, dynamic + catch-all + app/api style).
- Regression tests for nested context, keyed sibling state, layout `children`, lazy vnode correctness.

### Changed
- Runtime (`runtime.js`): lazy vnode strategy, moved materialization to happen while component scope is on the path/counter stack.
- Hooks (`hooks.js`): `createContext`/`useContext` resolved during top-down materialization (no behavioral regressions). Effects still run on mount and are cleaned up on `disposeFibers()`.
- API client (`api.js`): `ApiError` with `status`, `data`, `url`; retries only on 5xx/429 with backoff; `timeout` via `AbortController`; `query` serialization (arrays, skip undefined); `raw()`/`head()`/`form()` helpers; `configure`/`setBaseURL`/`setHeaders`/`defaults`.
- `next-response.js`: `json/text/html/redirect/error`, `ok`, `ResponseCookies` (`set/delete/get`, multi `Set-Cookie`), instance helpers.
- `route-match.js`: correct catch-all prefix validation; `collectLayouts` / `matchesLayout` handle dynamic layouts.
- Dev server (`dev-server.js`): production mode (`--production`/`NODE_ENV=production`), `/_framework/routes.json` returns `{ dev, routes }`, ETag + 304, path-traversal confinement (403), prod cache headers, API route discovery/loading hardened, live-reload client neutralized in production.
- `api-router.js`: pattern matching (specificity), `app/api/**/route.js` + `api/**`, `.mjs` ESM loading, legacy `(req,res)`, `HEAD` fallback to `GET`, `OPTIONS` preflight, `405` with `Allow`, CORS, JSON parse errors → 400, `sendHandlerResult` supports NextResponse-like and plain values.
- Transforms (`js-transform.js`): whole-code robust `rewriteImports` (multi-line imports, side-effect, dynamic), `@/` alias, absolute/bare/node: preserved, mtime cache, Babel fallback resolution.
- CLI (`bin/create-aziz-app.js`): flags `-y/--yes`, `--port`, `--css`, `--no-examples`, `--no-api`, `--no-docs`, `-h/--help`; skips `node_modules`; docs optional; CSS injection; `.gitignore`.
- Template: added `app/not-found.js`, `app/blog/[slug]/page.js`, `app/contact/page.js`, `api/contact.js`; `components/Navbar.js` (Blog link + keys); `app/page.js` extra nav buttons; `index.html` rewritten; `template/package.json` scripts + `private`; `live-reload-client.js` uses host/proto.
- Moved libs to `template/scripts/lib`, removed root `scripts/`.

### Fixed
- No path traversal via encoded `..%2f` (403 in production/dev as configured).
- Import rewriting for multi-line named imports.
- Catch-all routes validate their literal prefix.
- Layout children passed through in the correct order (outermost→innermost).
- Effect cleanup runs on `disposeFibers()`; `fiber.mounted` guard prevents setState after unmount.
- `onDoubleClick` maps to `dblclick` event.
- Boolean attributes correct (present/removed).

## [3.0.0] - 2026 — Stable Release

### Breaking Changes
- Replaced `pages/` with `app/` directory (App Router style)
- Replaced `modules/` with `_framework/`
- `app.html` → `index.html`
- ES module `import/export` across browser code
- API routes run server-side (real Node.js backend)

### Added
- `app/layout.js`, `app/page.js`, nested layouts, dynamic (`[slug]`), catch-all
- `NextResponse`, named HTTP method exports, ESM bare imports, `@/` alias
- `useRouter`, `useParams`, `useSearchParams`, `<Link>`, `navigate()`
- WebSocket live reload
- All hooks: `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useReducer`, `useContext`, `useLocalStorage`, `useFetch`

### Removed
- Legacy `pages/`, `modules/`, `generate-imports.js`, `build.js`, `app.config.js`

## [2.0.15] - 2025
- CSS framework selection, interactive CLI prompts, auto-import system, dev server with file watching, `useState`, API routes, file-based routing with hash navigation.

## [1.0.0] - Initial Release
