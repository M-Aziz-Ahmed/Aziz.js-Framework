# ⚡ Aziz.js

A lightweight Next.js clone with file-based routing, React hooks, server-side API routes, and ES module imports — **zero dependencies, instant startup**.

```
Next.js:  ~400KB  +  20 dependencies  +  10s startup
Aziz.js:  ~50KB   +  0 dependencies   +  <1s startup
```

---

## Quick Start

```bash
npx create-aziz-app my-app
cd my-app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — that's it.

---

## Project Structure

```
my-app/
├── index.html          ← entry point (don't touch)
│
├── app/                ← your pages and layouts
│   ├── layout.js       ← root layout (navbar, footer, etc.)
│   ├── page.js         ← route: /
│   ├── about/
│   │   └── page.js     ← route: /about
│   └── blog/
│       └── [slug]/
│           └── page.js ← route: /blog/:slug  (dynamic)
│
├── api/                ← server-side API routes (Node.js)
│   ├── users.js        ← route: /api/users
│   └── hello.js        ← route: /api/hello
│
├── components/         ← shared UI components
│   ├── Navbar.js
│   └── Footer.js
│
├── lib/                ← utilities, database connections
│   └── db.js
│
├── models/             ← data models
│   └── User.js
│
└── styles/
    └── globals.css
```

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
touch app/dashboard/page.js
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
import Navbar from '/components/Navbar.js';
import Footer from '/components/Footer.js';

export default function Layout({ children }) {
    return (
        <div>
            <Navbar />
            <main>{children}</main>
            <Footer />
        </div>
    );
}
```

### Nested layouts

```js
// app/dashboard/layout.js  — wraps all /dashboard/* pages
import Sidebar from '/components/Sidebar.js';

export default function Layout({ children }) {
    return (
        <div style={{ display: 'flex' }}>
            <Sidebar />
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
const [user, setUser]   = useState(null);
const [items, setItems] = useState([]);

setCount(prev => prev + 1);
```

### useEffect

```js
useEffect(() => {
    console.log('mounted');
}, []);

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
        case 'reset':     return { count: 0 };
        default:          return state;
    }
};

const [state, dispatch] = useReducer(reducer, { count: 0 });

dispatch({ type: 'increment' });
```

### useContext

```js
const ThemeContext = createContext('light');

// Provide value (in layout or parent)
<ThemeContext.Provider value="dark">
    {children}
</ThemeContext.Provider>

// Consume anywhere
const theme = useContext(ThemeContext);
```

### useLocalStorage

```js
const [name, setName] = useLocalStorage('userName', '');
```

### useFetch

```js
const { data, loading, error } = useFetch('/api/users');

if (loading) return <p>Loading...</p>;
if (error)   return <p>Error: {error}</p>;

return <pre>{JSON.stringify(data, null, 2)}</pre>;
```

---

## API Routes

API routes run on the **server** (Node.js). Every `.js` file in `api/` becomes an endpoint.

### Basic example

```js
// api/hello.js  →  GET /api/hello
const { NextResponse } = require('../_framework/next-response');

async function GET(request) {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name') || 'World';
    return NextResponse.json({ message: `Hello, ${name}!` });
}

module.exports = { GET };
```

### CRUD example

```js
// api/users.js  →  /api/users
const { NextResponse } = require('../_framework/next-response');

async function GET(request) {
    const users = await User.find();
    return NextResponse.json(users);
}

async function POST(request) {
    const { name, email } = await request.json();
    if (!name || !email) {
        return NextResponse.json({ error: 'Name and email required' }, { status: 400 });
    }
    const user = await User.create({ name, email });
    return NextResponse.json(user, { status: 201 });
}

async function DELETE(request) {
    const { searchParams } = new URL(request.url);
    await User.findByIdAndDelete(searchParams.get('id'));
    return NextResponse.json({ message: 'Deleted' });
}

module.exports = { GET, POST, DELETE };
```

### NextResponse

```js
return NextResponse.json({ data: 'value' });
return NextResponse.json({ error: 'Not found' }, { status: 404 });
return NextResponse.redirect('/login');
return NextResponse.text('Hello');
```

---

## Imports

### Components and pages — no imports needed for JSX or hooks

```js
// app/dashboard/page.js
export default function Page() {
    const [count, setCount] = useState(0); // hooks are global
    return <h1>Count: {count}</h1>;        // JSX works automatically
}
```

### Importing other files

```js
// Absolute path
import Navbar    from '/components/Navbar.js';
import connectDB from '/lib/db.js';
import User      from '/models/User.js';

// @/ alias (same as absolute)
import connectDB from '@/lib/db';
import User      from '@/models/User';

// npm packages (install first: npm install mongoose)
import mongoose from 'mongoose';
import bcrypt   from 'bcryptjs';
import jwt      from 'jsonwebtoken';
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

## Database

### MongoDB with Mongoose

```bash
npm install mongoose
```

```js
// lib/db.js
import mongoose from 'mongoose';

let isConnected = false;

export default async function connectDB() {
    if (isConnected) return;
    await mongoose.connect(process.env.MONGODB_URI);
    isConnected = true;
}
```

```js
// models/User.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    name:     { type: String, required: true },
    email:    { type: String, required: true, unique: true },
    password: { type: String, required: true },
}, { timestamps: true });

export default mongoose.models.User || mongoose.model('User', userSchema);
```

### Environment variables

Create `.env` in your project root:

```bash
MONGODB_URI=mongodb://localhost:27017/myapp
JWT_SECRET=your_secret_key
```

> Install `dotenv` and add `require('dotenv').config()` at the top of `scripts/dev-server.js` to load `.env` automatically.

---

## Calling APIs from Pages

```js
// GET
const res = await fetch('/api/users');
const users = await res.json();

// POST
const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Aziz', email: 'aziz@example.com' })
});
const result = await res.json();
```

### Full login example

```js
export default function Page() {
    const [email, setEmail]       = useState('');
    const [password, setPassword] = useState('');
    const [error, setError]       = useState('');
    const [loading, setLoading]   = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/loginUser', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const result = await res.json();

            if (!res.ok) {
                setError(result.error);
                return;
            }

            localStorage.setItem('user', JSON.stringify(result));
            navigate(result.role === 'admin' ? '/admin' : '/dashboard');

        } catch (err) {
            setError('Something went wrong. Try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: '400px', margin: '80px auto', padding: '0 16px' }}>
            <h1>Login</h1>
            <form onSubmit={handleLogin}>
                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onInput={(e) => setEmail(e.target.value)}
                    required
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onInput={(e) => setPassword(e.target.value)}
                    required
                />
                {error && <p style={{ color: 'red' }}>{error}</p>}
                <button type="submit" class="btn btn-primary" disabled={loading}>
                    {loading ? 'Logging in...' : 'Login'}
                </button>
            </form>
        </div>
    );
}
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

Choose Tailwind during project creation, or add it manually to `index.html`:

```html
<script src="https://cdn.tailwindcss.com"></script>
```

---

## Dev Server

```bash
npm run dev
```

- Serves your app at `http://localhost:3000`
- Watches all source folders and live-reloads on save
- Resolves bare imports from `node_modules`
- Hot-reloads API routes when changed

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
| API routes | ✅ | ✅ |
| `NextResponse` | ✅ | ✅ |
| React hooks | ✅ | ✅ |
| No imports needed in pages | ✅ | ❌ |
| ES module imports | ✅ | ✅ |
| `@/` path alias | ✅ | ✅ |
| Live reload | ✅ | ✅ |
| SSR / SSG | ❌ | ✅ |
| TypeScript | ❌ | ✅ |
| Bundle size | **~50KB** | ~400KB+ |
| Dependencies | **0** | 20+ |
| Startup time | **< 1s** | 10–30s |

---

## License

MIT
