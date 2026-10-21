# 01 · Getting Started

From zero to a running Aziz.js app in a few minutes.

## Prerequisites

- **Node.js 18+** (20 LTS or newer recommended)
- **npm** (ships with Node)

Check:

```bash
node -v
npm -v
```

## Create a project

```bash
npx create-aziz-app my-app
```

The CLI walks you through a few choices:

```
📁 Project name (my-aziz-js-app): my-app
🌐 Dev server port (3000):
   Include documentation? (Y/n):

🎨 CSS Framework:
   1. None (custom CSS)
   2. Bootstrap 5
   3. Tailwind CSS
   Choose (1/2/3):
```

### Flags (skip the prompts)

Every prompt has a flag, so CI and scripts can run non-interactively:

```bash
npx create-aziz-app my-app -y                 # accept all defaults
npx create-aziz-app shop --css tailwind       # preselect CSS
npx create-aziz-app blog --port 4000          # change the default port
npx create-aziz-app min --no-docs             # skip the docs/ folder
npx create-aziz-app --help
```

| Flag | Meaning |
|------|---------|
| `-y`, `--yes` | Accept defaults, no prompts |
| `--port <n>` | Default dev-server port (3000) |
| `--css <name>` | `none` \| `bootstrap` \| `tailwind` |
| `--no-docs` | Don't copy `docs/` |

## Install and run

```bash
cd my-app
npm install      # installs @babel/standalone (used for JSX) + any deps you add
npm run dev
```

Open **<http://localhost:3000>**. You should see the home page with a working counter.

The dev server watches your files and pushes a **live reload** to the browser whenever you save — no manual refresh.

## npm scripts

Defined in your project's `package.json`:

```json
{
  "scripts": {
    "dev":   "node scripts/dev-server.js",
    "build": "node scripts/build.js",
    "start": "node scripts/dev-server.js --production",
    "test":  "node --test"
  }
}
```

- `npm run dev` — development server with live reload and no caching.
- `npm run build` — boots the production server, prerenders static/ISR pages into
  `.aziz/static`, and writes the static manifest. It is not a bundler: source is
  still compiled on demand.
- `npm start` — production server with no live-reload socket, cache headers, SSR,
  static files and ISR.
- `npm test` — runs any `**/*.test.js` files via Node's built-in test runner. With no tests present it exits 0.

## Your first page

Create `app/hello/page.js`:

```js
// app/hello/page.js  →  /hello
export default function Hello() {
    const [name, setName] = useState('');

    return (
        <div style={{ padding: '40px' }}>
            <h1>Hello 👋</h1>
            <input
                value={name}
                onInput={e => setName(e.target.value)}
                placeholder="Your name"
            />
            <p>{name ? `Hi, ${name}!` : 'Type something…'}</p>
        </div>
    );
}
```

Save. The browser reloads and you're at **<http://localhost:3000/hello>**.

Note: **you didn't import React or any hooks.** `useState`, `h` (the JSX factory), and the router are exposed globally by the framework. See [Hooks](./05-hooks.md).

## Your first API route

Create `api/greeting.js`:

```js
// api/greeting.js  →  /api/greeting
module.exports = {
    GET: async (request) => {
        const name = request.query.get('name') || 'world';
        return { hello: name };
    },
};
```

Visit **<http://localhost:3000/api/greeting?name=Aziz>** and you get JSON:

```json
{ "hello": "Aziz" }
```

Call it from a page with the global client:

```js
const data = await api.get('/api/greeting?name=Aziz');
console.log(data.hello); // "Aziz"
```

See [API Routes](./06-api-routes.md) and [API Client](./07-api-client.md).

## Next steps

1. Understand the folder layout → [Project Structure](./02-project-structure.md)
2. Build real screens → [Pages & Layouts](./03-pages-and-layouts.md)
3. Master routes → [Routing](./04-routing.md)
