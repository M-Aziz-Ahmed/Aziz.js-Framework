# Changelog

## [3.0.0] - 2026 — Stable Release 🎉

### Breaking Changes (New Architecture)
- Replaced `pages/` with `app/` directory (Next.js App Router style)
- Replaced `modules/` with `_framework/` (runtime, hooks, router)
- Replaced `app.html` with `index.html`
- All files now use ES module `import/export`
- API routes now run server-side (real Node.js backend)

### Added
- `app/layout.js` — root layout wrapping every page
- `app/page.js` — home page (route: `/`)
- Nested layouts (`app/about/layout.js` wraps `/about/*`)
- Dynamic routes (`app/blog/[slug]/page.js` → `/blog/:slug`)
- Catch-all routes (`app/blog/[...slug]/page.js`)
- `NextResponse` — identical to Next.js App Router API
- Named HTTP method exports (`GET`, `POST`, `PUT`, `DELETE`)
- ES module bare imports (`import mongoose from 'mongoose'`)
- `@/` path alias (`import User from '@/models/User'`)
- `useRouter`, `useParams`, `useSearchParams` hooks
- `<Link>` component for client-side navigation
- `navigate()` for programmatic navigation
- WebSocket live reload (no more SSE caching issues)
- All React hooks: `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useReducer`, `useContext`, `useLocalStorage`, `useFetch`

### Removed
- Old `pages/` folder (use `app/` instead)
- Old `modules/` folder (use `_framework/` instead)
- `generate-imports.js` (no longer needed)
- `build.js` (no longer needed)
- `app.config.js` (no longer needed)
- All legacy `.jsx` components

## [2.0.15] - 2025

### Added
- CSS framework selection (Bootstrap / Tailwind / None)
- Interactive CLI prompts
- Auto-import system
- Dev server with file watching
- State management with useState
- API routes system
- File-based routing with hash navigation

## [1.0.0] - Initial Release
