# 05 · Hooks

Aziz.js implements the React hooks API. **No imports are needed** — every hook is a global.

```js
const [count, setCount] = useState(0);   // just works
```

## `useState`

```js
const [count, setCount] = useState(0);

// Functional update (uses the latest value):
setCount(c => c + 1);

// Re-render only happens if the value actually changed:
setCount(0);   // if it's already 0, nothing happens
```

Each component instance gets **its own** state, keyed by its position in the tree. Two `<Counter />` siblings never share state, even without keys (keys make it explicit and stable — always pass `key` in lists).

## `useReducer`

```js
function reducer(state, action) {
    switch (action.type) {
        case 'inc': return { count: state.count + 1 };
        case 'reset': return { count: 0 };
        default: return state;
    }
}

const [state, dispatch] = useReducer(reducer, { count: 0 });

dispatch({ type: 'inc' });
```

Signature matches React: `useReducer(reducer, initialState, init?)`.

## `useEffect`

Run side effects after render. Always return a **cleanup** function if you subscribe/touch timers:

```js
useEffect(() => {
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);      // cleanup on unmount / dep change
}, []);                                   // [] = run once

useEffect(() => {
    document.title = name;
}, [name]);                               // rerun when name changes

useEffect(() => {
    // no dep array → runs after EVERY render
});
```

Rules:

- The callback runs **asynchronously** after the DOM update (a microtask), not during render.
- The returned cleanup runs when deps change or the component unmounts.
- **On route change, all effects are cleaned up** — navigating away from a page with a `setInterval` won't leak the timer.

## `useMemo` / `useCallback`

```js
const expensive = useMemo(() => compute(a, b), [a, b]);
const onClick    = useCallback(() => doThing(id), [id]);
```

Memoize only when the work is actually expensive — otherwise it's overhead.

## `useRef`

Mutable box that survives re-renders without causing them:

```js
const inputRef = useRef(null);

useEffect(() => { inputRef.current?.focus(); }, []);

return <input ref={inputRef} />;
```

`ref` accepts a **function** (`ref={el => (node = el)}`) or an **object** (`ref={r}`); both receive the real DOM node.

## Context

Share a value through the tree without prop drilling:

```js
const ThemeContext = createContext('light');

function App() {
    return (
        <ThemeContext.Provider value="dark">
            <Toolbar />
        </ThemeContext.Provider>
    );
}

function ThemeButton() {
    const theme = useContext(ThemeContext);   // "dark"
    return <span>{theme}</span>;
}
```

- `useContext(SomeContext)` returns the nearest provider's value, or the **default** if no provider is above.
- **Nested providers**: the innermost wins for its subtree.
- Providers can be nested and combined with arbitrary wrapping elements — context is resolved during a top-down materialization pass, so a provider's value is visible to everything it renders.

## `useLocalStorage`

State that survives a refresh and syncs across tabs:

```js
const [name, setName] = useLocalStorage('name', '');

setName('Aziz');   // also written to localStorage
```

A `storage` event listener keeps other open tabs in sync.

## `useFetch` / `useApi`

Declarative data fetching with built-in loading/error state, abort-on-change, and a manual `refetch`:

```js
const { data, loading, error, refetch } = useFetch('/api/users');

if (loading) return <p>Loading…</p>;
if (error)   return <p>Error: {error}</p>;
return <ul>{data.map(u => <li key={u.id}>{u.name}</li>)}</ul>;

refetch();   // re-run the request
```

- `data` is parsed from JSON when the response is JSON (otherwise text).
- In-flight requests are **aborted** if the URL changes or the component unmounts.
- `useApi` is an alias of `useFetch`.

For imperative calls (POST, retries, custom headers) use the [API Client](./07-api-client.md) instead.

## Router hooks

```js
const { pathname, push, replace, back, refresh, params } = useRouter();
const { slug } = useParams();
const q = useSearchParams().get('q');
```

See [Routing](./04-routing.md).

## Global registry

Available in every page/component without importing:

```
useState  useEffect  useMemo  useCallback  useRef  useReducer
useContext createContext  useLocalStorage  useFetch  useApi
useRouter useParams useSearchParams
navigate  Link  h  Fragment  api
```

## Continue

→ [API Routes](./06-api-routes.md)
