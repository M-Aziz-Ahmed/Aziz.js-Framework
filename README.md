# ⚡ Aziz.js

**A Next.js-shaped framework with zero runtime dependencies.** File-based routing, TypeScript, global hooks, SSR + hydration, SSG/ISR, streaming Suspense, server-side API routes and middleware — served as ~20 KB gzipped of ES modules, no bundler.

```bash
npx create-aziz-app my-app
cd my-app
npm install     # ← required, see below
npm run dev
```

> **`npm install` is not optional.** JSX is compiled by `@babel/standalone`. Until it is installed, every page fails to load and you get the built-in 404. The dev server prints a banner telling you so.

---

## Contents

**Learn it**
- [Why](#why) · [Numbers](#numbers) · [Vs Next.js](#vs-nextjs) · [When *not* to use it](#when-not-to-use-it)

**Build with it**
- [Routing](#routing) · [Layouts](#layouts) · [Loading & errors](#loading--errors) · [Hooks](#hooks) · [Navigation](#navigation) · [Metadata](#metadata) · [Middleware](#middleware) · [API routes](#api-routes) · [Prefetching](#prefetching)

**Operate it**
- [Project layout](#project-layout) · [Security model](#security-model) · [Limitations](#limitations) · [Troubleshooting](#troubleshooting)

---

# Learn it

## Why

Next.js conventions without Next.js overhead. You already know the mental model, so there is nothing to unlearn.

| | Aziz.js | Next.js |
| --- | --- | --- |
| Dev server → serving | **161 ms** measured | compiler must boot first |
| JS before your app runs | **19.6 KB gzip** | React + React DOM + router |
| `node_modules` | **36.7 MB** (1 build tool) | **~190 MB+** |
| Runtime dependencies | **0** | react + react-dom + 6 |
| `import` needed for hooks | **no** | yes |
| TypeScript | ✅ `.ts` / `.tsx` | ✅ |
| Middleware | ✅ `middleware.js` | ✅ |
| File-based metadata | ✅ incl. Open Graph | ✅ |

Everything above is measured on this repository — see [Numbers](#numbers).

## Numbers

Measured at v3.2.0, Node 24.16, Windows. Next.js figures come from the npm registry (`next@16.4.2`), not marketing copy.

| | Value | How |
| --- | --- | --- |
| Browser payload / page | 65.5 KB raw · **19.6 KB gzip** | gzipped with zlib |
| Runtime source | 9 files · 1,974 lines · 70.3 KB | all of `_framework/` |
| Dev server → first response | **161 ms** | 5 runs, median |
| Dev dependency | `@babel/standalone`, 36.7 MB | build-time only |
| `next` for comparison | 183.6 MB unpacked | `dist.unpackedSize` |

**Caveats we won't bury:** nothing is minified, tree-shaken or code-split. `@babel/standalone` is 36.7 MB on disk. Both are true, and both are consequences of having no bundler.

### The Babel tax, and how the build removes it

`@babel/standalone` is a dev dependency, but a *runtime* compiler is still a
tax: it costs ~64 MB of resident memory and ~22 ms per module. Measured on a
300-page app (302 modules):

| | compile on demand | `npm run build` (precompiled) |
| --- | --- | --- |
| first request after a deploy | 194 ms | **52 ms** |
| median request | 2 ms | 2 ms |
| resident memory per worker | 80 MB | **62 MB** |
| Babel loaded in production | yes | **never** |

`npm run build` compiles every module once into `.aziz/compiled`, writes
content-hashed URLs the browser can cache forever (`immutable`), and the
production server loads the precompiled CommonJS instead of invoking Babel.
Babel is loaded lazily, so a precompiled production process never evaluates
it — `GET /_aziz/health` reports `"babel": "not loaded"`.

## Vs Next.js

### Where Aziz.js matches Next.js

SSR + hydration · file-based routing · nested & dynamic (`[slug]`) and catch-all (`[...path]`) routes · layouts with segment inheritance · `loading.js` streaming · `error.js` · `not-found.js` · SSG/ISR (`revalidate`, `generateStaticParams`) · `<Suspense>` boundaries · data suspension (`createResource`/`use`) · server-rendered `metadata` with Open Graph · `middleware.js` · API routes with `NextResponse.json()` · edge API routes · `<Image>` / `<Font>` · i18n routing · global hooks · `@/` alias · WebSocket live reload · TypeScript · automatic route prefetching.

### Where it differs

| Capability | Status |
| --- | --- |
| Server-side rendering | ✅ SSR by default + hydration |
| Static generation / ISR | ✅ `npm run build`, `revalidate` |
| React Server Components | ⚠️ not React RSC; async server components + server-only modules |
| Streaming | ✅ route-level (`loading.js`) and `<Suspense>` boundaries |
| `<Suspense>` / partial in-place swap | ✅ component boundaries stream and swap; not a concurrent renderer |
| Route prefetching | ✅ automatic viewport prefetch + declared data warm-up |
| Image optimization | ✅ `<Image>` + `/_aziz/image` (`sharp` optional dependency, installed by default) |
| Font optimization | ✅ `<Font>`, `font-display:swap`, automatic preloads |
| Metadata | ✅ server-rendered `<head>` |
| Edge runtime | ⚠️ API routes with `runtime = 'edge'` (capability boundary, not an isolate) |
| i18n routing | ✅ locale prefixes, `[locale]` routes, cookie/`Accept-Language` |
| Production hardening | ✅ precompiled build (no Babel at runtime), brotli/gzip, hashed immutable assets, health endpoint, graceful shutdown, security headers, dependency preflight |
| Multi-instance deploy | ✅ shared ISR cache (`AZIZ_CACHE_DIR`) with atomic writes + regeneration locks, or a pluggable cache adapter (`AZIZ_CACHE_ADAPTER`) |
| Containers & CI | ✅ `Dockerfile` (3-stage, non-root, no compiler in the image) + GitHub Actions pipeline in the framework repo |
| Ecosystem & docs | ⚠️ intentionally small |
| Battle-tested at scale | ❌ one maintainer; security policy is now published |

## When *not* to use it

Pick Next.js if you need **React Server Components**, a mature plugin
ecosystem, battle-tested scale, or a hiring pool that knows your stack.

Aziz.js is genuinely good for **learning the conventions, prototypes, demos,
internal tools, content sites and small production apps** — anywhere SSR,
streaming and a 20 KB client matter alongside a 161 ms dev loop.

---

# Build with it

## Routing

Every `page.*` under `app/` is a route.

| File | URL |
| --- | --- |
| `app/page.tsx` | `/` |
| `app/about/page.jsx` | `/about` |
| `app/blog/[slug]/page.tsx` | `/blog/:slug` |
| `app/docs/[...path]/page.tsx` | `/docs/*` (one or more segments) |
| `app/not-found.tsx` (or `app/404.tsx`) | custom 404 screen |
| `app/loading.tsx` | loading UI for this subtree |
| `app/error.tsx` | error boundary for this subtree |

`.js`, `.jsx`, `.ts` and `.tsx` all work. Types are stripped at build time — there is **no type checking**; run `tsc --noEmit` yourself if you want it.

No imports needed:

```tsx
// app/page.tsx
export default function Page() {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(c => c + 1)}>Clicked {count}×</button>;
}
```

Directory names are **case-sensitive**: `app/MyPage/` serves `/MyPage` only.

## Layouts

`layout.tsx` wraps everything beneath it and receives `children`:

```tsx
// app/layout.tsx
import Navbar from '/components/Navbar';

export default function Layout({ children }) {
    return (<><Navbar /><main>{children}</main></>);
}
```

Layouts compose outermost-first and inherit by segment — `app/blog/layout.tsx` wraps only `/blog/*`. The 404 screen renders inside them too.

## Loading & errors

```tsx
// app/loading.tsx — shown only if the route is still loading data
export default function Loading() {
    return <div className="skeleton">Loading…</div>;
}
```

```tsx
// app/error.tsx — catches render errors; receives { error, reset }
export default function ErrorBoundary({ error, reset }) {
    return (<div><h2>Something broke</h2><p>{error.message}</p>
        <button onClick={reset}>Try again</button></div>);
}
```

Three things differ from Next.js, and the reasons matter:

1. **`loading.js` only appears for slow routes.** All page modules are imported at boot, so navigation is synchronous — data fetching is the only async part. It shows only if requests are still in flight **200 ms** after render. Fast routes never flash a spinner.
2. **Both inherit by segment**, exactly like layouts.
3. **No file means no UI.** To disable the spinner, delete the nearest `loading.js`. Don't add a magic `'no loading'` comment — absence of the file *is* the opt-out.

Call `notFound()` from a page to render your 404 screen:

```tsx
const post = findPost(slug);
if (!post) notFound();
```

### Data with Suspense (no `loading` flags)

`useFetch` makes you thread `loading` and `error` through every component. `createResource` removes that — the page suspends and the nearest `loading.js` is the fallback:

```tsx
// app/products/page.tsx
const products = createResource(fetch('/api/products').then(r => r.json()));

export default function Page() {
    const data = use(products);      // suspends on first render
    return <ul>{data.products.map(p => <li key={p.id}>{p.name}</li>)}</ul>;
}
```

No `loading`, no `error`, no `try/catch`. If the request fails it goes straight to `error.js`; if there is no `error.js`, a built-in screen appears rather than a blank page.

Shorthand for JSON endpoints:

```tsx
const products = use(fetchResource('/api/products'));
```

`createResource` caches, so re-renders never refetch. Lazy functions are supported and run once:

```tsx
const heavy = createResource(() => import('/_modules/big-chart.js'));
```

For component-level suspension use `<Suspense fallback={…}>` (global). On the
server the fallback is sent immediately and the boundary is streamed in place;
in the browser the boundary re-renders itself when the promise settles. Route-level
`loading.js` streaming is also supported. This is not React's concurrent
renderer, but it is real streaming and partial swap.

## Hooks

All global, no imports:

| Hook | Purpose |
| --- | --- |
| `useState` `useReducer` | state |
| `useEffect` `useMemo` `useCallback` `useRef` | effects and memoization |
| `useContext` `createContext` | context |
| `useLocalStorage` | state persisted to `localStorage` |
| `useFetch` (alias `useApi`) | data fetching |
| `useTransition` | async transition state |

```tsx
const { data, loading, error, status, refetch } = useFetch('/api/users');
if (loading) return <Spinner />;
if (error)   return <p>{error}</p>;      // error is a message string
```

`useFetch` caches GET responses for **5 seconds**, so navigating away and back won't refetch. Use `refetch()` or `clearFetchCache()` to bust it.

## Navigation

```tsx
navigate('/about');                     // push
replace('/login');                      // replace
back(); forward(); refresh();

const pathname = usePathname();         // '/blog/hello'
const { slug } = useParams();           // { slug: 'hello' }
const q = useSearchParams().get('q');

const router = useRouter();             // { pathname, push, replace, back, forward, refresh, prefetch, params }
const nav = useNavigation();            // { isPending, state, ...useRouter() }
const [isPending, startTransition] = useTransition();

redirect('/dashboard');                 // from a component or effect

<Link href="/about">About</Link>        // client-side, no page reload
<Link href="/login" replace>Login</Link>
```

`isPending` is `false` between transitions — routing is synchronous with no server round-trip to await. `startTransition` does report `isPending` while an **async** callback settles.

> Next.js has no `useNavigation`; `useTransition` is the real equivalent. We ship both.

## Metadata

```tsx
export const metadata = {
    title: { default: 'BizPOS', absolute: 'BizPOS — Point of Sale' },
    description: 'A point-of-sale app',
    keywords: ['pos', 'retail'],
    author: 'Aziz',
    robots: 'index, follow',
    themeColor: '#0af',
    viewport: 'width=device-width',
    canonical: 'https://example.com/',
    openGraph: { title: '…', description: '…', image: '/og.png', url: '…', type: 'website' },
    twitter: { card: 'summary_large_image', creator: '@aziz' },
};
```

Exported from any layout or page. Page metadata wins over layout metadata and **deep-merges**, so a page can override one `openGraph` field without restating the rest.

Rendered into the server response, so crawlers that don't execute JavaScript
see the title, description, Open Graph and Twitter tags. Client-side navigation
updates the same tags in place.

## Middleware

An optional `middleware.js` in the project root runs **before** page routes and API routes. Assets (`/_framework/*`, `/_modules/*`, anything with a file extension) skip it.

```js
// middleware.js
const { NextResponse } = require('./_framework/next-response');

const PUBLIC = ['/login', '/api/health'];

module.exports = function middleware(request) {
    if (PUBLIC.includes(request.pathname)) return NextResponse.next();

    if (request.pathname.startsWith('/api/') && !request.cookies.token) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!request.cookies.token) {
        return NextResponse.redirect(new URL('/login', request.url));
    }
    return NextResponse.next();
};

// optional — only run for matching paths
module.exports.config = { matcher: ['/((?!_next|.*\\..*).*)'] };
```

`request` has `url`, `method`, `pathname`, `headers` and parsed `cookies`. Return `NextResponse.next()`, `.redirect(url)`, `.json(body, { status })`, `.rewrite(url)`, or nothing to continue. Middleware failures return 500 and never silently pass.

This replaces the missing "no middleware layer" gap — but it is **not** a security boundary on its own. See [Security model](#security-model).

## API routes

Two conventions. Both work; pick one per file.

```js
// api/users.js — CommonJS
const { NextResponse } = require('../_framework/next-response');

async function GET() { return NextResponse.json({ users: [] }); }
async function POST(request) {
    const { name } = await request.json();
    return NextResponse.json({ created: true, name }, { status: 201 });
}
module.exports = { GET, POST };
```

```ts
// app/api/users/route.ts — ESM (named import works, no default-import dance)
import { NextResponse } from '../../../_framework/next-response.js';

export function GET() { return NextResponse.json({ users: [] }); }
```

Dynamic segments work the same: `api/users/[id].js` → `/api/users/:id`, with params on **`request.params.id`** (there is no second handler argument).

Handlers: `GET` `POST` `PUT` `PATCH` `DELETE` `HEAD` `OPTIONS`. Returning a plain object serialises as JSON.

Server code goes in `server/` or `*.server.mjs`. See [Security model](#security-model).

## Prefetching

Links in the viewport are prefetched automatically with an
`IntersectionObserver`. Set `data-prefetch="false"` on a link to opt out. You
can also warm **data** for a route:

```tsx
// app/products/page.tsx
export const prefetch = ['/api/products'];

export default function Page() {
    const { data } = useFetch('/api/products');
    return <ul>{data.map(p => <li key={p.id}>{p.name}</li>)}</ul>;
}
```

```tsx
<Link href="/products" prefetch>Products</Link>   // warms on hover/focus/touch
```

`router.prefetch('/products')` warms a route programmatically. Data prefetching
is separate from the automatic link prefetch, so you can opt into both.

---

# Operate it

## Project layout

```text
my-app/
├── index.html                  ← document shell (SSR injects #root + <head>)
├── middleware.js               ← optional auth/redirect hook
├── i18n.js                     ← optional locale routing config
├── .aziz/                      ← build output: static HTML + ISR cache
├── app/
│   ├── layout.tsx              ← root layout
│   ├── page.tsx                ← /
│   ├── loading.tsx             ← optional
│   ├── error.tsx               ← optional
│   ├── 404.tsx                 ← optional
│   ├── about/page.tsx
│   ├── blog/[slug]/page.tsx
│   └── api/users/route.ts
├── api/users.js                ← classic API routes
├── components/ lib/ models/    ← client-importable
├── server/                     ← NEVER served (server-only modules)
├── styles/globals.css
├── _framework/                 ← the runtime (including components.js)
└── scripts/
    ├── dev-server.js
    └── build.js                ← SSG/ISR prerender pass
```

Scripts: `npm run dev` · `npm run build` · `npm start`. Port via
`PORT=4000 npm run dev`. `build` is **not** a bundler — it boots the production
server, prerenders static pages into `.aziz/`, and leaves dynamic pages to SSR.

Deep dive: [Server Rendering, SSG, ISR, Streaming, Images & i18n](./template/docs/15-server-rendering-ssg-streaming.md).

## Security model

There is **no bundler**, so any module a page can import is served from disk
(in production: from the precompiled, hashed artifacts in `.aziz/compiled`).
The dev server enforces the boundary.

**Never served** (404 in dev *and* production):

| Rule | Examples |
| --- | --- |
| Dotfiles | `.env`, `.env.local`, `.npmrc`, `.git/config` |
| Project metadata | `package.json`, `package-lock.json`, `tsconfig.json` |
| `middleware.*` | the server-side auth hook — never a browser module |
| `app/api/**` | API route *source*; the routes themselves live at `/api/**` |
| `node_modules/` | reachable only via `/_modules/<pkg>` |
| `server/` `data/` | server-only modules, flat-file persistence |
| `*.server.{js,mjs,jsx,ts}` | individually marked server-only |
| `.aziz/` | build output and ISR cache |
| `scripts/` except `live-reload-client.js` | the dev server itself |

**Served:** `app/` (except `app/api/**`), `components/`, `models/`, `lib/`, `styles/`, `_framework/`, `index.html`.

> ### The one rule that matters
> If a module is only ever used by an API route, put it in **`server/`** or name it **`*.server.mjs`**.
> ```js
> // BEFORE — reachable at https://yoursite/lib/db.js
> export function connect() { /* … */ }
> // AFTER  — 404s
> export function connect() { /* … */ }
> ```
> ```js
> // api/users.js
> const { connect } = require('../server/db.js');
> ```
> `lib/` and `models/` **stay public by design** so `import User from '@/models/User'` keeps working.

**What is still not protected:** no CSRF tokens, no rate limiting, no auth. API routes run unsandboxed Node with full filesystem access. Add your own — `middleware.js` gives you the hook.

## Limitations

1. **Not React RSC.** Async server components and `server/` modules exist, but
   there is no React Server Component protocol or client-reference graph.
2. **No type checking.** Types are stripped, not verified.
3. **No bundler.** No minification, tree-shaking or code splitting.
4. **Image resizing needs `sharp`.** It is an optional dependency installed by
   default; if unavailable, `/_aziz/image` serves the original bytes.
5. **Edge runtime is a `vm` capability boundary**, not a V8 isolate.
6. **ISR needs a shared cache for multiple instances.** The cache is local by
   default; point every instance at one volume with `AZIZ_CACHE_DIR`, or plug
   in your own store with `AZIZ_CACHE_ADAPTER`.
7. **Streaming boundaries are DOM swaps** and do not preserve listeners inside
   the swapped subtree.
8. **One maintainer.** A security policy exists (`SECURITY.md`), but the project
   is not battle-tested. Validate before real traffic.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| 404 on **every** page | `npm install`, then **restart** the dev server |
| 404 on one page | File must be `page.{js,jsx,ts,tsx}` — not `index.*` |
| 404 on `.env`, `server/`, `*.server.mjs`, `middleware.js`, `app/api/**` | Working as intended — never served |
| "JSX transform error" | Syntax error; the message names the file |
| "Module not found" | `npm install <package>` |
| Type error that doesn't fail the build | Expected — types are stripped, not checked |
| API route 404 | Check `api/` vs `app/api/`, and don't mix `require` + `export` |
| Spinner flashes | Route crossed the 200 ms guard — delete the nearest `loading.js` |
| Server dies on Windows: `Assertion failed: !_wcsnicmp` | Upstream Node watcher bug (~1 in 8 with nested dirs). Restart. |
| Port busy | The server auto-increments; read the URL it prints |

### Known upstream issue

Node's Windows directory watcher can abort the process at startup with `Assertion failed: !_wcsnicmp(filename, dir, dirlen)`. It's a native assertion that `try/catch` cannot intercept, and it is **not** caused by `recursive: true` — a non-recursive watcher hits it too, which is why we haven't switched strategies. Measured here: **1 start in 8** with nested subdirectories, **0 in 5** on a flat project.

---

**Author:** Syed Muhammad Aziz Ahmed · **License:** MIT · **Security:** [SECURITY.md](./SECURITY.md)