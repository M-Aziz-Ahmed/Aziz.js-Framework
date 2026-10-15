# 07 · API Client

The API client is the browser-side companion to [API routes](./06-api-routes.md). It's a tiny, dependency-free `fetch` wrapper with JSON handling, timeouts, retries, and typed errors.

A global `api` is available everywhere:

```js
const users = await api.get('/api/users');
await api.post('/api/users', { name: 'Aziz' });
```

You can also import it explicitly:

```js
import api, { ApiError } from '/_framework/api.js';
```

## Methods

```js
await api.get('/api/users');
await api.post('/api/users', { name: 'Aziz' });
await api.put('/api/users?id=7', { name: 'B' });
await api.patch('/api/users/7', { email: 'new@x.com' });
await api.delete('/api/users/7');
await api.del('/api/users/7');          // alias
await api.head('/api/users');           // returns the raw Response
await api.form('/api/upload', formData);// multipart/form-data
await api.raw('/api/users');            // returns the raw Response object

// Low-level escape hatch:
await api.request('/api/users', { method: 'POST', body: { a: 1 } });
```

### Options (all methods)

```js
await api.get('/api/search', {
    query: { q: 'aziz', tag: ['a', 'b'], skip: undefined },  // → ?q=aziz&tag=a&tag=b
    headers: { Authorization: 'Bearer …' },
    timeout: 5000,          // ms, 0 disables
    retries: 2,             // for 5xx/429 only
    signal,                 // external AbortSignal
    raw: false,             // true → return the Response, not parsed data
});
```

- **`query`** serializes objects; arrays become repeated params; `undefined`/`null` are skipped.
- **`raw`** returns the untouched `Response` instead of parsed JSON.

## Responses

- JSON responses are parsed automatically (`Content-Type: application/json`).
- Text-ish responses (`text/*`, html, xml) return the text.
- **`204`/`205` return `null`.**

## Errors

Failures throw an **`ApiError`** with `status`, `data`, and `url`:

```js
import { ApiError } from '/_framework/api.js';

try {
    await api.post('/api/users', bad);
} catch (err) {
    if (err instanceof ApiError) {
        if (err.status === 400) console.warn(err.message, err.data);
        else if (err.status === 0) console.error('Network/timeout:', err.message);
        else console.error('Server error', err.status);
    }
}
```

- `err.message` is extracted from the server's `error` / `message` / `detail` field when present.
- `err.status === 0` means network failure or **timeout** (`"Request timed out after …ms"`).

## Retry policy

| Status | Retried? |
|--------|----------|
| `4xx` | **No** (client errors are your bug — retrying won't help) |
| `429` | Yes (rate limit) |
| `5xx` | Yes |
| Network / timeout | Yes |

Backoff is `200ms, 400ms, 800ms…`. `retries` defaults to `0`; set it per request or globally.

```js
api.configure({ retries: 1, timeout: 10000 });
```

## Configuration

```js
api.setBaseURL('https://api.example.com');   // prefix for relative paths
api.setHeaders({ Authorization: `Bearer ${token}` });
api.configure({
    baseURL: 'https://api.example.com',
    timeout: 15000,
    retries: 0,
    headers: { 'X-App': 'aziz' },
});

console.log(api.defaults);  // { baseURL, timeout, retries, headers }
```

Defaults are merged under each request's own headers, so per-call `headers` win.

## Declarative fetching: `useFetch`

For read-only data with loading/error state built in, use the [hook](./05-hooks.md#usefetch--useapi):

```js
const { data, loading, error, refetch } = useFetch('/api/users');
```

Use **`api`** for imperative flows (POST/PUT, custom retries, non-JSON bodies); use **`useFetch`** for declarative reads.

## Full example: form → API → UI

```js
function Contact() {
    const [form, setForm] = useState({ name: '', message: '' });
    const [status, setStatus] = useState('idle');

    async function submit(e) {
        e.preventDefault();
        setStatus('sending');
        try {
            await api.post('/api/contact', form);
            setStatus('sent');
        } catch (err) {
            setStatus('error: ' + err.message);
        }
    }

    return (
        <form onSubmit={submit}>
            <input value={form.name} onInput={e => setForm({ ...form, name: e.target.value })} />
            <textarea value={form.message} onInput={e => setForm({ ...form, message: e.target.value })} />
            <button disabled={status === 'sending'}>Send</button>
            <p>{status}</p>
        </form>
    );
}
```

## Continue

→ [Styling](./08-styling.md)
