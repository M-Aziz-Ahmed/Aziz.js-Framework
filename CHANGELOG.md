# Changelog

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
