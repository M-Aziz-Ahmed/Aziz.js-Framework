# 02 · Project Structure

Every folder in a generated Aziz.js app, and what goes in it.

```
my-app/
|-- index.html              document shell (SSR injects #root + <head>)
|-- package.json            name, scripts, dependencies
|-- Dockerfile              production image (deps → build → runtime)
|-- .dockerignore           keeps the image context small
|-- i18n.js                 optional locale routing config
|-- middleware.js           optional auth/redirect hook
|-- aziz.config.js          optional security config (CSRF, CORS, rate limit)
|-- tsconfig.json           optional: `npm run typecheck` uses it
|-- types/                  global TypeScript declarations
|-- .aziz/                  build output (gitignored): static HTML + ISR cache
|--
|-- app/                    PAGES + LAYOUTS (file-based routing)
|   |-- layout.js           root layout, wraps every page
|   |-- page.js             route: /
|
|-- styles/                 CSS
|   |-- globals.css
|   |-- tailwind.css        optional: Tailwind source (--css tailwind)
|   `-- tailwind.output.css compiled locally (gitignored)
|-- tailwind.config.js      optional: Tailwind content/theme config
|
|-- _framework/             the framework itself (do not edit casually)
|   |-- runtime.js          h(), fibers, DOM materialization, hydration
|   |-- hooks.js            useState, useEffect, ...
|   |-- router.js           client router, Link, i18n, auto-prefetch
|   |-- route-match.js      path matching / layout collection
|   |-- metadata.js         metadata + Open Graph head tags
|   |-- suspense.js         createResource / use
|   |-- components.js       Suspense, Image, Font, Script
|   |-- api.js              browser API client (api.get, ...)
|   |-- next-response.js    NextResponse for API routes
|   |-- boot.js             SSR data seeding, globals, stream replacement
|
|-- scripts/                dev server + tooling
|   |-- dev-server.js       the HTTP server (dev + production, SSR/ISR)
|   |-- build.js            SSG/ISR build pipeline
|   |-- build-css.js        optional: compile Tailwind on demand
|   |-- typecheck.js        optional: run tsc --noEmit
|   |-- live-reload-client.js
|   `-- lib/                server renderer, module loader, page router,
|                           api-router, i18n, image/font optimizers,
|                           security (CSRF, rate limit, headers),
|                           tailwind build helper
|
`-- docs/                   these guides (optional, --no-docs to skip)
```


## The two "worlds"

Aziz.js runs code in two places. Confusing them is the #1 beginner mistake.

| | **Browser** (`app/`, `components/`) | **Server** (`api/`, `server/`) |
|--|-------------------------------------|-----------------------------------------|
| Runs in | the browser (after hydration) | Node.js |
| Module system | ES modules (`import` / `export`) | CommonJS (`require`) or `.mjs` ESM |
| Imports | `/…`, `@/…`, bare npm → `/_modules/…` | normal Node resolution |
| Framework | `h`, hooks, router, `api` client | same hooks + `NextResponse`, server renderer |
| Can touch | DOM, `window` | filesystem, DB, env vars, secrets |

- **Pages and components** run on the server for the first HTML response, then
  the same code hydrates in the browser.
- **API routes** are loaded by the server in Node and executed per request.
- **Server-only modules** live in `server/`, `data/`, or `*.server.js` and are
  never sent to the browser.

### Why API files use `require`

`api/*.js` files run in Node with the CommonJS loader, so you `require`:

```js
const { NextResponse } = require('../_framework/next-response');
```

If you prefer native ESM on the server, name the file `.mjs` and use `export`:

```js
// api/todos.mjs
import { NextResponse } from '../_framework/next-response.js';

export async function GET() {
    return NextResponse.json({ todos: [] });
}
```

Both styles are supported — see [API Routes](./06-api-routes.md).

## What the dev server does

`scripts/dev-server.js`:

1. Builds a **route manifest** by scanning `app/` and serves it at `/_framework/routes.json`.
2. Server-renders pages with layouts, metadata, streaming Suspense and hydration data.
3. Transforms **JSX** to `h()` calls on demand (cached by file mtime).
4. Resolves **bare npm imports** (`import mongoose from 'mongoose'`) via `/_modules/mongoose`.
5. Dispatches **API requests** to `api/**` and `app/api/**/route.js` (Node or edge runtime).
6. Serves static files, optimizes images/fonts and enforces the **server-only boundary**.
7. Compiles Tailwind to `styles/tailwind.output.css` when the generated app links it.
8. In development, opens a **WebSocket** and pushes reload events when you save.

## Conventions worth keeping

- **`app/`** is for pages and layouts only — not arbitrary components.
- **`components/`** is for reusable UI shared across pages.
- **`lib/`** for shared server/browser helpers; **`models/`** for data shapes.
- **`_framework/`** and **`scripts/`** are framework internals — prefer not to edit them, so upgrades stay easy.
- Names like `page.js`, `layout.js`, `route.js` are **reserved** by the file-based router. A `page.js` becomes a route; a random `utils.js` does not.

## Continue

→ [Pages & Layouts](./03-pages-and-layouts.md)
