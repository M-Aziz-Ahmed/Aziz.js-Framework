# Server Rendering, SSG, ISR, Streaming, Images & i18n

Aziz.js renders pages on the server by default. The browser still boots the
same runtime, then **hydrates** the server DOM instead of discarding it, so
event handlers, state and client-side navigation keep working.

This guide covers the server features layered on top of the file router.

## SSR (default)

Every request to a page is rendered by `template/scripts/lib/renderer.js`:

1. Layouts are composed outermost-first around the page.
2. Components run in a server render context (no browser globals).
3. Async components are awaited. `<Suspense>` boundaries can flush early.
4. `metadata` / `generateMetadata()` becomes `<title>`, description, Open
   Graph, Twitter, canonical, icons and JSON-LD in `<head>`.
5. The document is injected into `index.html` with
   `<div id="root" data-aziz-ssr="1">` and
   `window.__AZIZ_SSR__ = { pathname, params, locale, data }`.
6. `/_framework/boot.js` hydrates the existing nodes.

The page component receives `{ params, searchParams, locale }`. Layouts
receive the same props plus `children`.

```jsx
// app/blog/[slug]/page.js
export default function Post({ params }) {
    return <h1>{params.slug}</h1>;
}
```

### Async server components

Components may be `async`. The renderer awaits their output. They are **not**
React Server Components: the module is still part of the client graph, so a
component that must run only on the server belongs in `server/` or a
`*.server.js` file. Importing a server-only module from a page makes client
navigation to that page fail by design (the module is never served).

```jsx
async function Price({ id }) {
    const res = await fetch(`https://api.example.com/prices/${id}`);
    const price = await res.json();
    return <strong>{price.amount}</strong>;
}

export default async function Page() {
    return <section><Price id="sku_1" /></section>;
}
```

### Server data and `useFetch`

During SSR, `useFetch` / `fetchResource` execute against the server. Their
results are serialized into `window.__AZIZ_SSR__.data`; the browser's boot
script seeds `fetch()` so hydration does not request the same GET twice.

```jsx
export default function Products() {
    const { data, loading } = useFetch('/api/products');
    if (loading) return <p>Loading…</p>;
    return <ul>{data.map(p => <li key={p.id}>{p.name}</li>)}</ul>;
}
```

## Static generation and ISR

```jsx
// app/blog/[slug]/page.js
export const revalidate = 3600;          // ISR: seconds
export const dynamic = 'force-static';   // default when revalidate is set

export async function generateStaticParams() {
    return [{ slug: 'hello' }, { slug: 'world' }];
}
```

```jsx
// app/dashboard/page.js
export const dynamic = 'force-dynamic';  // never prerendered
export const prerender = false;          // explicit opt-out
```

### Build

```bash
npm run build
npm start
```

`npm run build`:

1. Boots the production server on a private port with streaming disabled.
2. Finds every page that can be rendered ahead of time.
3. Expands `[param]` routes with `generateStaticParams()` (or with the
   configured locales for `[locale]`).
4. Writes `.aziz/static/<path>/index.html` and `.aziz/static-manifest.json`.

`npm start` serves those documents before falling back to SSR. Pages without a
static document are rendered on demand.

### ISR

A page with `export const revalidate = N` is cached after the first production
render. The server serves the cached HTML immediately, then re-renders in the
background when it is older than `N` seconds (stale-while-revalidate). The
fresh copy goes to `.aziz/cache/isr` and wins on the next request.

Notes:

- ISR requires `npm start` / `--production`. The dev server never serves stale
  HTML.
- In-memory locking prevents duplicate background renders per path.
- There is no distributed cache: `.aziz/` is local to the server instance.

## Streaming and Suspense

There are two levels.

### Route-level streaming

If the page (or a layout) suspends, the server sends the layouts and the
nearest `loading.js` immediately, then streams the final page and replaces
`#root` in place.

```jsx
// app/products/loading.js
export default function Loading() {
    return <p>Loading products…</p>;
}
```

### Component-level streaming

Wrap slow content in `<Suspense>` (global, no import needed). The server writes
the fallback, keeps rendering the rest of the page, and streams a small script
that swaps only that boundary when it settles.

```jsx
async function Reviews({ id }) {
    const reviews = await getReviews(id);
    return <ul>{reviews.map(r => <li key={r.id}>{r.text}</li>)}</ul>;
}

export default function Product({ params }) {
    return (
        <main>
            <h1>Product</h1>
            <Suspense fallback={<p>Loading reviews…</p>}>
                <Reviews id={params.id} />
            </Suspense>
        </main>
    );
}
```

The replacement is a **DOM swap**; it does not preserve event listeners inside
that boundary. If a boundary is interactive, make the fallback and the final
content client components with their own state, or wait for hydration and let
the client runtime render it.

Production streaming can be disabled with `AZIZ_STREAMING=0`; the build does
this automatically so prerendered files contain final markup.

## Metadata on the server

`metadata` and `generateMetadata()` are server-rendered, so non-JS crawlers see
the tags:

```jsx
export const metadata = {
    title: { default: 'My App', template: '%s · My App' },
    description: '…',
    openGraph: { image: '/og.png' },
};

export async function generateMetadata({ params }) {
    const post = await getPost(params.slug);
    return { title: post.title, description: post.excerpt };
}
```

Title templates now survive page-level string titles: a layout template
`'%s · My App'` and a page title `'Pricing'` produce `Pricing · My App`.
`title.absolute` bypasses the template.

## Images

Use `<Image>` (global) for local images:

```jsx
<Image src="/images/hero.jpg" alt="Hero" width={1200} height={630} priority />
```

It emits a `srcset` of `/_aziz/image?src=…&w=…&q=…&f=auto` URLs, adds
`loading="lazy"` / `decoding="async"` by default, and uses `fetchpriority="high"`
when `priority` is set.

The endpoint:

- resolves files under `public/` or the project root;
- refuses `server/`, `data/`, dotfiles, `node_modules/` and path traversal;
- serves an immutable, ETag-based cache in `.aziz/cache/images`;
- converts to WebP/AVIF and resizes **when `sharp` is installed**
  (`npm install sharp`), otherwise serves the original bytes cache-busted.

Remote URLs are redirected, not proxied.

## Fonts

`<Font>` injects a `@font-face` at runtime and preloads the file:

```jsx
<Font family="Inter" href="/fonts/inter.woff2" weight="100 900" />
```

The dev server also:

- adds `font-display: swap` to every `@font-face` in served CSS that lacks it;
- scans `styles/` and `app/` for local font URLs and emits `<link rel="preload"
  as="font" type="…" crossorigin>` in the server-rendered `<head>`.

## i18n routing

Create `i18n.js` (or `i18n.cjs` / `i18n.mjs` / `i18n.json`) in the project
root:

```js
module.exports = {
    locales: ['en', 'fr', 'ar'],
    defaultLocale: 'en',
    localePrefix: 'always',   // 'always' | 'as-needed'
    cookie: 'AZIZ_LOCALE',    // optional
};
```

Requests without a prefix are redirected using the `AZIZ_LOCALE` cookie, then
`Accept-Language`, then `defaultLocale`. Use either:

- `app/[locale]/page.js` — the locale is a route param; `[locale]` is
  auto-expanded during `npm run build`; or
- a normal `app/page.js` — URLs are prefixed/re-written for you.

```jsx
export default function Home({ params }) {
    return <h1>{params.locale === 'fr' ? 'Bonjour' : 'Hello'}</h1>;
}
```

`useLocale()` returns the active locale. `<Link>`, `navigate()` and
`router.push()` keep the current prefix unless you pass an already-prefixed
path. `Metadata.alternates.languages` is rendered as `hreflang` links.

## Edge runtime API routes

Mark an API route with `runtime = 'edge'`:

```js
// app/api/ping/route.js
export const runtime = 'edge';

export function GET(request) {
    return new Response(JSON.stringify({ ok: true, q: request.query.get('q') }), {
        headers: { 'Content-Type': 'application/json' },
    });
}
```

Edge routes are evaluated in a `vm` context with Web globals (`Request`,
`Response`, `Headers`, `fetch`, `crypto`, `URL`, streams, …) and a `require()`
that rejects every Node built-in. Differences from real edge platforms:

- it is a capability boundary, not a V8 isolate;
- `process.env` is exposed;
- `require('fs')` fails with `ERR_EDGE_REQUIRE`;
- only named HTTP method exports are supported (`GET`, `POST`, …).

## Server-only modules

Put server-only code in `server/`, `data/`, or a `*.server.js` file. These are
never served to the browser and may be imported by server-rendered pages,
layouts and API routes. The client will 404 if a page tries to import one, so
keep shared browser code in `lib/`, `models/` or `components/`.

See the [Security model](../README.md#security-model).
