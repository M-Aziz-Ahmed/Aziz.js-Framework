# 11 · Authentication

There's no built-in auth. Because API routes run in Node and the browser client is flexible, you can add JWT-based, session-based (cookies), or OAuth flows yourself.

## Principles

- **Don't trust the browser.** Auth must be checked in **API routes** (server), not just hidden in UI.
- **Protect routes.** Return `401`/`403` from API handlers when unauthorized.
- **Send credentials in requests.** Use `Authorization: Bearer <token>` or rely on `HttpOnly` cookies.
- **Keep secrets in `.env`.** Never put `JWT_SECRET` in page/components.

## JWT (stateless) — minimal example

### 1. Install

```bash
npm install jsonwebtoken
```

### 2. `api/login.js`

```js
// api/login.js
const { NextResponse } = require('../_framework/next-response');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'change-me';

module.exports = {
    POST: async (request) => {
        const { email, password } = await request.json();
        if (!email || !password) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

        // Fake user check for demo — replace with DB lookup + bcrypt
        if (email === 'demo@example.com' && password === 'demo') {
            const token = jwt.sign({ sub: 'u_123', email }, SECRET, { expiresIn: '7d' });
            return NextResponse.json({ token });
        }
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    },
};
```

### 3. `api/me.js` (protected)

```js
// api/me.js
const { NextResponse } = require('../_framework/next-response');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'change-me';

function getUser(req) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    const token = auth.slice(7);
    try {
        return jwt.verify(token, SECRET);
    } catch {
        return null;
    }
}

module.exports = {
    GET: async (request) => {
        const user = getUser(request);
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        return NextResponse.json({ user });
    },
};
```

### 4. Browser usage

```js
async function login() {
    const res = await api.post('/api/login', { email: 'demo@example.com', password: 'demo' });
    localStorage.setItem('token', res.token);
    api.setHeaders({ Authorization: `Bearer ${res.token}` });
}

async function me() {
    const res = await api.get('/api/me');
    console.log(res.user);
}
```

If you prefer not to keep in `localStorage`, have the login endpoint set an **HttpOnly + Secure + SameSite** cookie via `NextResponse.cookies.set` and send it on every request (the browser does this automatically). Then read `request.cookies` on the server.

## Sessions with cookies (HttpOnly)

```js
const sessions = new Map(); // in-memory; replace with Redis for multi-instance

module.exports.POST = async (request) => {
    const { email, password } = await request.json();
    if (email !== 'demo@example.com' || password !== 'demo') {
        return NextResponse.json({ error: 'Invalid' }, { status: 401 });
    }
    const sid = crypto.randomUUID();
    sessions.set(sid, { user: { id: 1, email } });
    const res = NextResponse.json({ ok: true });
    res.cookies.set('sid', sid, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 86400 });
    return res;
};
```

Then check `request.cookies.sid` against `sessions`.

## Protecting pages (UI guard)

You can gate the UI in a page. The server remains the source of truth.

```js
export default function Dashboard() {
    const [ok, setOk] = useState(false);

    useEffect(() => {
        api.get('/api/me')
            .then(() => setOk(true))
            .catch(() => navigate('/login'));
    }, []);

    if (!ok) return <p>Checking auth…</p>;
    return <h1>Dashboard</h1>;
}
```

## Protecting with roles

Attach a `role` to the token/session and check it:

```js
function requireRole(role) {
    return async (request) => {
        const user = getUser(request);
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (user.role !== role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        return NextResponse.json({ ok: true, user });
    };
}

module.exports.GET = requireRole('admin');
```

## Passwords

**Never** compare plain text. Use `bcrypt` or `argon2`:

```bash
npm install bcryptjs
```

```js
const bcrypt = require('bcryptjs');
const hash = await bcrypt.hash(password, 10);
const ok = await bcrypt.compare(plain, hash);
```

## Quick checklist

- [ ] Put secrets in `.env` (don't commit)
- [ ] Verify auth on **every protected API** call
- [ ] Return `401` for missing/invalid, `403` for insufficient
- [ ] Use `HttpOnly` cookies for browser-only apps, or `Authorization` header for SPAs calling external
- [ ] Don't assume client-side redirects are enough
- [ ] Keep token expiry short, refresh if needed

## Continue

→ [Production & Deployment](./12-production-and-deployment.md)
