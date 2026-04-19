// ============================================================
//  Aziz.js Router
//  File-based routing like Next.js App Router
//
//  app/
//    layout.js          → root layout (wraps everything)
//    page.js            → /
//    about/
//      page.js          → /about
//      layout.js        → layout for /about and children
//    blog/
//      [slug]/
//        page.js        → /blog/:slug
// ============================================================

import { h, render } from '/_framework/runtime.js';
import { prepareHooks, finishHooks, resetHooks } from '/_framework/hooks.js';

// All registered routes (populated by dev server scan)
const routes = {};

// Current fiber tree for hooks
const fibers = new Map();

function getFiber(id) {
    if (!fibers.has(id)) {
        fibers.set(id, { hooks: [] });
    }
    return fibers.get(id);
}

// Wrap a component so hooks work correctly
function withHooks(id, Component) {
    return function WrappedComponent(props) {
        const fiber = getFiber(id);
        prepareHooks(fiber);
        const result = Component(props);
        finishHooks();
        return result;
    };
}

// Navigate to a path
export function navigate(path) {
    history.pushState(null, '', path);
    router.render();
}

// Link component (like Next.js <Link>)
export function Link({ href, children, className, style }) {
    return h('a', {
        href,
        class: className,
        style,
        onClick: (e) => {
            e.preventDefault();
            navigate(href);
        }
    }, ...(Array.isArray(children) ? children : [children]));
}

// useRouter hook
export function useRouter() {
    return {
        pathname: window.location.pathname,
        push: navigate,
        back: () => history.back(),
        forward: () => history.forward(),
        params: router.currentParams || {}
    };
}

// useParams hook
export function useParams() {
    return router.currentParams || {};
}

// useSearchParams hook
export function useSearchParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        get: (key) => params.get(key),
        getAll: (key) => params.getAll(key),
        has: (key) => params.has(key),
        toString: () => params.toString()
    };
}

// Match a route pattern to a pathname
// Supports: /about, /blog/[slug], /blog/[...slug]
function matchRoute(pattern, pathname) {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts    = pathname.split('/').filter(Boolean);
    const params = {};

    // Catch-all: /blog/[...slug]
    const catchAll = patternParts.findIndex(p => p.startsWith('[...'));
    if (catchAll !== -1) {
        if (pathParts.length < catchAll) return null;
        const paramName = patternParts[catchAll].slice(4, -1);
        params[paramName] = pathParts.slice(catchAll);
        return params;
    }

    if (patternParts.length !== pathParts.length) return null;

    for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith('[') && patternParts[i].endsWith(']')) {
            // Dynamic segment
            params[patternParts[i].slice(1, -1)] = pathParts[i];
        } else if (patternParts[i] !== pathParts[i]) {
            return null;
        }
    }

    return params;
}

// Find the best matching route for a pathname
function resolveRoute(pathname) {
    // Exact match first
    if (routes[pathname]) {
        return { route: routes[pathname], params: {} };
    }

    // Pattern match
    for (const pattern in routes) {
        if (pattern.includes('[')) {
            const params = matchRoute(pattern, pathname);
            if (params !== null) {
                return { route: routes[pattern], params };
            }
        }
    }

    return null;
}

// Collect layout chain for a path
// /about/team → [app/layout.js, app/about/layout.js]
function getLayoutChain(pathname) {
    return router.layouts.filter(({ path }) => {
        if (path === '/') return true;
        return pathname === path || pathname.startsWith(path + '/');
    }).sort((a, b) => a.path.length - b.path.length);
}

export const router = {
    layouts: [],
    currentParams: {},

    // Register a route (called by dev server scan result)
    register(pathname, module) {
        routes[pathname] = module;
    },

    // Register a layout
    registerLayout(pathname, module) {
        this.layouts.push({ path: pathname, module });
    },

    async init() {
        // Expose globals
        window.navigate   = navigate;
        window.useRouter  = useRouter;
        window.useParams  = useParams;
        window.useSearchParams = useSearchParams;
        window.Link       = Link;
        window.__rerenderPage = () => this.render();

        // Load routes from server
        await this.loadRoutes();

        // Handle browser back/forward
        window.addEventListener('popstate', () => this.render());

        // Initial render
        await this.render();
    },

    async loadRoutes() {
        try {
            const res = await fetch('/_framework/routes.json');
            const manifest = await res.json();

            console.log('📋 Route manifest:', manifest);

            for (const { pathname, filePath, type } of manifest) {
                try {
                    const mod = await import(filePath + '?t=' + Date.now());
                    if (type === 'page') {
                        this.register(pathname, mod);
                        console.log(`✅ Registered page: ${pathname} → ${filePath}`);
                    } else if (type === 'layout') {
                        this.registerLayout(pathname, mod);
                        console.log(`✅ Registered layout: ${pathname} → ${filePath}`);
                    }
                } catch (err) {
                    console.error(`❌ Failed to load ${filePath}:`, err);
                }
            }

            console.log(`📄 Loaded routes: ${Object.keys(routes).join(', ')}`);
        } catch (err) {
            console.error('Failed to load routes:', err);
        }
    },

    async render() {
        const pathname = window.location.pathname;
        const root = document.getElementById('root');

        // Find matching route
        const match = resolveRoute(pathname);
        console.log(`🔍 resolveRoute('${pathname}'):`, match);

        if (!match) {
            root.innerHTML = '';
            const notFound = h('div', { style: { padding: '40px', textAlign: 'center' } },
                h('h1', { style: { fontSize: '80px', color: '#61dafb' } }, '404'),
                h('p', {}, 'Page not found'),
                h('button', {
                    style: { padding: '10px 24px', cursor: 'pointer' },
                    onClick: () => navigate('/')
                }, 'Go Home')
            );
            root.appendChild(notFound);
            return;
        }

        this.currentParams = match.params;

        const { route } = match;
        const PageComponent = route.default;

        if (!PageComponent) {
            console.error(`Route has no default export: ${pathname}`);
            return;
        }

        // Get layout chain
        const layoutChain = getLayoutChain(pathname);

        // Wrap page in layouts (innermost first, outermost last)
        let content = () => {
            const fiber = getFiber('page:' + pathname);
            prepareHooks(fiber);
            const result = PageComponent({});
            finishHooks();
            return result;
        };

        // Apply layouts from innermost to outermost
        for (let i = layoutChain.length - 1; i >= 0; i--) {
            const { module: layoutMod, path: layoutPath } = layoutChain[i];
            const LayoutComponent = layoutMod.default;
            if (!LayoutComponent) continue;

            const innerContent = content;
            content = () => {
                const fiber = getFiber('layout:' + layoutPath);
                prepareHooks(fiber);
                const result = LayoutComponent({ children: innerContent() });
                finishHooks();
                return result;
            };
        }

        // Render
        root.innerHTML = '';
        const tree = content();
        if (Array.isArray(tree)) {
            tree.forEach(node => {
                if (node instanceof Node) root.appendChild(node);
            });
        } else if (tree instanceof Node) {
            root.appendChild(tree);
        }
    }
};

export default router;
