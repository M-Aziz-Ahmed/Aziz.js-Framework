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

import { h, mountPage, hydratePage, disposeFibers, beginRender, materialize, appendNodes } from '/_framework/runtime.js';
import { useState, useCallback, getPendingLoads, onLoadState, warmCache } from '/_framework/hooks.js';
import { isThenable } from '/_framework/suspense.js';
import { normalizePath, resolveRoute, collectLayouts } from '/_framework/route-match.js';
import { mergeMetadata, applyMetadata } from '/_framework/metadata.js';

// Registered routes / layouts (populated by the dev server manifest)
const routes = {};
const layouts = [];
const loadings = [];
const errors = [];
let notFoundModule = null;
let dev = true;

// ─── i18n ────────────────────────────────────────────────────
// The server injects the active locale in window.__AZIZ_SSR__ and the
// project's i18n config in routes.json. Links and navigate() use it to
// keep the locale prefix on every internal navigation.

let i18nConfig = { locales: [], defaultLocale: null, localePrefix: 'always' };
const LOCALE_SEGMENT_RE = /^\/([a-z]{2}(?:-[a-zA-Z]{2,})?)(?:\/|$)/;

function getLocaleFromPath(pathname) {
    const m = LOCALE_SEGMENT_RE.exec(normalizePath(pathname));
    if (!m) return null;
    if (i18nConfig.locales.length && !i18nConfig.locales.includes(m[1])) return null;
    return m[1];
}

export function useLocale() {
    if (typeof window !== 'undefined' && window.__AZIZ_SSR__ && window.__AZIZ_SSR__.locale) {
        return window.__AZIZ_SSR__.locale;
    }
    return getLocaleFromPath(window.location.pathname) || i18nConfig.defaultLocale || '';
}

function localizeHref(href) {
    if (!href || !href.startsWith('/')) return href;
    if (!i18nConfig.locales || i18nConfig.locales.length === 0) return href;
    if (LOCALE_SEGMENT_RE.test(href) && getLocaleFromPath(href)) return href;
    if (href.startsWith('/api/') || href.startsWith('/_') || /\.[a-z0-9]+$/i.test(href)) return href;
    const locale = useLocale();
    if (!locale) return href;
    if (i18nConfig.localePrefix === 'as-needed' && locale === i18nConfig.defaultLocale) return href;
    return '/' + locale + (href === '/' ? '' : href);
}

// How long a route transition may stay pending before loading.js appears.
// Below this the route is "fast enough" and showing a spinner would only flash.
const LOADING_DELAY = 200;

// The nearest loading.js / error.js for a path — same prefix-inheritance
// rules as layouts, so app/loading.js covers every route beneath it and a
// deeper app/blog/loading.js overrides it for /blog only.
function collectNearest(list, pathname) {
    const matches = list.filter(e => matchesSegment(e.path, pathname));
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.path.split('/').filter(Boolean).length - a.path.split('/').filter(Boolean).length);
    return matches[0];
}

function matchesSegment(pattern, pathname) {
    const p = pattern.split('/').filter(Boolean);
    const s = pathname.split('/').filter(Boolean);
    if (p.length > s.length) return false;
    for (let i = 0; i < p.length; i++) if (p[i] !== s[i]) return false;
    return true;
}

// ─── Navigation ──────────────────────────────────────────────

export function navigate(path, { replace = false, scroll = true } = {}) {
    const target = localizeHref(path);
    if (replace) history.replaceState(null, '', target);
    else history.pushState(null, '', target);
    router.render();
    if (scroll) window.scrollTo(0, 0);
}

export function replace(path) {
    navigate(path, { replace: true });
}

export function back() { history.back(); }
export function forward() { history.forward(); }
export function refresh() { router.render(); }

// Server-style redirect from inside a component or an effect.
export function redirect(url, options) {
    navigate(url, { replace: true, ...options });
}

// Thrown by notFound() to render the 404 screen from a page.
const NOT_FOUND_SIGNAL = 'AZIZ_NOT_FOUND';

export function notFound() {
    throw new Error(NOT_FOUND_SIGNAL);
}

// Real prefetching. Page modules are already imported at boot, so the only
// meaningful thing to warm is the route's *data*. A page declares what it
// needs with `export const prefetch = ['/api/users']`, and <Link prefetch>
// (or router.prefetch) fetches those into the shared cache on hover/focus, so
// the navigation usually finds them already settled.
const prefetched = new Set();

function prefetchFor(pathname) {
    const normalized = normalizePath(localizeHref(pathname));
    const match = resolveRoute(routes, normalized);
    if (!match) return Promise.resolve();
    const declared = match.value && match.value.prefetch;
    if (!declared) return Promise.resolve();

    const urls = Array.isArray(declared) ? declared : [declared];
    const jobs = urls.map((url) => {
        const key = 'GET:' + url;
        if (prefetched.has(key)) return null;
        prefetched.add(key);
        return warmCache(url);
    }).filter(Boolean);
    return Promise.all(jobs);
}

export function prefetch(path) {
    try { return prefetchFor(path); } catch { return Promise.resolve(); }
}

// Automatic prefetching: every internal link is observed and its declared
// data is warmed as soon as the link approaches the viewport. There is no
// reason to make users opt in to a free head start.
let autoPrefetchInstalled = false;

function installAutoPrefetch() {
    if (autoPrefetchInstalled) return;
    autoPrefetchInstalled = true;

    const warmLink = (anchor) => {
        if (!anchor || !anchor.getAttribute) return;
        if (anchor.getAttribute('data-prefetch') === 'false') return;
        const href = anchor.getAttribute('href');
        if (!href || !href.startsWith('/') || href.startsWith('/api/') || href.startsWith('/_')) return;
        prefetchFor(href);
    };

    const selector = 'a[data-aziz-link], a[data-prefetch]';
    const observe = (root) => {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        const links = root.querySelectorAll(selector);
        if (typeof IntersectionObserver === 'function') {
            const io = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    warmLink(entry.target);
                    io.unobserve(entry.target);
                }
            }, { rootMargin: '200px' });
            links.forEach(link => io.observe(link));
        } else {
            const idle = typeof requestIdleCallback === 'function'
                ? requestIdleCallback
                : (fn) => setTimeout(fn, 200);
            links.forEach(link => idle(() => warmLink(link)));
        }
    };

    observe(document);
    window.__azizObserveLinks = observe;
}

// <Link href="/about">About</Link>
export function Link({ href, children, className, style, onClick, replace = false, scroll = true, prefetch: shouldPrefetch = true, ...rest }) {
    const finalHref = localizeHref(href);
    const warm = () => { if (shouldPrefetch && finalHref) prefetchFor(finalHref); };

    return h('a', {
        ...rest,
        href: finalHref,
        'data-aziz-link': '',
        'data-prefetch': shouldPrefetch ? 'true' : 'false',
        class: className,
        style,
        onMouseEnter: warm,
        onFocus: warm,
        onTouchStart: warm,
        onClick: (e) => {
            if (typeof onClick === 'function') onClick(e);
            if (e.defaultPrevented) return;
            // Respect modifier clicks, middle-click, external links
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            if (!href || /^([a-z]+:)?\/\//i.test(href) || href.startsWith('#') || href.startsWith('mailto:')) return;
            e.preventDefault();
            navigate(finalHref, { replace, scroll });
        },
    }, ...(Array.isArray(children) ? children : [children]));
}

// ─── Router hooks ────────────────────────────────────────────

export function useRouter() {
    return {
        pathname: normalizePath(window.location.pathname),
        locale: useLocale(),
        push: (path, options) => navigate(path, options),
        replace: (path, options) => navigate(path, { ...options, replace: true }),
        back,
        forward,
        refresh,
        // Warms the route's declared data into the fetch cache.
        prefetch,
        params: router.currentParams || {},
    };
}

export function useParams() {
    return router.currentParams || {};
}

// Next.js parity: read the current path without reaching for window.location.
export function usePathname() {
    return normalizePath(window.location.pathname);
}

// Next.js parity: transition state. Client-side routing in Aziz.js is
// synchronous — there is no server round-trip to await — so isPending is
// always false between events.
export function useNavigation() {
    return {
        isPending: false,
        state: 'idle',
        ...useRouter(),
    };
}

// Next.js parity: the real App Router transition hook. Wraps a callback so
// async work reports isPending while it runs; synchronous callbacks resolve
// immediately because there is nothing to suspend on.
export function useTransition() {
    const [isPending, setIsPending] = useState(false);

    const startTransition = useCallback((callback) => {
        let result;
        try {
            result = callback();
        } catch (err) {
            setIsPending(false);
            throw err;
        }
        if (result && typeof result.then === 'function') {
            setIsPending(true);
            return result.finally(() => setIsPending(false));
        }
        return result;
    }, []);

    return [isPending, startTransition];
}

export function useSearchParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        get: (key) => params.get(key),
        getAll: (key) => params.getAll(key),
        has: (key) => params.has(key),
        entries: () => params.entries(),
        keys: () => params.keys(),
        values: () => params.values(),
        forEach: (fn) => params.forEach(fn),
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

// Used when a page suspends but no loading.js is registered anywhere.
function DefaultLoading() {
    return h('div', {
        style: { padding: '60px 24px', textAlign: 'center', color: '#666' },
    }, 'Loading…');
}

// Used when a page (or a suspended resource) fails and no error.js is
// registered anywhere. Without this the tree would be left on the loading
// fallback with nothing explaining why.
function DefaultErrorScreen({ error, reset }) {
    return h('div', { style: { padding: '60px 24px', textAlign: 'center', color: '#666' } },
        h('h1', { style: { fontSize: '32px', color: '#c0392b', margin: '0 0 8px' } }, 'Something went wrong'),
        h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '13px' } },
            (error && error.message) || 'Unknown error'),
        h('button', {
            class: 'btn btn-primary',
            style: { padding: '10px 24px', cursor: 'pointer' },
            onClick: () => { if (reset) reset(); else navigate('/'); },
        }, 'Try again')
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

// ─── Router object ───────────────────────────────────────────

export const router = {
    layouts,
    currentParams: {},
    _lastPathname: null,
    _hydrated: false,
    // Transition bookkeeping for loading.js. _epoch invalidates stale timers
    // so a fast navigation can never be replaced by a slow one's spinner.
    _epoch: 0,
    _showingLoading: false,
    _pendingAtStart: 0,

    register(pathname, module) {
        routes[pathname] = module;
    },

    registerLayout(pathname, module) {
        layouts.push({ path: pathname, module });
    },

    registerLoading(pathname, module) {
        loadings.push({ path: pathname, module });
    },

    registerError(pathname, module) {
        errors.push({ path: pathname, module });
    },

    registerNotFound(module) {
        notFoundModule = module;
    },

    async init() {
        // Navigation API — globals so pages need no imports.
        window.navigate = navigate;
        window.useRouter = useRouter;
        window.useParams = useParams;
        window.useSearchParams = useSearchParams;
        window.usePathname = usePathname;
        window.useNavigation = useNavigation;
        window.useTransition = useTransition;
        window.useLocale = useLocale;
        window.Link = Link;
        window.redirect = redirect;
        window.notFound = notFound;
        window.back = back;
        window.forward = forward;
        window.refresh = refresh;
        window.prefetch = prefetch;
        window.__rerenderPage = () => this.render();

        await this.loadRoutes();

        window.addEventListener('popstate', () => this.render());

        await this.render();
        installAutoPrefetch();
    },

    async loadRoutes() {
        let manifest;
        try {
            const res = await fetch('/_framework/routes.json');
            const data = await res.json();
            manifest = Array.isArray(data) ? data : data.routes || [];
            dev = Array.isArray(data) ? true : data.dev !== false;
            if (!Array.isArray(data) && data.i18n) i18nConfig = data.i18n;
            window.__azizDev = dev;
            window.__azizI18n = i18nConfig;
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
                else if (type === 'loading') this.registerLoading(pathname, mod);
                else if (type === 'error') this.registerError(pathname, mod);
                else if (type === 'not-found') this.registerNotFound(mod);
            } catch (err) {
                console.error(`❌ Failed to load ${filePath}:`, err);
            }
        }
    },

// ── Route transition (drives loading.js) ─────────────────
//
// Every page module is imported up front at boot, so a navigation has no
// module-fetch window — data fetching is the only genuinely async part.
// We therefore show the nearest loading.js only if the route still has
// requests in flight after LOADING_DELAY, which avoids flashing a spinner
// on fast routes. Called *after* the page has mounted, because the page's
// effects are what start those requests.

_beginTransition(pathname, loadingComponent, pendingAtStart) {
        const epoch = ++this._epoch;
        this._finishTransition(this._epoch - 1);
        this._showingLoading = false;

        this._pendingAtStart = pendingAtStart;
        if (!loadingComponent) return;

        // NOTE: the page's own requests start in a microtask (useEffect queues
        // with queueMicrotask), so they are NOT running yet at this point. We
        // therefore always arm the timer and let it inspect reality at
        // LOADING_DELAY rather than deciding synchronously.
        this._transitionStop = onLoadState((pending) => {
            if (epoch !== this._epoch || !this._showingLoading) return;
            if (pending > this._pendingAtStart) return;
            // Everything settled — put the real page back.
            this._showingLoading = false;
            this._finishTransition(epoch);
            this._renderAt(pathname);
        });

        this._transitionTimer = setTimeout(() => {
            if (epoch !== this._epoch || this._showingLoading) return;
            if (getPendingLoads() > this._pendingAtStart) {
                this._showingLoading = true;
                this._renderAt(pathname, { forceLoading: true });
            }
        }, LOADING_DELAY);
},

_finishTransition(epoch) {
    if (epoch !== this._epoch) return;
    clearTimeout(this._transitionTimer);
    this._transitionTimer = null;
    if (this._transitionStop) { this._transitionStop(); this._transitionStop = null; }
},

    // A suspended resource rejected — surface it through error.js if there is
    // one. Otherwise fall back to a built-in screen rather than throwing
    // inside a promise callback, which would become an unhandled rejection
    // and leave the user staring at the loading fallback forever.
    _renderSuspendError(reason, layoutComponents, root, pathname) {
        const boundary = collectNearest(errors, pathname);
        const error = reason instanceof Error ? reason : new Error(String(reason));
        const ErrorComponent = (boundary && boundary.module.default) || DefaultErrorScreen;
        disposeFibers();
        console.error('❌ Suspended resource failed', pathname, error);
        mountPage(ErrorComponent, layoutComponents, root, 'error:' + pathname, {
            error,
            reset: () => { this._epoch++; this.render(); },
        });
    },

    async render() {
        return this._renderAt(normalizePath(window.location.pathname));
    },

    async _renderAt(pathname, { forceLoading = false } = {}) {
        const root = document.getElementById('root');
        if (!root) return;

        const isNewRoute = this._lastPathname !== pathname;
        if (isNewRoute) {
            // Unmount previous page: run effect cleanups, drop state
            disposeFibers();
            this._lastPathname = pathname;
        }

        const scrollY = isNewRoute ? 0 : window.scrollY;
        // Baseline before the page's effects kick off their requests.
        const pendingAtStart = getPendingLoads();

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

        // Show the route's loading.js instead of the page while data settles.
        if (forceLoading) {
            const loading = collectNearest(loadings, pathname);
            const LoadingComponent = loading && loading.module.default;
            if (LoadingComponent) {
                const savedL = captureFocus();
                mountPage(LoadingComponent, layoutComponents, root, 'loading:' + pathname);
                restoreFocus(root, savedL);
                if (isNewRoute) window.scrollTo(0, 0);
                return;
            }
        }

        const boundary = collectNearest(errors, pathname);
        const ErrorComponent = boundary && boundary.module.default;
        const saved = captureFocus();

        applyMetadata(mergeMetadata(...layoutModules, pageModule));

        // First client pass: hydrate the server markup instead of throwing it
        // away. If a component suspends, the catch below keeps the SSR HTML
        // on screen until the data lands.
        const ssr = window.__AZIZ_SSR__;
        const canHydrate = !forceLoading &&
            ssr && !this._hydrated &&
            normalizePath(ssr.pathname || '/') === pathname &&
            root.getAttribute && root.getAttribute('data-aziz-ssr') === '1';

        try {
            if (canHydrate) {
                try {
                    hydratePage(PageComponent, layoutComponents, root, 'page:' + pathname);
                    this._hydrated = true;
                    if (forceLoading) this._finishTransition(this._epoch);
                } catch (hydrateErr) {
                    if (isThenable(hydrateErr)) throw hydrateErr;
                    console.warn('⚠️ Hydration mismatch — falling back to a client render.', hydrateErr);
                    mountPage(PageComponent, layoutComponents, root, 'page:' + pathname);
                    this._hydrated = true;
                    if (forceLoading) this._finishTransition(this._epoch);
                }
            } else {
                mountPage(PageComponent, layoutComponents, root, 'page:' + pathname);
                if (forceLoading) this._finishTransition(this._epoch);
            }
        } catch (err) {
            // A component suspended via use(resource). Show the nearest
            // loading.js and re-render once the thrown promise settles.
            if (isThenable(err)) {
                disposeFibers();
                this._suspended = true;
                const loading = collectNearest(loadings, pathname);
                const Fallback = (loading && loading.module.default) || DefaultLoading;
                mountPage(Fallback, layoutComponents, root, 'loading:' + pathname);

                const epoch = ++this._epoch;
                Promise.resolve(err).then(
                    () => {
                        if (epoch !== this._epoch) return;
                        this._suspended = false;
                        this._renderAt(pathname);
                    },
                    (reason) => {
                        if (epoch !== this._epoch) return;
                        this._suspended = false;
                        this._renderSuspendError(reason, layoutComponents, root, pathname);
                    }
                );
                restoreFocus(root, saved);
                if (isNewRoute) window.scrollTo(0, 0);
                return;
            }

            // A page called notFound() — swap in the 404 screen.
            if (err && err.message === NOT_FOUND_SIGNAL) {
                disposeFibers();
                const NotFound = (notFoundModule && notFoundModule.default) || DefaultNotFound;
                mountPage(NotFound, layoutComponents, root, 'notfound:' + pathname);
                applyMetadata(mergeMetadata(...layoutModules, notFoundModule));
            } else if (ErrorComponent) {
                // A real render error — hand it to the nearest error boundary
                // instead of white-screening the app. Next.js shape:
                // error.js receives { error, reset }.
                disposeFibers();
                console.error('❌ Error while rendering', pathname, err);
                mountPage(ErrorComponent, layoutComponents, root, 'error:' + pathname, {
                    error: err,
                    reset: () => { this._epoch++; this._showingLoading = false; this.render(); },
                });
                applyMetadata(mergeMetadata(...layoutModules));
            } else {
                throw err;
            }
        }

        restoreFocus(root, saved);

        if (isNewRoute) window.scrollTo(0, 0);
        else if (scrollY) window.scrollTo(0, scrollY);

        if (typeof window.__azizObserveLinks === 'function') window.__azizObserveLinks(root);

        this._beginTransition(pathname, collectNearest(loadings, pathname), pendingAtStart);
    },
};

export default router;
