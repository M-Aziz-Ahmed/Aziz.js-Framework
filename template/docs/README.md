# Aziz.js Documentation

A lightweight Next.js clone — file-based routing, React hooks, server-side API routes, and ESM imports, with zero runtime dependencies.

New to Aziz.js? Start at **01**. Comfortable? Jump to the reference you need.

## Contents

| # | Guide | Who it's for |
|---|-------|--------------|
| 01 | [Getting Started](./01-getting-started.md) | Beginner — install and run your first app |
| 02 | [Project Structure](./02-project-structure.md) | Beginner — what every folder is for |
| 03 | [Pages & Layouts](./03-pages-and-layouts.md) | Beginner — creating your first screens |
| 04 | [Routing](./04-routing.md) | Intermediate — dynamic, nested, catch-all routes |
| 05 | [Hooks](./05-hooks.md) | Intermediate — state, effects, context |
| 06 | [API Routes](./06-api-routes.md) | Intermediate — the server side |
| 07 | [API Client](./07-api-client.md) | Intermediate — calling your API from the browser |
| 08 | [Styling](./08-styling.md) | Beginner — CSS, Bootstrap, Tailwind |
| 09 | [Imports & Modules](./09-imports-and-modules.md) | Intermediate — `@/`, bare npm imports, aliases |
| 10 | [Database & Models](./10-database-and-models.md) | Intermediate — MongoDB/Mongoose, REST data |
| 11 | [Authentication](./11-authentication.md) | Advanced — sessions, JWT, protected routes |
| 12 | [Production & Deployment](./12-production-and-deployment.md) | Advanced — build, ship, host |
| 13 | [Internals](./13-internals.md) | Advanced — how the runtime actually works |
| 14 | [Special Files, TypeScript & Middleware](./14-special-files-typescript-middleware.md) | Intermediate — `loading.js`, `error.js`, `metadata`, TypeScript, `middleware.js`, Suspense |
| 15 | [Server Rendering, SSG, ISR, Streaming, Images & i18n](./15-server-rendering-ssg-streaming.md) | Advanced — SSR/hydration, SSG/ISR, streaming Suspense, `<Image>`/`<Font>`, edge runtime, i18n |

## TL;DR

```bash
npx create-aziz-app my-app
cd my-app
npm install
npm run dev
```

Open <http://localhost:3000>.

Then:

```js
// app/todos/page.js  →  /todos
export default function Todos() {
    const [items, setItems] = useState([]);
    return <div>{items.length}</div>;
}
```

```js
// api/todos.js  →  /api/todos
module.exports = { GET: async () => ({ todos: [] }) };
```

Everything else is documented in these guides.

## Where things live in an app

```
my-app/
|-- index.html        document shell (SSR injects #root + <head>)
|-- .aziz/            build output: static HTML + ISR cache
|-- app/              pages + layouts (file-based routing)
|-- api/              server-side API routes (Node.js)
|-- components/       shared UI components
|-- lib/ models/      helpers + data models
|-- styles/           CSS
|-- _framework/       the runtime (h, hooks, router, api client)
`-- scripts/          dev server, build + live reload
```

Only `app/layout.js` and `app/page.js` ship with the template — the other
folders are there for you to fill in. See [Project Structure](./02-project-structure.md) for the full breakdown and [Special Files](./14-special-files-typescript-middleware.md) for `loading.js`, `error.js`, TypeScript and middleware.
