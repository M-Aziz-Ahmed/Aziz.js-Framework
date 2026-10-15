# 02 · Project Structure

Every folder in a generated Aziz.js app, and what goes in it.

```
my-app/
├── index.html              ← entry point (loaded first, then the router takes over)
├── package.json            ← name, scripts, dependencies
│
├── app/                    ← PAGES + LAYOUTS (file-based routing)
│   ├── layout.js           ← root layout, wraps every page
│   ├── page.js             ← route: /
│   ├── not-found.js        ← custom 404 screen
│   ├── about/
│   │   └── page.js         ← route: /about
│   └── blog/
│       └── [slug]/
│           └── page.js     ← route: /blog/:slug  (dynamic)
│
├── api/                    ← SERVER-SIDE API ROUTES (Node.js)
│   ├── hello.js            ← /api/hello
│   └── users.js            ← /api/users
│
├── components/             ← shared UI components
│   ├── Navbar.js
│   └── Footer.js
│
├── lib/                    ← utilities, DB connections, helpers
│   └── db.js
├── models/                 ← data models / schema definitions
│   └── User.js
├── styles/                 ← CSS
│   └── globals.css
│
├── _framework/             ← the framework itself (don't edit casually)
│   ├── runtime.js          ← h(), fibers, DOM materialization
│   ├── hooks.js            ← useState, useEffect, …
│   ├── router.js           ← client router, Link, navigation
│   ├── route-match.js      ← path matching / layout collection
│   ├── api.js              ← browser API client (api.get, …)
│   ├── next-response.js    ← NextResponse for API routes
│   └── boot.js             ← boot sequence, exposes globals
│
├── scripts/                ← dev server + tooling
│   ├── dev-server.js       ← the HTTP server (dev + production)
│   ├── live-reload-client.js
│   └── lib/                ← js-transform, module-resolver, api-router
│
└── docs/                   ← these guides (optional, --no-docs to skip)
```

## The two "worlds"

Aziz.js runs code in two places. Confusing them is the #1 beginner mistake.

| | **Browser** (`app/`, `components/`) | **Server** (`api/`, `lib/`, `models/`) |
|--|-------------------------------------|-----------------------------------------|
| Runs in | the browser | Node.js |
| Module system | ES modules (`import` / `export`) | CommonJS (`require`) or `.mjs` ESM |
| Imports | `/…`, `@/…`, bare npm → `/_modules/…` | normal Node resolution |
| Framework | `h`, hooks, router, `api` client | `NextResponse`, `require('../_framework/…')` |
| Can touch | DOM, `window` | filesystem, DB, env vars, secrets |

- **Pages and components** are compiled (JSX → `h()` calls) and sent to the browser.
- **API routes** are loaded by the dev server in Node and executed per request.

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
2. Transforms **JSX** to `h()` calls on demand (cached by file mtime).
3. Resolves **bare npm imports** (`import mongoose from 'mongoose'`) via `/_modules/mongoose`.
4. Dispatches **API requests** to `api/**` and `app/api/**/route.js`.
5. Serves static files, with **path-traversal confined to the project root** (403 otherwise).
6. In development, opens a **WebSocket** and pushes reload events when you save.

## Conventions worth keeping

- **`app/`** is for pages and layouts only — not arbitrary components.
- **`components/`** is for reusable UI shared across pages.
- **`lib/`** for shared server/browser helpers; **`models/`** for data shapes.
- **`_framework/`** and **`scripts/`** are framework internals — prefer not to edit them, so upgrades stay easy.
- Names like `page.js`, `layout.js`, `route.js` are **reserved** by the file-based router. A `page.js` becomes a route; a random `utils.js` does not.

## Continue

→ [Pages & Layouts](./03-pages-and-layouts.md)
