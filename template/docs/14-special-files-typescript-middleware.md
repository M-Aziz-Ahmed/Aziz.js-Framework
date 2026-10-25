# Special Files, TypeScript & Middleware

Everything that lives beside `page.js`, plus the two features that arrived in
3.2.0.

## The special files

Inside any route folder you may add:

| File | Purpose |
|------|---------|
| `page.js` | the route itself |
| `layout.js` | wraps this folder and everything under it |
| `loading.js` | shown while this route's data is still loading |
| `error.js` | catches render errors in this subtree |
| `not-found.js` / `404.js` | the 404 screen (app root only) |

All of them accept `.js`, `.jsx`, `.ts` or `.tsx`.

Only `page.js` and `layout.js` are created for you. The rest are opt-in:
**a file's absence is the switch.** No flags, no comments, no config.

### Segment inheritance

`layout.js`, `loading.js` and `error.js` inherit by folder depth, like
Next.js:

```text
app/
  loading.js          ← fallback for every route
  page.js             ← /
  blog/
    loading.js        ← overrides the above, for /blog only
    page.js           ← /blog
    [slug]/
      page.js         ← /blog/:slug
```

The deepest match wins. Layouts nest (outermost first); `loading.js` and
`error.js` resolve to the single nearest one.

### loading.js

```jsx
// app/loading.js
export default function Loading() {
    return <div className="skeleton">Loading…</div>;
}
```

It shows only if the route is still pending **200 ms** after it renders, then
the page replaces it. Fast routes never flash a spinner. If nothing is
pending there is nothing to show and the page renders directly.

> To turn it off, delete the file. Do not add a `'no loading'` comment —
> absence *is* the opt-out.

### error.js

```jsx
// app/error.js  — receives { error, reset }, the same shape as Next.js
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

Without an `error.js`, a render error is thrown rather than swallowed — the
framework never hides bugs to keep a screen looking tidy. (A failed
*suspended resource* is the exception: it falls back to a built-in error
screen, because throwing inside a promise callback would strand the page on
`loading.js` forever.)

### metadata

Any layout or page can export `metadata`. Page values win, and nested objects
deep-merge, so you can override one `openGraph` field without restating the
rest.

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
    openGraph: { title: '…', description: '…', image: '/og.png', type: 'website' },
    twitter: { card: 'summary_large_image', creator: '@aziz' },
};
```

Metadata is rendered into the server response, so crawlers that do not run
JavaScript see the title, description, Open Graph and Twitter tags. Client
navigation updates the same tags in place.

---

## TypeScript

Drop in `.ts` / `.tsx` wherever `.js` / `.jsx` works:

```text
app/
  layout.tsx
  page.tsx
  blog/[slug]/page.tsx
  loading.tsx
  error.tsx
  api/users/route.ts
```

Types are **stripped at build time, not verified there**. The framework ships
`tsconfig.json` and `types/aziz.d.ts` — the latter declares the framework's
globals (`useState`, `useFetch`, `navigate`, `Link`, …) so a `.tsx` page needs
no imports. To actually check them:

```bash
npm i -D typescript
npm run typecheck      # tsc --noEmit
```

`npm run typecheck` is wired into `package.json` and says so plainly when
TypeScript is not installed, so it is safe to leave in a JavaScript project.

`interface`, `type`, generics, `as` casts and annotations all compile away
before the code reaches the browser.

> `app/api/**/route.ts` is loaded by Node directly rather than by Babel, so it
> relies on Node's own type stripping. Node 22.6+ (and 23+) can run it as-is;
> on older Node use `.js`.

---

## middleware.js

An optional `middleware.js` in the project root runs **before** page routes
and API routes. It is the hook for auth guards, redirects and rewrites.

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
```

`request` carries `url`, `method`, `pathname`, `headers` and parsed
`cookies`. `NextResponse` is also passed in as the second argument, so the
`require` at the top of the example is only needed if you want it in scope
elsewhere.

| Return | Effect |
|--------|--------|
| `NextResponse.next()` | continue to the route |
| `NextResponse.redirect(url)` | 307 to `url` |
| `NextResponse.json(body, { status })` | short-circuit with your own response |
| `NextResponse.rewrite(url)` | serve a different path |
| nothing | continue |

Assets skip middleware: `/_framework/*`, `/_modules/*`, `/scripts/*` and
anything with a file extension.

Restrict it with a matcher. Each entry is an object with a `source` — a
regular expression source anchored at the start of the path:

```js
module.exports.config = { matcher: [{ source: '/((?!_next|.*\\..*).*)' }] };
```

An entry without a `.source` matches every path, so a bare string
(`matcher: ['/admin']`) silently means "run everywhere" rather than
"run on /admin".

> Middleware is a convenience, not a security boundary. It runs in the same
> unsandboxed Node process as your API routes. CSRF validation and rate
> limiting are built in (see [Security](./16-security.md)), but *authentication*
> is yours to add — and never put a secret in the client bundle.

---

## Suspense

`useFetch` makes you thread `loading` and `error` through every component.
`createResource` removes that: the page suspends and the nearest
`loading.js` is the fallback.

```tsx
// app/products/page.tsx
const products = createResource(fetch('/api/products').then(r => r.json()));

export default function Page() {
    const data = use(products);
    return <ul>{data.products.map(p => <li key={p.id}>{p.name}</li>)}</ul>;
}
```

Shorthand for JSON endpoints:

```tsx
const products = use(fetchResource('/api/products'));
```

Resources cache, so re-rendering never refetches. A failed resource goes to
`error.js`, or to a built-in error screen when none is registered.

Use `<Suspense fallback={…}>` (global) for a component-level boundary. On the
server the fallback is sent immediately and the boundary is streamed in place;
in the browser the boundary re-renders itself when the promise settles. This is
not React's concurrent renderer, but both route-level `loading.js` streaming and
component-level swaps are supported. See
[Server Rendering & Streaming](./15-server-rendering-ssg-streaming.md).

---

## Prefetching

Links in the viewport are prefetched automatically with an
`IntersectionObserver`; `data-prefetch="false"` opts out. You can also declare
data to warm for a route:

```tsx
// app/products/page.tsx
export const prefetch = ['/api/products'];
```

```jsx
<Link href="/products" prefetch>Products</Link>   // warms on hover/focus/touch
```

`router.prefetch('/products')` does the same thing programmatically.