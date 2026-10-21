# ⚡ Aziz.js

A lightweight Next.js-shaped framework with file-based routing, React hooks,
SSR + hydration, SSG/ISR, streaming Suspense, and ES module imports — **zero
runtime dependencies, instant startup**.

```
Next.js:  ~400KB  +  20 dependencies  +  10s startup
Aziz.js:  ~50KB   +  0 dependencies   +  <1s startup
```

---

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — that's it.

Pages are server-rendered and hydrated by default. To prerender static pages and
run the production server:

```bash
npm run build   # writes .aziz/static
npm start       # production SSR + static + ISR
```

---

## Project Structure

```
my-app/
├── index.html          ← document shell (SSR injects #root + <head>)
│
├── app/                ← your pages and layouts
│   ├── layout.js       ← root layout (wraps every page)
│   └── page.js         ← route: /
│
├── styles/
│   ├── globals.css     ← global styles
│   └── tailwind.css    ← Tailwind source (--css tailwind)
│
├── tailwind.config.js  ← Tailwind theme/content (--css tailwind)
├── public/             ← optional static files and images
├── i18n.js             ← optional locale routing config
├── .aziz/              ← generated static HTML + ISR cache
├── _framework/         ← runtime, hooks, router (don't touch)
├── scripts/            ← dev server, build + live reload (don't touch)
└── docs/               ← full documentation
```

---

## Server Rendering & Static Pages

- Every page is **server-rendered** and then hydrated, so crawlers and first
  paint get real HTML.
- Page components receive `{ params, searchParams, locale }` as props.
- Async server components are awaited. `<Suspense>` boundaries stream their
  fallback, then swap in the content.
- `metadata` / `generateMetadata()` becomes server-rendered `<head>` tags.
- `export const revalidate = 60` opts into ISR, and
  `generateStaticParams()` expands dynamic pages during `npm run build`.
- `<Image>`, `<Font>`, edge API routes and i18n routing are built in.

See [Server Rendering, SSG, ISR, Streaming, Images & i18n](./docs/15-server-rendering-ssg-streaming.md).

---

## Production

```bash
npm run build   # precompile modules + prerender static pages
npm start       # production server (Node 18+)
```

`npm run build` does two things:

1. **Precompiles** every module into `.aziz/compiled` — JSX/TypeScript is
   compiled once, at build time, instead of on every server start. The
   production server loads those artifacts directly, so it never loads the
   Babel compiler, and the browser imports content-hashed URLs that are
   cached forever (`immutable`).
2. **Prerenders** static pages into `.aziz/static` and seeds ISR entries.

It also reports dependency problems that a bundler would normally catch:
a missing package fails the build, and a CommonJS-only package (which cannot
run in a browser) is a warning.

In production the server also:

- compresses text responses with brotli or gzip
- adds `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`
- answers `GET /_aziz/health` with uptime, memory and build info
- shuts down gracefully on `SIGTERM`, finishing in-flight requests

See [Production & Deployment](./docs/12-production-and-deployment.md).

---

## Pages

Every `page.js` inside `app/` becomes a route. Export a default function — no imports needed.

```js
// app/about/page.js  →  route: /about
export default function Page() {
    return (
        <div>
            <h1>About</h1>
            <p>Hello from the about page!</p>
        </div>
    );
}
```

### Route mapping

| File | Route |
|------|-------|
| `app/page.js` | `/` |
| `app/about/page.js` | `/about` |
| `app/blog/page.js` | `/blog` |
| `app/blog/[slug]/page.js` | `/blog/:slug` |
| `app/blog/[...slug]/page.js` | `/blog/*` (catch-all) |

### Creating a new page

Just create the file — no registration needed:

```bash
mkdir app/dashboard
```

```js
// app/dashboard/page.js  →  route: /dashboard
export default function Page() {
    return <h1>Dashboard</h1>;
}
```

---

## Layouts

`layout.js` wraps all pages at the same level and below. The root `app/layout.js` wraps every page.

```js
// app/layout.js
export default function Layout({ children }) {
    return (
        <div>
            <main>{children}</main>
        </div>
    );
}
```

### Nested layouts

```js
// app/dashboard/layout.js  — wraps all /dashboard/* pages
export default function Layout({ children }) {
    return (
        <div style={{ display: 'flex' }}>
            <div style={{ flex: 1 }}>{children}</div>
        </div>
    );
}
```

---

## Navigation

### navigate()

```js
navigate('/about');
navigate('/blog/my-post');
navigate('/');
```

### Link component

```js
<Link href="/about">About</Link>
<Link href="/blog/hello" className="nav-link">Blog Post</Link>
```

### useRouter hook

```js
export default function Page() {
    const router = useRouter();

    return (
        <div>
            <p>Current path: {router.pathname}</p>
            <button onClick={() => router.push('/about')}>Go to About</button>
            <button onClick={() => router.back()}>Back</button>
        </div>
    );
}
```

### useParams — dynamic routes

```js
// app/blog/[slug]/page.js
export default function Page() {
    const { slug } = useParams();
    return <h1>Post: {slug}</h1>;
}
```

### useSearchParams — query strings

```js
// URL: /search?q=hello&page=2
export default function Page() {
    const searchParams = useSearchParams();
    const query = searchParams.get('q');    // "hello"
    const page  = searchParams.get('page'); // "2"

    return <p>Searching for: {query}</p>;
}
```

---

## React Hooks

All hooks work exactly like React — **no imports needed**.

### useState

```js
const [count, setCount] = useState(0);

setCount(prev => prev + 1);
```

### useEffect

```js
useEffect(() => {
    document.title = `Count: ${count}`;
}, [count]);

useEffect(() => {
    const timer = setInterval(() => tick(), 1000);
    return () => clearInterval(timer);
}, []);
```

### useMemo

```js
const total = useMemo(() => {
    return items.filter(i => i.active).length;
}, [items]);
```

### useCallback

```js
const handleClick = useCallback(() => {
    doSomething(id);
}, [id]);
```

### useRef

```js
const inputRef = useRef(null);

<input ref={inputRef} type="text" />

inputRef.current.focus();
```

### useReducer

```js
const reducer = (state, action) => {
    switch (action.type) {
        case 'increment': return { count: state.count + 1 };
        case 'decrement': return { count: state.count - 1 };
        default:          return state;
    }
};

const [state, dispatch] = useReducer(reducer, { count: 0 });
```

### useContext

```js
const ThemeContext = createContext('light');

<ThemeContext.Provider value="dark">
    {children}
</ThemeContext.Provider>

const theme = useContext(ThemeContext);
```

### useLocalStorage

```js
const [name, setName] = useLocalStorage('userName', '');
```

---

## Imports

### Importing other files

```js
// Absolute path
import Button from '/components/Button.js';

// @/ alias (same as absolute)
import Button from '@/components/Button';

// npm packages (install first: npm install lodash)
import _ from 'lodash';
```

The dev server resolves bare imports from `node_modules` automatically — no bundler config needed.

---

## Components

Components are just functions that return JSX — no pragma or imports needed.

```js
// components/Button.js
export default function Button({ onClick, children, variant = 'primary' }) {
    return (
        <button class={`btn btn-${variant}`} onClick={onClick}>
            {children}
        </button>
    );
}
```

```js
// Using the component
import Button from '/components/Button.js';

<Button onClick={() => alert('hi')} variant="danger">Delete</Button>
```

### JSX rules

```js
// Use class instead of className
<div class="container">

// Use onInput for text inputs (not onChange)
<input onInput={(e) => setValue(e.target.value)} />

// Self-closing tags need /
<input type="text" />

// Expressions in {}
<p>{count > 0 ? 'positive' : 'zero'}</p>

// Lists
{items.map(item => <li key={item.id}>{item.name}</li>)}

// Conditional rendering
{isLoggedIn && <Dashboard />}
```

---

## Styling

### globals.css

Edit `styles/globals.css` for global styles. Built-in utility classes:

```css
.card        { background: white; border-radius: 10px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 20px; }
.btn         { display: inline-block; padding: 10px 22px; border: none; border-radius: 8px; cursor: pointer; }
.btn-primary { background: #61dafb; color: #282c34; font-weight: bold; }
.btn-danger  { background: #ff6b6b; color: white; }
.btn-grey    { background: #ccc; color: #333; }
```

### Inline styles

```js
<div style={{ padding: '20px', color: 'red', fontSize: '16px' }}>
    Hello
</div>
```

### Tailwind CSS

If you scaffolded with Tailwind, it is compiled locally from
`styles/tailwind.css` — no CDN and no production warning:

```js
// Use Tailwind classes directly in any file
<div class="flex items-center gap-4 p-6 bg-white rounded-lg shadow">
    <h1 class="text-2xl font-bold text-dark">Hello</h1>
</div>
```

`npm run dev` rebuilds `styles/tailwind.output.css` when watched files change.
`npm run build` compiles it minified, and `npm run css:build` rebuilds it on
demand. Extend the theme in `tailwind.config.js`.

---

## Dev Server

```bash
npm run dev
```

- Serves your app at `http://localhost:3000`
- Watches all source folders and live-reloads on save
- Resolves bare imports from `node_modules`

```bash
# Custom port
PORT=4000 npm run dev
```

---

## Comparison with Next.js

| Feature | Aziz.js | Next.js |
|---------|---------|---------|
| File-based routing | ✅ | ✅ |
| `page.js` convention | ✅ | ✅ |
| `layout.js` convention | ✅ | ✅ |
| Dynamic routes `[slug]` | ✅ | ✅ |
| Catch-all `[...slug]` | ✅ | ✅ |
| React hooks | ✅ | ✅ |
| No imports needed in pages | ✅ | ❌ |
| ES module imports | ✅ | ✅ |
| `@/` path alias | ✅ | ✅ |
| Live reload | ✅ | ✅ |
| SSR + hydration | ✅ | ✅ |
| SSG / ISR | ✅ | ✅ |
| Streaming Suspense | ✅ | ✅ |
| Server-rendered metadata | ✅ | ✅ |
| Image / font optimization | ✅ | ✅ |
| i18n routing | ✅ | ✅ |
| Edge API runtime | ⚠️ capability boundary | ✅ isolated |
| React Server Components | ❌ | ✅ |
| TypeScript | ⚠️ types stripped | ✅ type-checked |
| Bundle size | **~50KB** | ~400KB+ |
| Dependencies | **0** | 20+ |
| Startup time | **< 1s** | 10–30s |

---

## Security model

Anything a page can import is served to the browser. Server-only code must live
in `server/` or a `*.server.js` file (or under `data/`), and API routes run
unsandboxed Node. Edge routes are a `vm` capability boundary, not a V8 isolate.
Add authentication, CSRF protection and rate limiting yourself.

`app/api/**`, `server/`, `data/`, `scripts/`, `.aziz/`, dotfiles and
`node_modules/` are not served as browser modules.

---

## License

MIT
