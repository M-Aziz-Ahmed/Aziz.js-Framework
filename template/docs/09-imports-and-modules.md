# 09 · Imports & Modules

Browser code imports work in two "flavors": **browser modules** served by the dev server, and **npm packages**. Everything goes through the same transform pipeline (JSX → `h()`, import rewriting).

## How imports are resolved

| Specifier | Becomes / behavior | Notes |
|------------|-------------------|-------|
| `./Component.js` or `../lib/utils` | stays relative | The dev server loads files by path |
| `/components/Navbar.js` | absolute in browser → maps to your project root | Works from anywhere |
| `@/lib/db` | rewritten to `/lib/db` | Handy when deeply nested |
| `mongoose` | rewritten to `/_modules/mongoose` | Bare npm package |
| `lodash-es` | rewritten to `/_modules/lodash-es` | Exports field respected |
| `node:fs`, `data:`, `file:`, `http://…` | left untouched | Skipped by the rewriter |

The rewriter runs on **entire modules** (so multi-line `import { … } from 'pkg'` is handled correctly). It rewrites:

- `import X from '…'` and `export … from '…'`
- side-effect `import '…'`
- dynamic `import('…')`

## In your pages/components

Pages and components run in the browser (ES modules). You can import shared components, utilities, or anything you ship.

```js
// app/dashboard/page.js
import Navbar from '/components/Navbar.js';
import { format } from '@/lib/format.js';
import Button from './Button.js';        // co-located

export default function Dashboard() {
    return (
        <div>
            <Navbar />
            <Button label={format('hello')} />
        </div>
    );
}
```

**No imports of React/hooks are needed.** `h`, `Fragment`, `useState`, etc. are global.

## npm packages

1. Install first:

   ```bash
   npm install lodash-es
   ```

2. Import normally:

   ```js
   import { pick } from 'lodash-es';

   const user = pick(obj, ['id', 'name']);
   ```

The dev server resolves `lodash-es` to `/_modules/lodash-es`. Internally it looks into `node_modules/` and honors the `exports`/`browser`/`module`/`main` fields (see `scripts/lib/module-resolver.js`). If a module can't be found, the server returns a 404 and the browser throws — `npm install` fixes it.

## In API routes (server side)

API routes are **Node.js code** (`api/*.js` or `.mjs`). Use Node's resolution:

```js
// api/users.js
const { NextResponse } = require('../_framework/next-response');
const { connect } = require('../lib/db');   // server utility
const User = require('../models/User');

module.exports = {
    GET: async () => {
        await connect();
        return NextResponse.json(await User.find());
    },
};
```

Bare `mongoose` in API routes is the usual `require('mongoose')` (no `/_modules` rewrite needed).

## Loading strategy

- `/_modules/*` is **on-the-fly**. The dev server reads the module file, runs the same transform pipeline (JSX transform only affects files inside your app tree; modules usually don't contain JSX), and serves it as ES module text.
- Transforms for your own files (`app/`, `components/`) are **mtime-cached** to make hot reload snappy. In production they are precompiled at build time and served as content-hashed artifacts.
- Framework internals (`/_framework/*`) are served as-is (no JSX rewrite).

## Tips

- Use **absolute** (`/…`) for imports from the root, or `@/` for ergonomic deep imports.
- Keep imports **explicit** with `.js` extensions when referencing local files in browser code (works fine in this system).
- Dynamic `import()` is rewritten in browser code (`import('lodash-es')` → `import('/_modules/lodash-es')`) and also works natively in Node (`.mjs` context).
- Avoid mixing `require` into browser code — it's never injected. Stick to `import/export`.

## Continue

→ [Database & Models](./10-database-and-models.md)
