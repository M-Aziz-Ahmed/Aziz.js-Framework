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

Every `page.js` inside `app/` becomes a route. Export a default function called `Page`.

```js
// app/about/page.js  →  route: /about
/** @jsx h */
import { h } from '/_framework/runtime.js';

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

Just create the file — no registration, no imports to add:

```bash
# Creates route /dashboard
mkdir app/dashboard
touch app/dashboard/page.js
```

```js
// app/dashboard/page.js
/** @jsx h */
import { h } from '/_framework/runtime.js';

export default function Page() {
    return <h1>Dashboard</h1>;
}
```

---

## Layouts

`layout.js` wraps all pages at the same level and below. The root `app/layout.js` wraps every page in your app.

```js
// app/layout.js
/** @jsx h */
import { h } from '/_framework/runtime.js';
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
/** @jsx h */
import { h } from '/_framework/runtime.js';
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
import { navigate } from '/_framework/router.js';

navigate('/about');
navigate('/blog/my-post');
navigate('/');
```

### Link component

```js
import { Link } from '/_framework/router.js';

<Link href="/about">About</Link>
<Link href="/blog/hello" className="nav-link">Blog Post</Link>
```

### useRouter hook

```js
import { useRouter } from '/_framework/router.js';

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
import { useParams } from '/_framework/router.js';

export default function Page() {
    const { slug } = useParams();
    return <h1>Post: {slug}</h1>;
}
```

### useSearchParams — query strings

```js
// URL: /search?q=hello&page=2
import { useSearchParams } from '/_framework/router.js';

export default function Page() {
    const searchParams = useSearchParams();
    const query = searchParams.get('q');    // "hello"
    const page  = searchParams.get('page'); // "2"

    return <p>Searching for: {query}</p>;
}
```

---

## React Hooks

All hooks work exactly like React — no imports needed in pages.

### useState

```js
const [count, setCount] = useState(0);
const [user, setUser]   = useState(null);
const [items, setItems] = useState([]);

// Functional update
setCount(prev => prev + 1);
```

### useEffect

```js
// Run on mount
useEffect(() => {
    console.log('mounted');
}, []);

// Run when value changes
useEffect(() => {
    document.title = `Count: ${count}`;
}, [count]);

// Cleanup
useEffect(() => {
    const timer = setInterval(() => tick(), 1000);
    return () => clearInterval(timer);
}, []);
```

### useMemo

```js
const expensiveResult = useMemo(() => {
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

// In JSX
<input ref={inputRef} type="text" />

// Access DOM element
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
dispatch({ type: 'reset' });
```

### useContext

```js
// Create context
const ThemeContext = createContext('light');

// Provide value (in layout or parent)
<ThemeContext.Provider value="dark">
    {children}
</ThemeContext.Provider>

// Consume in any child
const theme = useContext(ThemeContext);
```

### useLocalStorage

```js
// Persists across page refreshes
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
const { NextResponse } = require('../modules/next-response');

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
const { NextResponse } = require('../modules/next-response');

async function GET(request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
        const user = await User.findById(id);
        if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(user);
    }

    const users = await User.find();
    return NextResponse.json(users);
}

async function POST(request) {
    const body = await request.json();
    const { name, email } = body;

    if (!name || !email) {
        return NextResponse.json({ error: 'Name and email required' }, { status: 400 });
    }

    const user = await User.create({ name, email });
    return NextResponse.json(user, { status: 201 });
}

async function DELETE(request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    await User.findByIdAndDelete(id);
    return NextResponse.json({ message: 'Deleted' });
}

module.exports = { GET, POST, DELETE };
```

### Request object

```js
async function POST(request) {
    // Parse body
    const body = await request.json();

    // Query params
    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page');

    // Headers
    const token = request.headers.authorization;

    // Method
    console.log(request.method); // "POST"
}
```

### NextResponse

```js
// JSON response
return NextResponse.json({ data: 'value' });

// With status code
return NextResponse.json({ error: 'Not found' }, { status: 404 });

// With custom headers
return NextResponse.json(data, {
    status: 200,
    headers: { 'X-Custom': 'value' }
});

// Redirect
return NextResponse.redirect('/login');

// Plain text
return NextResponse.text('Hello');
```

### HTTP status codes

| Code | Meaning |
|------|---------|
| `200` | OK |
| `201` | Created |
| `400` | Bad Request |
| `401` | Unauthorized |
| `403` | Forbidden |
| `404` | Not Found |
| `409` | Conflict |
| `500` | Server Error |

---

## Imports

Use ES module `import` statements anywhere. The dev server resolves everything automatically.

### Framework imports

```js
import { h }                          from '/_framework/runtime.js';
import { navigate, Link, useRouter }  from '/_framework/router.js';
```

### Absolute path imports

```js
import Navbar   from '/components/Navbar.js';
import connectDB from '/lib/db.js';
import User     from '/models/User.js';
```

### @/ alias (same as absolute)

```js
import connectDB from '@/lib/db';
import User      from '@/models/User';
import Button    from '@/components/Button';
```

### npm packages (bare imports)

```js
// Install first: npm install mongoose
import mongoose from 'mongoose';

// Install first: npm install bcryptjs
import bcrypt from 'bcryptjs';

// Install first: npm install jsonwebtoken
import jwt from 'jsonwebtoken';
```

The dev server resolves bare imports from `node_modules` automatically — no bundler config needed.

---

## Components

Components are just functions that return JSX. Always add `/** @jsx h */` at the top.

```js
// components/Button.js
/** @jsx h */
import { h } from '/_framework/runtime.js';

export default function Button({ onClick, children, variant = 'primary' }) {
    return (
        <button
            class={`btn btn-${variant}`}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
```

```js
// Using the component
import Button from '/components/Button.js';

<Button onClick={() => alert('hi')} variant="danger">
    Delete
</Button>
```

### Props

```js
// Strings
<Component title="Hello" />

// Numbers
<Component count={42} />

// Booleans
<Component disabled={true} />
<Component disabled />

// Objects / arrays
<Component style={{ color: 'red' }} />
<Component items={[1, 2, 3]} />

// Functions
<Component onClick={() => doSomething()} />

// Children
<Component>
    <p>Child content</p>
</Component>
```

### JSX rules

```js
// Use class instead of className
<div class="container">

// Use onInput for text inputs (not onChange)
<input onInput={(e) => setValue(e.target.value)} />

// Self-closing tags need /
<input type="text" />
<br />

// Expressions in {}
<p>{count > 0 ? 'positive' : 'zero'}</p>

// Lists
{items.map(item => <li key={item.id}>{item.name}</li>)}

// Conditional rendering
{isLoggedIn && <Dashboard />}
{error ? <Error msg={error} /> : <Content />}
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
    console.log('✅ MongoDB connected');
}
```

```js
// models/User.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    name:  { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role:  { type: String, enum: ['user', 'admin'], default: 'user' }
}, { timestamps: true });

export default mongoose.models.User || mongoose.model('User', userSchema);
```

```js
// api/users.js
const { NextResponse } = require('../modules/next-response');
const connectDB = require('../lib/db');
const User = require('../models/User');

async function GET(request) {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (email) {
        const user = await User.findOne({ email }).select('-password');
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
        return NextResponse.json(user);
    }

    const users = await User.find().select('-password');
    return NextResponse.json(users);
}

module.exports = { GET };
```

### Environment variables

Create a `.env` file in your project root:

```bash
MONGODB_URI=mongodb://localhost:27017/myapp
JWT_SECRET=your_secret_key
API_KEY=your_api_key
```

Access in API routes:

```js
const uri    = process.env.MONGODB_URI;
const secret = process.env.JWT_SECRET;
```

> **Note:** `.env` files are not loaded automatically. Install `dotenv` and add `require('dotenv').config()` at the top of `scripts/dev-server.js`, or set variables in your terminal before running `npm run dev`.

---

## Calling APIs from Pages

```js
// Simple fetch
const response = await fetch('/api/users');
const users = await response.json();

// POST request
const response = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Aziz', email: 'aziz@example.com' })
});
const result = await response.json();

// With error handling
async function createUser(data) {
    try {
        const res = await fetch('/api/createUser', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await res.json();

        if (!res.ok) {
            throw new Error(result.error || 'Request failed');
        }

        return result;
    } catch (err) {
        console.error(err);
        throw err;
    }
}
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
                    value={email}
                    onInput={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                    required
                />
                <input
                    type="password"
                    value={password}
                    onInput={(e) => setPassword(e.target.value)}
                    placeholder="Password"
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

Edit `styles/globals.css` for your global styles. Built-in utility classes:

```css
/* Cards */
.card { background: white; border-radius: 10px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 20px; }

/* Buttons */
.btn         { display: inline-block; padding: 10px 22px; border: none; border-radius: 8px; cursor: pointer; }
.btn-primary { background: #61dafb; color: #282c34; font-weight: bold; }
.btn-danger  { background: #ff6b6b; color: white; }
.btn-grey    { background: #ccc; color: #333; }

/* Counter */
.count-display   { font-size: 64px; font-weight: bold; text-align: center; }
.counter-actions { display: flex; gap: 12px; justify-content: center; }
```

### Inline styles

```js
<div style={{ padding: '20px', color: 'red', fontSize: '16px' }}>
    Hello
</div>
```

### Tailwind CSS

When creating your app, choose Tailwind CSS in the setup wizard:

```bash
npx create-aziz-app my-app
# Choose: Tailwind CSS
```

Or add it manually to `index.html`:

```html
<script src="https://cdn.tailwindcss.com"></script>
```

Then use Tailwind classes directly:

```js
<div class="flex items-center gap-4 p-6 bg-white rounded-lg shadow">
    <h1 class="text-2xl font-bold text-gray-800">Hello</h1>
</div>
```

---

## Dev Server

```bash
npm run dev
```

The dev server:
- Serves your app at `http://localhost:3000`
- Watches `app/`, `api/`, `components/`, `lib/`, `models/`, `styles/` for changes
- Reloads the browser automatically on save (WebSocket live reload)
- Resolves bare imports from `node_modules`
- Loads API routes from `api/`
- Hot-reloads API routes when changed

### Custom port

```bash
PORT=4000 npm run dev
```

Or set it during project creation:

```bash
npx create-aziz-app my-app
# Enter port: 4000
```

### Live reload indicator

A small indicator appears in the bottom-right corner:

- 🟢 **Live Reload** — connected, watching for changes
- 🔵 **Reloading...** — change detected, refreshing
- 🟠 **Disconnected** — reconnecting...

Click it to manually reload.

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
| Named HTTP exports | ✅ | ✅ |
| React hooks | ✅ | ✅ |
| ES module imports | ✅ | ✅ |
| `@/` path alias | ✅ | ✅ |
| Live reload | ✅ | ✅ |
| SSR / SSG | ❌ | ✅ |
| Image optimization | ❌ | ✅ |
| TypeScript | ❌ | ✅ |
| Bundle size | **~50KB** | ~400KB+ |
| Dependencies | **0** | 20+ |
| Startup time | **< 1s** | 10–30s |

---

## FAQ

**Do I need to register pages manually?**
No. Just create `app/your-route/page.js` and it becomes a route automatically.

**Can I use npm packages?**
Yes. Run `npm install package-name` and import it normally:
```js
import mongoose from 'mongoose';
```

**Where do I put shared utilities?**
In `lib/`:
```js
// lib/utils.js
export function formatDate(date) {
    return new Date(date).toLocaleDateString();
}
```

**How do I share state between pages?**
Use `useLocalStorage` for persistence, or create a context:
```js
const AuthContext = createContext(null);
```

**Can I use this in production?**
Aziz.js is designed for development and learning. For production apps with SEO requirements, consider Next.js. For simple SPAs and internal tools, Aziz.js works great.

**How do I add authentication?**
```js
// api/login.js
const { NextResponse } = require('../modules/next-response');
const jwt = require('jsonwebtoken'); // npm install jsonwebtoken

async function POST(request) {
    const { email, password } = await request.json();
    // verify credentials...
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
    return NextResponse.json({ token });
}

module.exports = { POST };
```

---

## License

MIT
