# ⚡ Aziz.js

**A lightweight Next.js-shaped framework** — file-based routing, global React hooks, server-side API routes, and ES module imports. Zero runtime dependencies, no bundler, no build step.

```bash
npx create-aziz-app my-app
```

> **Heads-up before you start:** after scaffolding you must run `npm install` in the new folder. Aziz.js compiles JSX with `@babel/standalone`, and until that is installed every page will fail to load and the router will show its built-in 404. The dev server prints a banner telling you exactly this.

---

## Table of contents

- [What this actually is](#what-this-actually-is)
- [Quick start](#quick-start)
- [Measured numbers](#measured-numbers-how-they-were-taken)
- [Aziz.js vs Next.js](#azizjs-vs-nextjs)
- [What Aziz.js is good at](#what-azizjs-is-good-at)
- [What Next.js is good at](#what-nextjs-is-good-at--when-to-use-it-instead)
- [The full guide: frontend → backend](#the-full-guide-frontend--backend)
  - [Phase 0 — Setup](#phase-0--setup)
  - [Phase 1 — Frontend fundamentals](#phase-1--frontend-fundamentals)
  - [Phase 2 — State and data](#phase-2--state-and-data)
  - [Phase 3 — Backend](#phase-3--backend)
  - [Phase 4 — Database](#phase-4--database)
  - [Phase 5 — Authentication](#phase-5--authentication)
  - [Phase 6 — Production](#phase-6--production)
- [API reference](#api-reference)
- [Security model — read this before deploying](#security-model--read-this-before-deploying)
- [Known limitations (read this)](#known-limitations-read-this)
- [Gotchas](#gotchas)
- [Troubleshooting](#troubleshooting)

---

## What this actually is

Aziz.js deliberately copies the **shape** of Next.js — `app/page.js` maps to `/`, `app/blog/[slug]/page.js` maps to `/blog/:slug`, `app/api/**/route.js` maps to `/api/**` — so the mental model transfers. But it implements that shape over a ~1,300-line custom runtime served straight to the browser as ES modules. There is no bundler, no compiler pipeline, no React dependency, and no server rendering.

It is a **client-side rendered (CSR) full-stack framework**. Everything renders in the browser after a ~13 KB gzip boot.

## Quick start

```bash
npx create-aziz-app my-app
cd my-app
npm install          # ← required; see the heads-up above
npm run dev
```

The CLI asks four things (these are the *actual* prompts in v3.1.2):

| Prompt | Default |
| --- | --- |
| 📁 Project name | `my-aziz-js-app` |
| 🌐 Dev server port | `3000` |
| Include documentation? | `Y` |
| 🎨 CSS Framework — 1 None / 2 Bootstrap / 3 Tailwind | `1` (none) |

Flags: `-y/--yes` (accept defaults), `--port <n>`, `--css none|bootstrap|tailwind`, `--no-docs`.

### What you actually get

```text
my-app/
├── index.html
├── package.json
├── app/
│   ├── layout.js        ← root layout (wraps every page)
│   └── page.js          ← route: /
├── styles/globals.css
├── _framework/          ← the runtime (7 files, ~1,350 lines)
├── scripts/dev-server.js
└── docs/                ← 14 markdown guides (unless --no-docs)
```

That is the whole template. There are **no** `components/`, `lib/`, `models/`, `api/` folders, no example pages, and no `not-found.js` — you create those yourself, and the rest of this guide shows you how.

---

## Measured numbers (how they were taken)

Every figure below was measured against this repository at v3.1.2 on Node v24.16.0, Windows, rather than estimated.

| Metric | Aziz.js | Next.js | Method |
| --- | --- | --- | --- |
| Browser payload per page | **42.5 KB raw / 12.7 KB gzip** | varies by app | Sum of `boot.js`, `runtime.js`, `hooks.js`, `router.js`, `route-match.js`, `api.js`, gzipped with zlib |
| Total runtime source | **46.8 KB raw / 14.0 KB gzip** (7 files, 1,348 lines) | — | All of `_framework/` |
| Dev server launch → first HTTP response | **161 ms** median (158/160/161/165/209 over 5 runs) | not measured here | Spawn process, poll until `/` returns |
| Runtime dependencies | **0** | **6** direct (`postcss`, `@next/env`, `styled-jsx`, `@swc/helpers`, `caniuse-lite`, `baseline-browser-mapping`) | npm registry metadata for `next@16.4.2` |
| Required peers | none | `react` + `react-dom` | registry |
| Dev dependencies | 1 (`@babel/standalone`) | varies | `package.json` |
| Installed size | **36.7 MB** for `@babel/standalone` (build-time only) | **183.6 MB** for `next` alone, + 7.7 MB `react-dom`, + 174 KB `react` | `dist.unpackedSize`, npm registry |
| Node requirement | works on Node 24 (no `engines` gate) | **>= 20.9.0** | registry |
| Bundling / minification | **none** | Turbopack, SWC, code splitting | — |

Honest caveats about our own numbers:

- **42.5 KB is unminified.** Aziz.js never minifies, tree-shakes, or code-splits. Your own app code is also served as-is. Gzip brings that 42.5 KB down to 12.7 KB; Brotli would shave roughly another 10–15% on top, not half.
- **`@babel/standalone` is 36.7 MB on disk.** It is a dev-time-only dependency and never reaches the browser, but if "zero dependencies" mattered to you for disk footprint, it does not. It is also the entire reason `npm install` is mandatory.
- **`react-dom` is 7.7 MB unpacked** but ships far less to the browser; the 183.6 MB for `next` is mostly platform binaries and build tooling.

---

## Aziz.js vs Next.js

### Capability comparison

| Capability | Aziz.js | Next.js |
| --- | --- | --- |
| File-based routing (`page.js`) | ✅ | ✅ |
| Layouts (`layout.js`) | ✅ | ✅ |
| Dynamic routes (`[slug]`) | ✅ | ✅ |
| Catch-all routes (`[...path]`) | ✅ | ✅ |
| API routes | ✅ both `api/x.js` and `app/api/**/route.js` | ✅ `app/api/**/route.js` |
| `NextResponse.json()` | ✅ | ✅ |
| Global hooks (no imports) | ✅ 11 hooks | ❌ must import from React |
| `Link` / `navigate()` / `useParams()` | ✅ | ✅ (requires import) |
| `@/` path alias | ✅ | ✅ (needs config) |
| WebSocket live reload | ✅ built in | ✅ Fast Refresh |
| Server-side rendering | ❌ **CSR only** | ✅ |
| Static generation (SSG) | ❌ | ✅ |
| React Server Components | ❌ | ✅ |
| Streaming / Suspense | ❌ | ✅ |
| TypeScript | ❌ **`.tsx` is silently ignored → 404** | ✅ first-class |
| Route prefetching | ❌ | ✅ |
| Image optimization (`next/image`) | ❌ | ✅ |
| Font optimization (`next/font`) | ❌ | ✅ |
| Metadata / OG image API | ⚠️ simple `metadata` export only | ✅ full API |
| Middleware / proxy | ❌ | ✅ |
| i18n routing | ❌ | ✅ built in |
| Edge runtime | ❌ | ✅ |
| Mature ecosystem & docs | ❌ small | ✅ enormous |
| Battle-tested at scale | ❌ | ✅ used in production by thousands |

### The three numbers people actually care about

Only the Aziz.js column was measured in this repo; the Next.js column is characterised, not benchmarked.

| | Aziz.js | Next.js |
| --- | --- | --- |
| Time to first page render in dev | **~161 ms** (measured) | Not measured here — must boot a compiler (Turbopack/SWC) before serving |
| JS downloaded before your app is interactive | **12.7 KB gzip** (measured) | Not measured here — React + React DOM + router ship first |
| `node_modules` on disk | **36.7 MB** (measured, one dev tool) | **~190 MB+** (measured, `next` + `react` + `react-dom` unpacked) |

---

## What Aziz.js is good at

Be genuinely enthusiastic about these, because they are real:

1. **Learning file-based routing without the ceremony.** You write `app/about/page.js` and it works. No `page.tsx`, no `'use client'` directive, no `import Link from 'next/link'`. Nothing to unlearn later — the conventions match Next.js exactly, so the skills transfer.
2. **Instant feedback loop.** ~161 ms from `npm run dev` to a working server. No compile step, no bundle, no HMR handshake. Edit and reload.
3. **Genuinely small client runtime.** 12.7 KB gzip to ship a router, a hooks implementation, a reconciler, and an API client.
4. **Zero runtime dependencies.** No React, no scheduler, no history library. `node_modules` for the runtime is empty.
5. **Readable source.** The entire browser runtime is ~1,350 lines across 7 files. When something breaks you can read the actual implementation instead of debugging a bundled dependency.
6. **Real full-stack in one process.** API routes, a file watcher, live reload over WebSocket, and static serving from one ~380-line Node script with no framework underneath.
7. **Good for prototypes, demos, internal tools, CLI-adjacent dashboards, and learning.**

## What Next.js is good at — when to use it instead

Aziz.js genuinely does not compete here. Use Next.js when:

1. **You need SEO or fast first paint.** Aziz.js ships an empty `<div id="root">` and renders in the browser. Search engine crawlers and slow devices see nothing until JS runs. This is the single biggest gap.
2. **You need SSR, SSG, ISR, or React Server Components.** None exist in Aziz.js.
3. **You need TypeScript.** `.tsx` is silently ignored by the route scanner — you get a 404 with no warning. Aziz.js is JS-only.
4. **You need streaming/Suspense** for progressive rendering.
5. **You need `next/image`, `next/font`, the Metadata API, or OG image generation.**
6. **You need middleware, edge runtime, or i18n routing.**
7. **You are building something large.** Route prefetching, code splitting, caching semantics, upgrade paths, and a hiring pool that already knows Next.js.
8. **You need security patches.** Next.js ships coordinated CVE responses (e.g. the September 2026 release addressing nine vulnerabilities). Aziz.js has one author.

**The honest one-liner:** Aziz.js is a teaching tool and a fast prototype rig. Next.js is a production platform. They overlap on syntax, not on capability.

---

## The full guide: frontend → backend

### Phase 0 — Setup

```bash
npx create-aziz-app my-app
cd my-app
npm install
npm run dev
```

Scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server + WebSocket live reload |
| `npm run build` | Serves with production cache headers, live reload disabled |
| `npm start` | Same as `build` |

Change the port with the `PORT` environment variable:

```bash
PORT=4000 npm run dev          # macOS / Linux
$env:PORT=4000; npm run dev    # Windows PowerShell
```

If the port is busy the server automatically tries the next one and prints the URL it actually bound.

### Phase 1 — Frontend fundamentals

**Pages.** Any `page.js` under `app/` becomes a route. No imports needed — JSX and all hooks are already global.

```jsx
// app/about/page.js  →  /about
export default function Page() {
    const [count, setCount] = useState(0);
    return (
        <div>
            <h1>About</h1>
            <p>Count: {count}</p>
            <button onClick={() => setCount(c => c + 1)}>+</button>
        </div>
    );
}
```

**Routing map:**

| File | URL |
| --- | --- |
| `app/page.js` | `/` |
| `app/about/page.js` | `/about` |
| `app/blog/[slug]/page.js` | `/blog/:slug` |
| `app/docs/[...path]/page.js` | `/docs/*` (one or more segments) |
| `app/not-found.js` | your custom 404 screen |
| `app/loading.js` | shown while this route's data loads |
| `app/error.js` | catches render errors in this route |

Directory names are **case-sensitive**. `app/MyPage/page.js` serves `/MyPage` only — `/mypage` will 404.

**Layouts** wrap every page beneath them:

```jsx
// app/layout.js
import Navbar from '/components/Navbar.js';

export default function Layout({ children }) {
    return (
        <>
            <Navbar />
            <main>{children}</main>
        </>
    );
}

export const metadata = { title: 'My App', description: 'Built with Aziz.js' };
```

A `metadata` export is honoured on layouts and pages. Only **`title`** and **`description`** are applied — layouts merge outermost-first and the page wins. Client-side only, so crawlers that do not execute JavaScript will not see it.

Nested `app/blog/layout.js` wraps only `/blog/*`. Layouts compose outermost-first, and the 404 screen also renders inside them.

**Components** are plain modules anywhere in the project. Use an absolute path or the `@/` alias:

```jsx
import Navbar    from '/components/Navbar.js';
import connectDB from '@/lib/db.js';
```

**Navigation.** Everything below is a global — no `next/navigation` import needed.

```jsx
// Declaring a link — client-side, the document never reloads
<Link href="/about">About</Link>
<Link href="/login" replace scroll={false}>Login</Link>

// Reading the current location
const pathname = usePathname();              // '/blog/hello'
const { slug }  = useParams();               // { slug: 'hello' }
const q         = useSearchParams().get('q');

// Navigating
navigate('/about');                          // push
replace('/login');                           // replace, no history entry
back(); forward(); refresh();

redirect('/dashboard');                      // from a component or effect

const router = useRouter();                  // { pathname, push, replace, back,
                                             //   forward, refresh, prefetch, params }
const nav = useNavigation();                 // { isPending, state, ...useRouter() }

// useTransition is the real Next.js hook (there is no useNavigation in Next.js
// itself — this one is provided for convenience and Next.js-like ergonomics).
const [isPending, startTransition] = useTransition();
```

`isPending` is `false` between transitions — Aziz.js routing is synchronous with no server round-trip to await. `prefetch()` is a safe no-op, kept for API parity (there is no prefetching to do). `startTransition` reports `isPending` while an **async** callback settles, so it composes with `useFetch` and data loading.

**Rendering your own 404 from a page** — call `notFound()`:

```jsx
// app/posts/[slug]/page.js
export default function Page() {
    const { slug } = useParams();
    const post = findPost(slug);
    if (!post) notFound();        // renders app/not-found.js
    return <h1>{post.title}</h1>;
}
```

**Custom 404.** Create `app/not-found.js` (or `app/404.js` — both names work):

```jsx
export default function NotFound() {
    return <div><h1>Page not found</h1><Link href="/">← Back to Home</Link></div>;
}
```

**Loading UI.** Create `app/loading.js` and it is shown while the route's data is still in flight:

```jsx
// app/loading.js
export default function Loading() {
    return <div className="skeleton">Loading…</div>;
}
```

Three things worth knowing, because they differ from Next.js:

1. **It only appears if the route is slow.** Page modules are all imported at boot, so a navigation has no module-fetch window — data fetching is the only async part. `loading.js` appears only if requests are still in flight **200 ms** after the route renders, then the page replaces it. Fast routes never flash a spinner.
2. **It inherits by segment,** exactly like layouts. `app/loading.js` covers every route; `app/blog/loading.js` overrides it for `/blog/*` only.
3. **No file means no spinner.** To turn it off for a page, simply delete the nearest `loading.js`. Do not add a magic `'no loading'` comment — absence of the file *is* the opt-out, and it matches Next.js.

**Error boundary.** Create `app/error.js` and render failures stop white-screening the app:

```jsx
// app/error.js — receives { error, reset }, same shape as Next.js
export default function ErrorBoundary({ error, reset }) {
    return (
        <div>
            <h2>Something broke</h2>
            <p>{error.message}</p>
            <button onClick={reset}>Try again</button>
        </div>
    );
}
```

It inherits by segment like `layout.js` and `loading.js`, so you can trap errors around one subtree without catching the whole app. Without an `error.js`, the error propagates and is logged — the framework does not silently swallow bugs.

### Phase 2 — State and data

All 11 hooks are global — no imports:

| Hook | Purpose |
| --- | --- |
| `useState` | local state |
| `useReducer` | complex state |
| `useEffect` | side effects / subscriptions |
| `useMemo` / `useCallback` | memoization |
| `useRef` | mutable refs |
| `useContext` / `createContext` | context |
| `useLocalStorage` | state persisted to `localStorage` |
| `useFetch` | data fetching with loading/error (aliased as `useApi`) |

```jsx
const [count, setCount] = useState(0);
const doubled = useMemo(() => count * 2, [count]);
const ref = useRef(null);
const [name, setName] = useLocalStorage('name', '');
```

`useFetch(url, options)` returns `{ data, loading, error, status, refetch }`:

```jsx
const { data, loading, error, status, refetch } = useFetch('/api/users');

if (loading) return <p>Loading…</p>;
if (error)   return <p>{error}</p>;   // error is a message string, not an Error
return <button onClick={refetch}>Retry — got {data.users.length}</button>;
```

**Context:**

```jsx
// components/Theme.js — createContext is global
export const ThemeContext = createContext('light');
```

```jsx
// app/page.js
const theme = useContext(ThemeContext);
```

**The API client** (`window.api`) is available without imports:

```js
const users = await api.get('/api/users');
await api.post('/api/users', { name: 'Aziz' });
```

### Phase 3 — Backend

API routes run in **Node**, not the browser. Two conventions are supported.

**Style A — classic `api/*.js` (CommonJS):**

```js
// api/users.js  →  /api/users
const { NextResponse } = require('../_framework/next-response');

async function GET(request) {
    return NextResponse.json({ users: [] });
}

async function POST(request) {
    const { name, email } = await request.json();
    return NextResponse.json({ created: true }, { status: 201 });
}

module.exports = { GET, POST };
```

**Style B — Next-style `app/api/**/route.js` (ESM):**

```js
// app/api/users/route.js  →  /api/users
import { NextResponse } from '../../../_framework/next-response.js';

export function GET() {
    return NextResponse.json({ users: [] });
}
```

> **Pick one module system per file.** Mixing `require()` with `export` fails: *"require is not defined in ES module scope"*.

**Dynamic API routes:**

```js
// api/users/[id].js  →  /api/users/:id
const { NextResponse } = require('../_framework/next-response');

async function GET(request) {
    return NextResponse.json({ id: request.params.id });
}
module.exports = { GET };
```

Params live on `request.params` — there is no second argument to the handler. Catch-all folders (`api/files/[...path].js`) work the same way, with the value as an array.

**The `request` object** gives you `json()`, `text()`, `url`, `method`, `headers`, `cookies`, `query`, and `params`.

A handler may also return a plain object or array and it will be serialized as JSON.

Handlers you can export: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.

### Phase 4 — Database

Server code under `lib/` and `models/` is `require`-able from API routes and is hot-reloaded on change.

```js
// lib/db.js
const mongoose = require('mongoose');

let cached = null;
async function connectDB() {
    if (cached) return cached;
    cached = mongoose.connect(process.env.MONGO_URI);
    return cached;
}

module.exports = { connectDB };
```

```js
// models/User.js
const mongoose = require('mongoose');
module.exports = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    name:  { type: String, required: true },
    email: { type: String, required: true, unique: true }
}));
```

```js
// api/register.js
const bcrypt   = require('bcryptjs');
const { connectDB } = require('../lib/db');
const User = require('../models/User');
const { NextResponse } = require('../_framework/next-response');

async function POST(request) {
    await connectDB();
    const { name, email, password } = await request.json();
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hash });
    return NextResponse.json({ id: user.id }, { status: 201 });
}

module.exports = { POST };
```

Any npm package works on the server — `npm install mongoose bcryptjs jsonwebtoken`, then import it normally. Client-side bare imports are rewritten to `/_modules/<pkg>` and served from `node_modules`.

### Phase 5 — Authentication

```js
// api/login.js
const jwt = require('jsonwebtoken');
const { NextResponse } = require('../_framework/next-response');

async function POST(request) {
    const { email, password } = await request.json();
    // …verify against your database…
    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return NextResponse.json({ token });
}
```

```jsx
// app/dashboard/page.js
export default function Page() {
    const [token, setToken] = useLocalStorage('token', '');
    const { data, loading, error } = useFetch('/api/me');
    if (!token)  return <p>Please log in.</p>;
    if (loading) return <p>Loading…</p>;
    if (error)   return <p>{error}</p>;
    return <h1>Welcome, {data.name}</h1>;
}
```

> **Do not use this for production auth.** API routes run unsandboxed Node with full filesystem access. There is no middleware layer, no CSRF protection, and no rate limiting. Add your own, or use Next.js with Auth.js.

### Phase 6 — Production

```bash
npm run build   # production cache headers, live reload disabled
npm start
```

`npm run build` is **not** a bundler. It does not minify, tree-shake, or code-split, and there is no build artifact — it starts the same Node server with production caching. Deploy as a long-running Node process and put a CDN in front of it. You must supply process-level concerns yourself: TLS, compression, rate limiting, logging, and monitoring.

---

## API reference

**Globals available in every page/component (no imports):**

`h`, `Fragment`, `api`, `Link`, `navigate`, `replace`, `back`, `forward`, `refresh`, `redirect`, `notFound`, `useRouter`, `usePathname`, `useParams`, `useSearchParams`, `useNavigation`, `useTransition`, `useState`, `useReducer`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useContext`, `createContext`, `useLocalStorage`, `useFetch`, `useApi`

---

## Security model — read this before deploying

Aziz.js has **no bundler**. Every module a page can import is served straight from disk as an ES module — that is exactly how `import User from '@/models/User'` works. It also means a file on disk is one HTTP request away, so the dev server enforces a boundary between *code the browser may import* and *everything else*.

**Never served** (HTTP 404, in both dev and production):

| Rule | Examples |
| --- | --- |
| Any dotfile or dot-directory | `.env`, `.env.local`, `.env.production`, `.git/config`, `.npmrc` |
| Project metadata | `package.json`, `package-lock.json`, `tsconfig.json`, `yarn.lock` |
| `node_modules/` | reachable only via `/_modules/<pkg>` |
| `server/` | your server-only modules |
| `data/` | flat-file persistence (sessions, users) |
| `*.server.js` / `*.server.mjs` / `*.server.jsx` | individually marked server-only |
| `scripts/` except `live-reload-client.js` | the dev server itself |

**Served normally:** anything under `app/`, `components/`, `models/`, `lib/`, `styles/`, `_framework/`, and `index.html`. `lib/` and `models/` are client-importable *by design*, so the framework cannot hide them.

> ### The one rule that matters
> **If a module is only ever used by an API route, move it into `server/` or rename it `*.server.mjs`.**
>
> ```js
> // BEFORE — reachable at /lib/auth-store.mjs
> export function createSession() { /* … */ }
> // AFTER  — 404s
> export function createSession() { /* … */ }
> ```
> ```js
> // api/login.js
> import { createSession } from '../server/auth-store.mjs';   // or ../lib/auth-store.server.mjs
> ```
> A leaked `.env` hands over your database password and JWT secret to anyone who requests it. Treat this convention as mandatory, not stylistic.

**What the framework does not protect against.** API routes run unsandboxed Node with full filesystem access. There is no CSRF protection, no rate limiting, no auth middleware, and no input validation layer. Add your own before going to production.

**Import styles:**

| Style | Example | Resolves |
| --- | --- | --- |
| Absolute | `import X from '/components/X.js'` | project root |
| Alias | `import X from '@/models/X'` | project root |
| Relative | `import X from './X.js'` | relative to the file |
| Bare | `import mongoose from 'mongoose'` | `/_modules/mongoose` → `node_modules` |

**Dev-server routes:**

| Path | Purpose |
| --- | --- |
| `/_framework/routes.json` | the generated page/layout/not-found manifest |
| `/api/**` | your API routes |
| `/_modules/*` | bare node_modules imports |
| any extensionless path | SPA fallback → `index.html` |

---

## Known limitations (read this)

Stated plainly, because a framework README that only lists strengths is marketing, not documentation.

1. **No server-side rendering.** The served HTML contains `<div id="root"></div>` and nothing else. Bad for SEO and slow first paint on poor connections.
2. **No static generation**, no ISR, no incremental regeneration.
3. **No React Server Components, no streaming, no Suspense.**
4. **TypeScript is not supported.** `.ts`/`.tsx` files are ignored by the route scanner — the route simply 404s with no warning. JS only.
5. **No bundler.** Nothing is minified, tree-shaken, or code-split. Large apps pay full cost on every page load.
6. **No route prefetching.** Every navigation re-fetches and re-renders.
7. **No image or font optimization.**
8. **No middleware/proxy layer**, no edge runtime, no i18n routing.
9. **No CSRF, rate limiting, or auth layer** — see [Security model](#security-model--read-this-before-deploying).
10. **No test runner or build pipeline** included.
11. **`@babel/standalone` is 36.7 MB** and is mandatory.
12. **Single-maintainer project** with no security-response process.
13. **Not battle-tested.** Use it for learning and prototypes; validate hard before production traffic.

## Gotchas

- **`lib/` and `models/` are public.** They must stay client-importable, so anything server-only in them is reachable over HTTP. Move those modules to `server/` or name them `*.server.mjs` — see [Security model](#security-model--read-this-before-deploying).
- **`/app/page.js` returning your code is expected.** With no bundler, page modules *are* the browser payload. That is not a leak; it is only compiled JSX with no secrets. The real leaks were `.env` and server-only modules, and both are now blocked.
- **Server routes need relative imports.** Inside `api/**` and `app/api/**`, `import … from '/_framework/next-response.js'` fails — those files run in Node, not the browser. Use `require('../_framework/next-response')` or a correct relative path.
- **A named ESM import does work** for `NextResponse`; you do not need the `const { NextResponse } = defaultImport` dance:
  ```js
  import { NextResponse } from '../../_framework/next-response.js';
  ```
- **Do not mix `require()` and `export`** in one API route file.
- **`.jsx` is supported for pages, layouts, API routes, `loading.js`, `error.js` and `404.js`.** The old manifest bug that hardcoded the `.js` path is fixed — the manifest now points at the real filename.
- **Directory names are case-sensitive.**
- **Catch-all routes must be the final segment** and require at least one segment.
- **Restart the dev server after `npm install`.** The Babel lookup happens once at process start and is never retried.
- **Pin `@babel/standalone` to `^7`.** Do not run a bare `npm install --save-dev @babel/standalone` on an existing project — that now resolves **v8**, whose default *automatic* JSX runtime conflicts with the classic `h()`/`Fragment` compilation this framework relies on. v3.1.2 works with either major, but the template pins `^7.0.0`; leave it alone unless you have tested it.
- **`useFetch` caches GET responses for 5 seconds.** Navigating away and back, or swapping `loading.js` out for a page, will not re-hit the API inside that window. Call `refetch()` to force it, or `clearFetchCache()` (global) to drop everything.
- **Known upstream issue on Windows:** Node's directory watcher can abort the whole process at startup with `Assertion failed: !_wcsnicmp(filename, dir, dirlen)` (from `src\win\fs-event.c`). It is a native assertion that `try/catch` cannot intercept. Measured on this machine: roughly **1 start in 8** on projects with nested subdirectories (e.g. `app/blog/[slug]`), and 0 in 5 on a flat project. It is **not** caused by `recursive: true` — a non-recursive watcher hits it too — so switching watcher strategy does not help. Just restart the dev server.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server dies instantly on Windows, `Assertion failed: !_wcsnicmp` | Node's native directory watcher (upstream bug) | Restart the dev server |
| 404 on **every** page | `npm install` was never run — JSX is served raw and the module import fails | `npm install`, then **restart** the dev server |
| 404 on one page only | File is not `page.js` (e.g. `index.js` or `page.tsx`) | Rename to `app/<route>/page.js` |
| 404 on a `server/`, `data/`, `.env` or `*.server.mjs` path | Working as intended — these are never served | Import them from an API route, not a page |
| A spinner flashes for a moment | A route crossed the 200 ms guard | Delete the nearest `loading.js` — absence is the opt-out |
| "JSX transform error" | Syntax error in a page or component | Fix the syntax; the message names the file |
| "Module not found" | Bare import not installed | `npm install <package>` |
| API route 404 | File not discovered, or `require`/`export` mixed | Check the `api/` or `app/api/` path and module style |
| Port already in use | The server auto-increments the port | Note the URL it prints, or set `PORT` |

---

**Author:** Syed Muhammad Aziz Ahmed
**License:** MIT