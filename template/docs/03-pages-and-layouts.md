# 03 · Pages & Layouts

Pages are screens. Layouts wrap screens in shared chrome (nav, footer, providers).

## Pages

A page is a file named `page.js` (or `page.jsx`) that **exports a default component**.

```js
// app/about/page.js  →  /about
export default function About() {
    return (
        <div>
            <h1>About</h1>
            <p>We build lightweight frameworks.</p>
        </div>
    );
}
```

Rules:

- The file must be named **`page.js`** inside a folder under `app/`.
- It must have a **default export**.
- **JSX works out of the box** — no imports needed.

### Pages can use state and hooks

```js
// app/clock/page.js
export default function Clock() {
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);   // cleanup runs on unmount
    }, []);

    return <p>{now.toLocaleTimeString()}</p>;
}
```

Hooks are global: `useState`, `useEffect`, `useMemo`, `useRef`, `useReducer`, `useContext`, `useLocalStorage`, `useFetch`, `useApi`, `useRouter`, `useParams`, `useSearchParams`. Full list in [Hooks](./05-hooks.md).

### Page metadata

Export a `metadata` object to set the document title / description per page:

```js
// app/about/page.js
export default function About() { /* … */ }

export const metadata = {
    title: 'About us',
    description: 'Who we are',
};
```

Layout metadata is merged outermost → innermost, and **page metadata wins** for `title`.

## Layouts

A layout is a file named `layout.js` that **exports a default component receiving `{ children }`**:

```js
// app/layout.js  →  wraps EVERY page
import Navbar from '/components/Navbar.js';
import Footer from '/components/Footer.js';

export default function Layout({ children }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <Navbar />
            <main style={{ flex: 1 }}>{children}</main>
            <Footer />
        </div>
    );
}

export const metadata = {
    title: 'My App',
    description: 'Built with Aziz.js',
};
```

`children` is whatever page (or nested layout) the router mounted. Always render it — otherwise nothing below the layout appears.

### Nested layouts

A `layout.js` inside a folder applies to **that folder and everything under it**, outermost-first:

```
app/layout.js              → wraps /            (root)
app/about/layout.js        → wraps /about       (and children)
app/blog/layout.js         → wraps /blog/*
```

For a request to `/blog/hello`, the chain is:

```
app/layout.js → app/blog/layout.js → app/blog/[slug]/page.js
```

Layouts do **not** re-mount when you navigate between sibling routes (their state persists); only the page below them changes.

## The 404 page

`app/not-found.js` renders when no route matches (or a page exports nothing usable):

```js
// app/not-found.js
export default function NotFound() {
    return (
        <div style={{ padding: '60px 24px', textAlign: 'center' }}>
            <h1 style={{ fontSize: '72px' }}>404</h1>
            <p>This page could not be found.</p>
            <button onClick={() => navigate('/')}>Go Home</button>
        </div>
    );
}
```

If you don't ship one, a built-in default 404 is used.

## Root entry

`index.html` is the only real HTML file. It defines `<div id="root">`, loads `/_framework/boot.js`, and the client router renders the matching page into `#root`. You normally **don't touch `index.html`** except to add global `<link>`/`<script>` (the CSS-framework flags inject these for you).

## Programmatic navigation from a page

```js
navigate('/about');                 // global function
window.__rerenderPage?.();          // force re-render (advanced)
```

See [Routing](./04-routing.md) for links, params, and search strings.

## Continue

→ [Routing](./04-routing.md)
