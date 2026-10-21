# 08 · Styling

Aziz.js ships plain CSS. You can also opt into Bootstrap or Tailwind from the CLI.

## Global stylesheet

`index.html` links your main stylesheet:

```html
<link rel="stylesheet" href="/styles/globals.css">
```

Add more by editing `index.html` (or inject `<link>` tags dynamically):

```html
<head>
    <link rel="stylesheet" href="/styles/globals.css">
    <link rel="stylesheet" href="/styles/theme.css">
</head>
```

## Inline styles

Use the `style` prop with an object (React-style), or a string:

```jsx
<div style={{ padding: '40px', maxWidth: '900px', margin: '0 auto' }} />
<div style="color: red" />
```

## Class names

Both `class` and `className` work:

```jsx
<div class="card" />
<div className="card" />
```

## CSS frameworks via the CLI

Pick one at creation time:

```bash
npx create-aziz-app my-app --css bootstrap
npx create-aziz-app my-app --css tailwind
npx create-aziz-app my-app --css none
```

- **bootstrap** — adds Bootstrap 5 + Bootstrap Icons (CDN `<link>`/`<script>` injected into `index.html`).
- **tailwind** — links `/styles/tailwind.output.css`, compiled locally from
  `styles/tailwind.css` with the Tailwind CLI and `tailwind.config.js`
  (`primary`/`dark` colors are configured). No CDN and no production warning.
- **none** — just your `globals.css`.

`npm install` includes the Tailwind CLI. The dev server compiles Tailwind on
startup and again when watched source files change. `npm run build` compiles a
minified stylesheet before prerendering; `npm run css:build` does it on demand.
The generated `styles/tailwind.output.css` is git-ignored.

Bootstrap remains CDN-based, so it requires an internet connection at runtime.

## Scoped styles?

There's no built-in CSS Modules / scoped styles. Options:

1. **BEM or a naming convention** in `globals.css`.
2. **Inline `style` objects** for truly one-off layout.
3. **A `<style>` tag** rendered inside a component (works, but it's global unless you namespace the selectors).

## Theming with context

Because hooks and context are global, a dark-mode toggle is easy:

```js
const ThemeContext = createContext('light');

function Root({ children }) {
    const [theme, setTheme] = useLocalStorage('theme', 'light');
    return (
        <ThemeContext.Provider value={theme}>
            <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                Toggle theme
            </button>
            {children}
        </ThemeContext.Provider>
    );
}
```

Set `document.body.dataset.theme = theme` and switch colors in CSS:

```css
[data-theme="dark"] { background: #111; color: #eee; }
```

## Continue

→ [Imports & Modules](./09-imports-and-modules.md)
