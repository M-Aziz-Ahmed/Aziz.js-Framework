# ⚡ Aziz.js

> A lightweight Next.js clone — file-based routing, React hooks, server-side API routes, ES module imports. **Zero dependencies. Instant startup.**

```bash
npx create-aziz-app my-app
```

---

## What is this?

Aziz.js gives you the Next.js developer experience without the weight:

| | Aziz.js | Next.js |
|--|---------|---------|
| Bundle size | **~50KB** | ~400KB+ |
| Dependencies | **0** | 20+ |
| Startup time | **< 1s** | 10–30s |
| `page.js` routing | ✅ | ✅ |
| `layout.js` | ✅ | ✅ |
| API routes | ✅ | ✅ |
| `NextResponse` | ✅ | ✅ |
| React hooks | ✅ | ✅ |
| ES module imports | ✅ | ✅ |
| `@/` alias | ✅ | ✅ |
| Live reload | ✅ | ✅ |
| SSR / SSG | ❌ | ✅ |

---

## Getting Started

```bash
npx create-aziz-app my-app
cd my-app
npm run dev
```

The CLI will ask you:
- **Project name**
- **Port** (default: 3000)
- **CSS framework** — None / Bootstrap / Tailwind
- **Include examples?**
- **Include docs?**

---

## Project Structure

```
my-app/
├── index.html              ← entry point
├── app/
│   ├── layout.js           ← root layout
│   ├── page.js             ← route: /
│   ├── about/
│   │   └── page.js         ← route: /about
│   └── blog/
│       └── [slug]/
│           └── page.js     ← route: /blog/:slug
├── api/
│   └── users.js            ← /api/users  (server-side)
├── components/
│   ├── Navbar.js
│   └── Footer.js
├── lib/
│   └── db.js
├── models/
│   └── User.js
└── styles/
    └── globals.css
```

---

## Pages

```js
// app/about/page.js  →  /about
/** @jsx h */
import { h } from '/_framework/runtime.js';

export default function Page() {
    const [count, setCount] = useState(0);

    return (
        <div>
            <h1>About</h1>
            <p>Count: {count}</p>
            <button onClick={() => setCount(c => c + 1)}>+</button>
        </div>
    );
}
```

---

## Layouts

```js
// app/layout.js  →  wraps every page
/** @jsx h */
import { h } from '/_framework/runtime.js';
import Navbar from '/components/Navbar.js';

export default function Layout({ children }) {
    return (
        <div>
            <Navbar />
            <main>{children}</main>
        </div>
    );
}
```

---

## API Routes

```js
// api/users.js  →  /api/users
const { NextResponse } = require('../modules/next-response');

async function GET(request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    // fetch from DB...
    return NextResponse.json({ users: [] });
}

async function POST(request) {
    const { name, email } = await request.json();
    // save to DB...
    return NextResponse.json({ created: true }, { status: 201 });
}

module.exports = { GET, POST };
```

---

## Imports

```js
// Framework
import { h }        from '/_framework/runtime.js';
import { navigate } from '/_framework/router.js';

// Absolute paths
import Navbar from '/components/Navbar.js';

// @/ alias
import connectDB from '@/lib/db';
import User      from '@/models/User';

// npm packages (install first, then import)
import mongoose from 'mongoose';
import bcrypt   from 'bcryptjs';
import jwt      from 'jsonwebtoken';
```

---

## React Hooks

All hooks work exactly like React — no imports needed in pages:

```js
const [count, setCount]   = useState(0);
const [user, setUser]     = useState(null);

useEffect(() => {
    fetchUser().then(setUser);
}, []);

const doubled = useMemo(() => count * 2, [count]);
const ref     = useRef(null);

const [state, dispatch] = useReducer(reducer, initialState);

const theme = useContext(ThemeContext);

const [name, setName] = useLocalStorage('name', '');

const { data, loading, error } = useFetch('/api/users');
```

---

## Navigation

```js
import { navigate, Link, useRouter, useParams, useSearchParams } from '/_framework/router.js';

// Programmatic
navigate('/about');

// Component
<Link href="/about">About</Link>

// Hook
const { pathname, push, back } = useRouter();

// Dynamic route params  (/blog/[slug])
const { slug } = useParams();

// Query string  (/search?q=hello)
const searchParams = useSearchParams();
const q = searchParams.get('q');
```

---

## Full docs

See [README.md](template/README.md) inside your generated project for the complete guide.

---

## Author

**Syed Muhammad Aziz Ahmed**

## License

AZIZ
