# 13 · Internals

This document explains **how Aziz.js actually works**. It's written for readers who want to understand (and maybe debug) the runtime. You don't need to read it to use the framework.

## High-level architecture

Aziz.js is three distinct things glued together:

1. **Dev server** (`scripts/dev-server.js`) — Node HTTP server. Scans `app/`, serves manifest, transforms JSX, resolves `/_modules/*`, dispatches `/api/*`, serves static files, provides WebSocket live reload.
2. **Browser runtime** (`_framework/`) — runs in the page. `boot.js` exposes globals, initializes hooks, and calls the router. The router loads the manifest, imports pages/layouts, and mounts them into `#root` via `runtime.js`.
3. **Transform pipeline** (`scripts/lib/js-transform.js`) — runs on demand: `@babel/standalone` compiles JSX to `h()` calls; import rewriting maps `@/`, bare npm packages, and absolute paths to browser-servable URLs; results are **mtime-cached** per file.

## Rendering model (lazy vnodes)

The core idea: **everything is a lazy vnode descriptor, not an immediate DOM element**.

- `h(tag, props, ...children)` returns `{ [VNODE]: true, type, props, children }`.
- `type` can be a string (`'div'`), a function (component), `Fragment` symbol, or (rarely) an existing `Node`.
- `materialize(node)` walks the tree and **turns descriptors into real DOM** top-down.
- `createElement(tag, props, kids)` only runs when materializing a **string-type vnode** — so nested components don't materialize until their parent/ancestor materializes them. This is the key to getting **context propagation correct** and keeps hook fibers stable.

The runtime header literally states this: "Descriptors are executed top-down when they are attached to the DOM."

## Fibers & component identity

To support hooks per component instance, Aziz.js uses a lightweight **fiber** per mounted component instance.

- Each component call is a "materialization". `materializeComponent()` computes a **stable path id** based on the current render path + a counter or `key`.
- The id looks roughly like `page:/about>About@k:1>Form@i:1`.
- `getFiber(id)` returns `{ id, hooks: [], mounted: true }` — created on first render, reused on subsequent renders of the same instance.
- `useState/useEffect/etc.` read/write `currentFiber.hooks[hookIndex++]`.
- `disposeFibers()` runs every route change: it marks fibers as unmounted, **executes any pending effect cleanups** for hooks that registered them, then clears the whole `fibers` Map. This prevents memory leaks and stale effects.
- `beginRender(base)` resets the path/counters for a new mount pass.

Why keying matters: with `{ key }` you can tell the runtime "this is a different instance" vs "the same instance moved". In a list, giving stable keys preserves hook state for re-ordered items. The code still works without keys, but using `key` is the right thing to do for dynamic lists.

## Hooks implementation

`hooks.js` owns:

- `currentFiber` and `hookIndex` (threaded through `prepareHooks`/`finishHooks`).
- All hooks as plain functions that access the module's current fiber.
- `ctxStack` to support `createContext`/`useContext` during render.
- `scheduleRender()` — defers `window.__rerenderPage()` to a `requestAnimationFrame` (with a 120ms fallback). `renderScheduled` coalesces multiple `setState` calls into one paint.

Hooks details:

- `useState` stores `{ value }`. `setState` bails if the next value is the same (by reference/equality) and **guards `fiber.mounted === false`** — you can't set state on an unmounted component.
- `useEffect` compares dependency arrays by reference (`!== prev.deps?.[i]`). It **schedules the effect** via `queueMicrotask()` and only runs if still `fiber.mounted !== false`. Cleanup is stored in the same hook slot and re-run before re-executing the effect.
- `useContext` walks `ctxStack` from top → bottom (`i >= 0`) to return the nearest provider's value. If none found, falls back to `ctx._defaultValue`.
- `ContextProvider` pushes `{ ctx, value }`, calls `materializeChildren(props.children)` (injected by `runtime.js`), then pops — so providers need to control the materialization of their subtree. The runtime sets `setMaterializer(materialize)` so providers render children while the context is active.
- `useLocalStorage` uses `localStorage` with `try/catch` (quota/availability) and listens for `storage` events to sync across tabs.
- `useFetch` aborts previous in-flight requests, parses JSON/text appropriately, and ignores `AbortError`.

**Hooks must only be called while rendering a component.** Calling outside throws.

## Materialization walk (conceptually)

1. `mountPage(Page, layouts, container, base)` builds `tree = h(Page, {})` wrapped by each layout from inner→outer: `h(Layout, { children: tree })`.
2. `materialize(tree)` returns `Node | Node[] | null`. If it's a vnode and `type === function`, `materializeComponent` runs.
3. `materializeComponent` pushes path → computes id → gets fiber → `prepareHooks` → calls `type({...props, children})` → `finishHooks` → `materialize(output)` → pops path → returns nodes.
4. For string elements, `createElement` creates `document.createElement(tag)`, `applyProps`, then `appendNodes(el, materialize(kids))` — so children are materialized **immediately**, but only because the element vnode itself is being materialized top-down.
5. `applyProps` handles `ref` (function or object), `class`/`className`, `htmlFor`, `style` object/string, `dangerouslySetInnerHTML`, `value`/`checked` for inputs, `onClick`/`onDoubleClick`/etc. (with `dblclick` alias), boolean attributes (sets/removes attribute), and other attributes.

## Router internals

- Maintains `routes` (path → module), `layouts` (`[{ path, module }]`), `notFoundModule`, `dev`, `currentParams`, `_lastPathname`.
- `loadRoutes()` fetches `/_framework/routes.json`, then `import(url)`s each `filePath` (adds cache-bust `?t=Date.now()` in dev).
- `render()` normalizes pathname, calls `disposeFibers()` if route changed (cleanups + clear state), resolves route via `route-match.js`, collects layouts, applies metadata (outer→inner, page wins for title), captures/restores focus, `mountPage`, adjusts scroll (top on new route, restore on same).
- `Link` intercepts click only for left-button, no modifiers, same-origin non-hash non-mailto.
- `useSearchParams` builds a new `URLSearchParams` object each time it's called (it's small).

`route-match.js` does the heavy lifting: `matchRoute`, `specificity`/`compareSpecificity`, `resolveRoute`, `collectLayouts`. It treats `[...path]` as a prefix match with required suffix (length >= prefix). `matchesLayout` compares split paths segment by segment and allows dynamic segments to match a concrete path.

## API system

### Discovery

`discoverApiFiles(ROOT)` finds:

- `app/api/**/route.js` or `.mjs` → pattern is the folder path under `/api` (e.g. `app/api/users/[id]/route.js` → `/api/users/[id]`)
- `api/**/*.js` or `.mjs` → `/api/<relative path>` with extension removed (e.g. `api/users/[id].js` → `/api/users/[id]`)

Discovered routes are scored and sorted by `compareSpecificity` (static count desc, dynamic asc, catch-all asc, depth desc) so the best match wins.

### Loading

- `.mjs` → dynamic `import()` with cache-buster
- `.js` → `require()` (delete from cache first on reload), with fallback to `import()` if Node reports `ERR_REQUIRE_ESM` (handle mixed ESM)
- `normalizeHandlers(mod)` accepts: CJS `{ GET, POST }` / ESM named exports / ESM `default { … }` / function → legacy `(req, res)`

### Request building

`buildRequest(req, params, rawBody, port)`:

- builds `URL(req.url, base)` → exposes `nextUrl`, `query` (URLSearchParams)
- parses cookies from `Cookie` header
- lazy-parses `application/json` body; `request.json()` re-parses on demand and throws `SyntaxError` with `status = 400` on invalid
- `request.formData()` supports `application/x-www-form-urlencoded` → object
- exposes `params`, `headers`, `rawBody`

### Response sending

`sendHandlerResult(result, res, { headOnly })`:

- `undefined`/`null` → `500` with hint
- `string` → `200` + `text/plain`
- response-like (has `body` or `status`+`headers`) → preserves `status`, copies headers, sends body unless `HEAD`
- plain object/array → `200` + `application/json`

CORS headers are added to all API responses.

## Module resolution (browser bare imports)

`/_modules/<specifier>` requests are handled by `scripts/lib/module-resolver.js` → `resolveNodeModule(specifier, ROOT)`.

- Splits `specifier` into package + subpath
- Looks in `node_modules/` (project root)
- Reads `package.json` of the package
- Honors `exports` field if present: checks `"browser"`, `"module"`, `"main"` in that order when mapping to a file
- Falls back to `browser`/`module`/`main` fields
- Resolves relative `./…` subpaths
- Returns the final absolute filesystem path, or `null` if not found

The dev server reads that file and runs `transformModule` (JSX transform skipped for framework, but bare modules usually contain no JSX; imports inside that module also get rewritten if they're from your app tree? No — the module being served is an npm package file; `transformModule` detects `isFrameworkPath`? Framework files are under `/_framework/` — npm packages are under `node_modules/`, so `isFrameworkPath` is false for them, but Babel will run; many packages don't use JSX. Import rewriting inside that served package's code would rewrite its own imports — but rewriting is correct because it's being served to the browser. The transform is idempotent-ish.

## Transform cache

`transformModule(code, filePath, mtimeMs)`:

- returns cached code if `hit.mtimeMs === mtimeMs`
- skips JSX transform for files whose path includes `/_framework/`
- otherwise compiles with Babel React preset (`pragma: 'h'`, `pragmaFrag: 'Fragment'`)
- always runs `rewriteImports` after
- stores `{ mtimeMs, code }`

Invalidated on file change by the watcher.

## Live reload

- Development only. `server.on('upgrade')` upgrades HTTP → WS, uses a minimal control-frame (no text message parser needed — just accepts the protocol and can send a 1-byte-ish ping/reload; it sends `reload` as a text frame by writing the header+payload for a single-frame text message `0x81 <len> ...`).
- Watcher monitors: `app`, `api`, `components`, `lib`, `models`, `styles`, `_framework` recursively. Ignores non-JS/JSX/CSS/JSON extensions for the "changed" signal.
- When a change happens: invalidate transform cache for that file; if the file was under `api/`, `lib/`, or `models/`, **reload API routes** (purge project require cache, `loadApiRoutes`) and then notify clients; otherwise just notify clients. Reloading API routes after `lib/`/`models/` changes means `require()` sees fresh code.
- In production, the live-reload client file (`/scripts/live-reload-client.js`) is replaced by an empty stub.

## Path traversal guard

When serving static files (anything that's not `/_modules/*`, `/_framework/routes.json`, or API), the server:

```js
const resolved = path.resolve(ROOT, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded));
const rootResolved = path.resolve(ROOT);
if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
}
```

This prevents `../` from escaping the project directory. The check is done after `decodeURIComponent` but before `fs.statSync`.

## What's not "done" (by design)

- No bundler. JSX is transformed on demand and CSS is served as files (with
  `@font-face` optimization).
- Pages are server-rendered and hydrated. SSG/ISR is a separate
  `scripts/build.js` pass into `.aziz/`; it is not a module-graph bundler.
- No `.env` loader in the server (just `process.env`).
- No type checking (types are stripped by Babel).

## Tips for debugging

- Check `/ _framework/routes.json` for manifest accuracy.
- Read the server logs: API load summary, transform errors, 403/404s.
- In the browser console, `window.__azizDev` shows `dev` mode, `window.__azizReady` is `true` after boot.
- `api.defaults` reveals effective baseURL/timeout/retries.
- Network tab: see `/_modules/*` requests and transformed JS.
- For state bugs, console log in hooks? The source is short and readable.

## Wrap-up

The runtime is deliberately small: `h` + materialize (top-down, lazy), fibers + hooks (module-level state), a context stack, a file-based router. It's "React-like" in behavior for the bits it supports, and "Next.js-like" for the developer surface (`app/`, `api/`, layouts, hooks) — but cuts out the build tooling and ceremony.
