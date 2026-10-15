# 10 · Database & Models

Since API routes run in **real Node.js**, you can connect to databases, send emails, and touch secrets. Do **not** put secrets or DB connections in browser code.

## Where DB code lives

Put utilities and models under `lib/` and `models/`. Import them from API routes using CommonJS:

```text
api/users.js        → talks to HTTP
lib/db.js           → connects to MongoDB
models/User.js      → schema + model
```

## MongoDB + Mongoose (working example)

### 1. Install

```bash
npm install mongoose
```

### 2. `lib/db.js`

```js
// lib/db.js
const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/azizjs';

let conn = null;

async function connectDB() {
    if (conn) return conn;
    conn = await mongoose.connect(URI, { maxPoolSize: 10 });
    console.log('✅ MongoDB connected');
    return conn;
}

module.exports = { connectDB };
```

### 3. `models/User.js`

```js
// models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: String,
    email: String,
    createdAt: { type: Date, default: Date.now },
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);
module.exports = User;
```

### 4. `api/users.js`

```js
// api/users.js
const { NextResponse } = require('../_framework/next-response');
const { connectDB } = require('../lib/db');
const User = require('../models/User');

module.exports = {
    GET: async () => {
        await connectDB();
        const users = await User.find().select('-__v').lean();
        return NextResponse.json(users);
    },

    POST: async (request) => {
        const body = await request.json();
        await connectDB();
        const user = await User.create(body);
        return NextResponse.json(user, { status: 201 });
    },
};
```

### 5. `api/users/[id].js`

```js
// api/users/[id].js
const { NextResponse } = require('../_framework/next-response');
const { connectDB } = require('../lib/db');
const User = require('../models/User');

module.exports = {
    GET: async (request) => {
        await connectDB();
        const user = await User.findById(request.params.id);
        if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(user);
    },

    PUT: async (request) => {
        const body = await request.json();
        await connectDB();
        const user = await User.findByIdAndUpdate(request.params.id, body, { new: true });
        if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(user);
    },

    DELETE: async (request) => {
        await connectDB();
        const user = await User.findByIdAndDelete(request.params.id);
        if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json({ ok: true });
    },
};
```

## Fetching from the browser

Use `api` or `useFetch`:

```js
// declarative
const { data, loading, error } = useFetch('/api/users');

// imperative
async function addUser() {
    await api.post('/api/users', { name: 'Aziz', email: 'aziz@example.com' });
}
```

## Other databases

You don't need to change anything. Use native drivers:

```js
// lib/pg.js
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
module.exports = { query: (text, params) => pool.query(text, params) };
```

## Hot reload & caching

Editing `lib/db.js` or `models/User.js` triggers server reload — the dev server purges project `require.cache` entries (excluding `node_modules`). Active DB connections may persist; keep your connection logic idempotent (`conn = null` singleton) as above.

## Tips

- **Never** store DB credentials in browser files. Use environment variables (`.env`) and read them in API routes (`process.env.MONGODB_URI`). A future improvement could load `.env`, but today it's manual.
- **Return lean objects** (`.lean()`) to cut JSON overhead.
- **Validate input** — throw `Error` with `err.status = 400` on bad payloads.
- **Use transactions** for multi-step operations.

## Continue

→ [Authentication](./11-authentication.md)
