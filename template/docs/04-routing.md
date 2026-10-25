# 04 · Routing

Aziz.js maps files under `app/` to URLs, the same way the Next.js App Router does.

## File → URL table

| File | URL |
|------|-----|
| `app/page.js` | `/` |
| `app/about/page.js` | `/about` |
| `app/blog/page.js` | `/blog` |
| `app/blog/[slug]/page.js` | `/blog/:slug` |
| `app/docs/[...path]/page.js` | `/docs/*` (catch-all) |
| `app/not-found.js` (or `app/404.js`) | (renders 404) |
| `app/loading.js` | (loading UI for this subtree) |
| `app/error.js` | (error boundary for this subtree) |

The file must be named **`page.js`** — that's what registers a route.
`.jsx`, `.ts` and `.tsx` are all accepted; TypeScript types are stripped at
transform time, and `npm run typecheck` verifies them separately.

A route is any `page.*` you create — `app/about/`, `app/blog/[slug]/` and
the rest are examples to add yourself, not files that ship with the template.

## Dynamic segments

Create `app/blog/[slug]/page.js`. Brackets become a **parameter**:

```js
// app/blog/[slug]/page.js  →  /blog/:slug
export default function Post() {
    const { slug } = useParams();
    return <article>Post: {slug}</article>;
}
```

Visiting `/blog/hello-world` renders `Post: hello-world`.

Page components also receive `{ params, searchParams, locale }` as props during
server rendering, so the same page can read `params.slug` without a hook.

Multiple dynamic segments are fine: `app/shop/[category]/[id]/page.js` → `useParams()` gives `{ category, id }`.

## Catch-all segments

`[...name]` captures **the rest of the path** as an array:

```js
// app/docs/[...path]/page.js  →  /docs/*
export default function Docs() {
    const { path } = useParams();
    //   /docs/a/b   →  path === ['a', 'b']
    //   /docs/one   →  path === ['one']
    return <pre>{JSON.stringify(path, null, 2)}</pre>;
}
```

The literal prefix is validated — `/docs/[...path]` will **not** match `/other/a`.

## Route specificity

When several routes could match, the most specific wins:

1. **Static** (`/blog/new`) beats
2. **Dynamic** (`/blog/[slug]`) beats
3. **Catch-all** (`/[...all]`)

So with all three present:

- `/blog/new` → static route
- `/blog/hello` → dynamic route
- `/other/x` → catch-all route

Trailing slashes are normalized: `/about/` matches `/about`.

## Navigation

### `<Link>` (client-side, no full reload)

```js
<Link href="/about">About</Link>
<Link href="/blog/hello" class="nav-link">Post</Link>
```

`<Link>` intercepts ordinary left-clicks and calls `navigate()`, but **respects** modifier/middle clicks (⌘/Ctrl/Shift/Alt, middle-click) and external/hash/mailto URLs, so the browser behaves normally.

### `navigate()`

```js
navigate('/about');        // pushState + render
```

### `useRouter()`

```js
const { pathname, push, replace, back, forward, refresh, params } = useRouter();

push('/about');
replace('/search?q=aziz');
refresh();                 // re-render current route
```

### `useParams()` / `useSearchParams()`

```js
const { slug } = useParams();

const search = useSearchParams();
const q = search.get('q');          // ?q=aziz → "aziz"
```

### Browser history

The router listens for `popstate`, so Back/Forward work as expected, and scroll position / focus are restored on same-route re-renders.

## Custom 404

See [Pages & Layouts](./03-pages-and-layouts.md#the-404-page) — export a default component from `app/not-found.js`.

## How the router finds pages

1. The dev server scans `app/` and emits `/_framework/routes.json` (the **manifest**).
2. On boot, the client imports that manifest and `import()`s each `page.js` / `layout.js`.
3. On every navigation it normalizes the path, resolves the most specific route, collects the layout chain, and mounts it into `#root`.

You can inspect the manifest live at **<http://localhost:3000/_framework/routes.json>**.

## Continue

→ [Hooks](./05-hooks.md)
