// ============================================================
//  Aziz.js Router
//  File-based routing like the Next.js App Router.
//
//  app/
//    layout.js          → root layout (wraps everything)
//    page.js            → /
//    not-found.js       → custom 404
//    about/
//      page.js          → /about
//      layout.js        → layout for /about and children
//    blog/
//      [slug]/
//        page.js        → /blog/:slug
// ============================================================

import { h, mountPage, disposeFibers, beginRender, materialize, appendNodes } from '/_framework/runtime.js';
import { normalizePath, resolveRoute, collectLayouts } from '/_framework/route-match.js';

// Registered routes / layouts (populated by the dev server manifest)
const routes = {};
const layouts = [];
let notFoundModule = null;
let dev = true;

// ─── Navigation ──────────────────────────────────────────────

export function navigate(path) {
    history.pushState(null, '', path);
    router.render();
}

// <Link href="/about">About</Link>
export function Link({ href, children, className, style, onClick, ...rest }) {
    return h('a', {
        ...rest,
        href,
        class: className,
        style,
        onClick: (e) => {
            if (typeof onClick === 'function') onClick(e);
            if (e.defaultPrevented) return;
            // Respect modifier clicks, middle-click, external links
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            if (!href || /^([a-z]+:)?\/\//i.test(href) || href.startsWith('#') || href.startsWith('mailto:')) return;
            e.preventDefault();
            navigate(href);
        },
    }, ...(Array.isArray(children) ? children : [children]));
}

// ─── Router hooks ────────────────────────────────────────────

export function useRouter() {
    return {
        pathname: normalizePath(window.location.pathname),
        push: navigate,
        replace: (path) => { history.replaceState(null, '', path); router.render(); },
        back: () => history.back(),
        forward: () => history.forward(),
        refresh: () => router.render(),
        params: router.currentParams || {},
    };
}

export function useParams() {
    return router.currentParams || {};
}

export function useSearchParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        get: (key) => params.get(key),
        getAll: (key) => params.getAll(key),
        has: (key) => params.has(key),
        entries: () => params.entries(),
        toString: () => params.toString(),
    };
}

// ─── Default 404 ─────────────────────────────────────────────

function DefaultNotFound() {
    return h('div', { style: { padding: '60px 24px', textAlign: 'center' } },
        h('h1', { style: { fontSize: '72px', color: '#61dafb', margin: '0 0 8px' } }, '404'),
        h('p', { style: { color: '#666', marginBottom: '24px' } }, 'This page could not be found.'),
        h('button', {
            class: 'btn btn-primary',
            style: { padding: '10px 24px', cursor: 'pointer' },
            onClick: () => navigate('/'),
        }, 'Go Home')
    );
}

// ─── Focus preservation ──────────────────────────────────────

function captureFocus() {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '')) return null;
    return {
        id: el.id || null,
        name: el.getAttribute?.('name') || null,
        placeholder: el.getAttribute?.('placeholder') || null,
        tag: el.tagName,
        start: el.selectionStart ?? null,
        end: el.selectionEnd ?? null,
    };
}

function restoreFocus(root, saved) {
    if (!saved) return;
    let el = null;
    if (saved.id) el = root.querySelector(`#${CSS.escape(saved.id)}`);
    if (!el && saved.name) el = root.querySelector(`[name="${CSS.escape(saved.name)}"]`);
    if (!el && saved.placeholder) {
        el = root.querySelector(`${saved.tag.toLowerCase()}[placeholder="${CSS.escape(saved.placeholder)}"]`);
    }
    if (el && typeof el.focus === 'function') {
        el.focus({ preventScroll: true });
        if (saved.start !== null && typeof el.setSelectionRange === 'function') {
            try { el.setSelectionRange(saved.start, saved.end); } catch { /* non-text input */ }
        }
    }
}

// ─── Metadata ────────────────────────────────────────────────

function metaTitle(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') return value.absolute || value.default || '';
    return '';
}

function applyMetadata(layoutModules, pageModule) {
    // Outer → inner; page metadata wins last.
    const metas = [...layoutModules.map(m => m && m.metadata), pageModule && pageModule.metadata]
        .filter(Boolean);
    if (metas.length === 0) return;

    const merged = Object.assign({}, ...metas);

    const title = metaTitle(merged.title);
    if (title) document.title = title;

    if (merged.description) {
        let tag = document.querySelector('meta[name="description"]');
        if (!tag) {
            tag = document.createElement('meta');
            tag.setAttribute('name', 'description');
            document.head.appendChild(tag);
        }
        tag.setAttribute('content', merged.description);
    }
}

// ─── Router object ───────────────────────────────────────────

export const router = {
    layouts,
    currentParams: {},
    _lastPathname: null,

    register(pathname, module) {
        routes[pathname] = module;
    },

    registerLayout(pathname, module) {
        layouts.push({ path: pathname, module });
    },

    registerNotFound(module) {
        notFoundModule = module;
    },

    async init() {
        window.navigate = navigate;
        window.useRouter = useRouter;
        window.useParams = useParams;
        window.useSearchParams = useSearchParams;
        window.Link = Link;
        window.__rerenderPage = () => this.render();

        await this.loadRoutes();

        window.addEventListener('popstate', () => this.render());

        await this.render();
    },

    async loadRoutes() {
        let manifest;
        try {
            const res = await fetch('/_framework/routes.json');
            const data = await res.json();
            manifest = Array.isArray(data) ? data : data.routes || [];
            dev = Array.isArray(data) ? true : data.dev !== false;
            window.__azizDev = dev;
        } catch (err) {
            console.error('❌ Failed to load route manifest:', err);
            return;
        }

        for (const entry of manifest) {
            const { pathname, filePath, type } = entry;
            try {
                // Cache-bust in development; allow HTTP caching in production
                const url = dev ? filePath + '?t=' + Date.now() : filePath;
                const mod = await import(url);
                if (type === 'page') this.register(pathname, mod);
                else if (type === 'layout') this.registerLayout(pathname, mod);
                else if (type === 'not-found') this.registerNotFound(mod);
            } catch (err) {
                console.error(`❌ Failed to load ${filePath}:`, err);
            }
        }
    },

    async render() {
        const pathname = normalizePath(window.location.pathname);
        const root = document.getElementById('root');
        if (!root) return;

        const isNewRoute = this._lastPathname !== pathname;
        if (isNewRoute) {
            // Unmount previous page: run effect cleanups, drop state
            disposeFibers();
            this._lastPathname = pathname;
        }

        const scrollY = isNewRoute ? 0 : window.scrollY;

        const match = resolveRoute(routes, pathname);
        this.currentParams = match ? match.params : {};

        const layoutChain = collectLayouts(layouts, pathname);
        const layoutModules = layoutChain.map(l => l.module);
        const layoutComponents = layoutModules.map(m => m.default).filter(Boolean);

        let pageModule = match ? match.value : notFoundModule;
        let PageComponent = pageModule && pageModule.default;

        if (!PageComponent) {
            PageComponent = DefaultNotFound;
            pageModule = null;
        }

        applyMetadata(layoutModules, pageModule);

        const saved = captureFocus();

        mountPage(PageComponent, layoutComponents, root, 'page:' + pathname);

        restoreFocus(root, saved);

        if (isNewRoute) window.scrollTo(0, 0);
        else if (scrollY) window.scrollTo(0, scrollY);
    },
};

export default router;
