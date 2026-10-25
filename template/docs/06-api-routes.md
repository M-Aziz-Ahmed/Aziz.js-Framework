# 06 · API Routes

API routes are the **server side** of your app — real Node.js handlers you call over HTTP. They're how you fetch data, handle forms, and run database queries without exposing secrets in the browser.

## Where routes live

Two equivalent layouts, both producing `/api/**` URLs:

```
api/users.js                 →  /api/users        (classic)
api/users/[id].js            →  /api/users/:id
app/api/users/route.js       →  /api/users        (Next.js style)
app/api/users/[id]/route.js  →  /api/users/:id
```

- **Classic:** `api/<name>.js` → `/api/<name>`; folders nest: `api/posts/[id]/comments.js`.
- **Next style:** any `route.js` under `app/api/` → the folder path mapped to `/api/...`.

Both can coexist. Use whichever reads better.

## Your first handler

Export functions named after HTTP methods:

```js
// api/hello.js  →  /api/hello
module.exports = {
    GET: async (request) => {
        const name = request.query.get('name') || 'world';
        return { hello: name };
    },

    POST: async (request) => {
        const body = await request.json();
        return { created: true, ...body };
    },
};
```

**Return a value — don't manage a raw socket.** The framework turns it into the HTTP response:

| You return | Response |
|------------|----------|
| `{ ok: true }` / `[]` | `200` + JSON |
| `'some text'` | `200` + `text/plain` |
| `NextResponse.json(data, { status: 400 })` | `400` + your headers |
| `NextResponse.redirect('/login')` | `307` + `Location` |
| `undefined` / `null` | `500` + a helpful error (you forgot to return) |

## The `request` object

```js
GET: async (request) => {
    request.method          // 'GET'
    request.url             // full URL
    request.params          // { id: '42' }   from [id] segments
    request.query           // URLSearchParams → get('page'), getAll('tag')
    request.headers         // raw Node headers (lowercase keys)
    request.cookies         // { token: '…' } parsed from Cookie header
    request.rawBody         // raw body string
    request.body            // parsed JSON if content-type was JSON

    await request.json()    // parse JSON body (throws 400 on invalid)
    await request.text()    // raw text
    await request.formData()// urlencoded → { field: 'value' }
}
```

### Dynamic and catch-all params

```js
// api/users/[id].js
GET: async (request) => request.params.id        // /api/users/7 → "7"

// api/files/[...path].js
GET: async (request) => request.params.path       // /api/files/a/b → ['a','b']
```

The literal prefix is validated — `api/files/[...path]` won't match `/api/other/x`.

### Query strings

```js
// GET /api/search?q=aziz&tag=a&tag=b
request.query.get('q')        // "aziz"
request.query.getAll('tag')   // ["a", "b"]
```

### Cookies

```js
// Cookie: token=abc; theme=dark
request.cookies.token         // "abc"
request.cookies.theme         // "dark"
```

## `NextResponse`

Imported from the framework (same API as the Next.js App Router):

```js
const { NextResponse } = require('../_framework/next-response');

GET: async () => NextResponse.json({ users: [] }, { status: 200 });

POST: async () => NextResponse.json({ error: 'Bad input' }, { status: 400 });

GET: async () => NextResponse.text('hello');

GET: async () => NextResponse.html('<h1>Hi</h1>');

GET: async () => NextResponse.redirect('/login', 307);

GET: async () => NextResponse.json({ err: 'nope' }, { status: 500 });
```

### Cookies with `NextResponse`

```js
GET: async () => {
    const res = NextResponse.json({ ok: true });
    res.cookies.set('session', 'abc123', {
        httpOnly: true,
        secure: true,
        maxAge: 60 * 60 * 24 * 7,   // 7 days (seconds)
        path: '/',
    });
    res.cookies.delete('old-cookie');
    return res;
};
```

Headers are emitted as `Set-Cookie` (multiple allowed).

## Error handling

Throw — the framework maps it to a status:

```js
const err = new Error('User not found');
err.status = 404;
throw err;                          // → 404 { error: 'User not found' }

throw new SyntaxError('…');         // → 400
throw new Error('boom');            // → 500
```

`await request.json()` on a malformed body throws a `SyntaxError` with `status = 400` automatically.

Unhandled errors return `500` with `{"error": "…"}` and are logged to the server console.

## Method not allowed → 405

If a route exists but doesn't export your method:

```
DELETE /api/hello   →  405
  Allow: GET
  { "error": "Method DELETE not allowed", "allowed": ["GET"] }
```

`HEAD` falls back to your `GET` handler automatically (response body suppressed). `OPTIONS` returns `204` with an `Allow` header — plus CORS preflight headers when the request's origin is on your allow-list.

## CORS

API responses are **same-origin only** by default — no
`Access-Control-Allow-Origin` header is sent, so a browser on another origin
cannot call your API. Allow one in `aziz.config.js`:

```js
// aziz.config.js
module.exports = {
  security: {
    cors: { origin: ['https://app.example.com'] },
  },
};
```

The allowed origin then gets:

```
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Aziz-CSRF
```

`origin: '*'` is allowed but never sends credentials. See
[Security](./16-security.md).

## CSRF and rate limiting

Both are built in and on by default:

- **CSRF** — `POST`, `PUT`, `PATCH` and `DELETE` are validated against
  `Origin`, `Referer` and `Sec-Fetch-Site` before your handler runs. A
  cross-site write gets a `403`. Set `security.csrf: 'strict'` to also require
  a double-submit token, which the bundled client sends for you.
- **Rate limit** — 300 requests per minute per IP on `/api/**`. Over the limit
  you get `429` with a `Retry-After` header.

Both are configured in `aziz.config.js`. See
[Security](./16-security.md).

## Native ESM (`.mjs`)

Server files are CommonJS by default. Use the `.mjs` extension for native ESM:

```js
// api/todos.mjs
import { NextResponse } from '../_framework/next-response.js';

export async function GET() {
    return NextResponse.json({ todos: [] });
}
```

You can also `export` directly from a `.js` file — the loader falls back to ESM if `require()` reports `ERR_REQUIRE_ESM`.

## Legacy `(req, res)` handlers

Express/Next-pages style still works — export a function and write the response yourself:

```js
// api/legacy.js
module.exports = function (req, res) {
    res.status(200).json({ legacy: true, method: req.method });
};
```

Available on `res`: `status(code)`, `json(data)`, `send(data)`, `setHeader(k, v)`, `redirect(url, code?)`. The `request` passed in is enriched with `params`, `cookies`, `query`, and `nextUrl`.

The framework falls back to a `500` if a legacy handler never sends a response.

## Hot reload

Editing files under `api/`, `lib/`, or `models/` triggers a reload: the server clears the require cache for project files (not `node_modules`) and re-imports your routes. Save → the next request sees new code.

## Continue

→ [API Client](./07-api-client.md)
