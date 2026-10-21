// ============================================================
//  Aziz.js server runtime
//
//  A DOM-free mirror of the browser runtime, used by the SSR /
//  SSG pipeline. Components are executed with the same hook names
//  they use in the browser, but effects are inert and state is
//  initialised on every pass. Async work is represented the same
//  way the client represents it: a thrown thenable suspends the
//  subtree until the promise settles.
// ============================================================

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

const VNODE = Symbol('aziz.vnode');
const Fragment = Symbol('Fragment');
const PROVIDER = Symbol('aziz.provider');
const SUSPENSE = Symbol('aziz.suspense');

// ─── Render context ──────────────────────────────────────────

function createRenderContext(options = {}) {
    return {
        pathname: options.pathname || '/',
        params: options.params || {},
        searchParams: options.searchParams || new URLSearchParams(),
        locale: options.locale || null,
        locales: options.locales || null,
        defaultLocale: options.defaultLocale || null,
        localePrefix: options.localePrefix || 'always',
        origin: options.origin || 'http://localhost',
        requestHeaders: options.requestHeaders || {},
        // GET responses are cached for the duration of one render. This is
        // what makes `useFetch`/`fetchResource` resolve on the retry pass.
        fetchCache: new Map(),
        fetchInFlight: new Map(),
        fetchImpl: options.fetchImpl || globalThis.fetch,
        // Async component output cache, keyed by fiber id.
        asyncOutputs: new Map(),
        headLinks: Array.isArray(options.headLinks) ? [...options.headLinks] : [],
        headStyles: Array.isArray(options.headStyles) ? [...options.headStyles] : [],
        ctxStack: [],
        // Filled by the renderer and serialised into window.__AZIZ_DATA__.
        serialized: {},
        streaming: !!options.streaming,
        baseUrl: options.baseUrl || '',
    };
}

function getRenderContext() {
    return als.getStore() || null;
}

function runWithRenderContext(context, fn) {
    return als.run(context, fn);
}

// ─── Descriptors ─────────────────────────────────────────────

function flatChildren(children) {
    return children
        .flat(Infinity)
        .filter(c => c !== null && c !== undefined && c !== false && c !== true);
}

function h(tag, props, ...children) {
    let kids = flatChildren(children);
    if (kids.length === 0 && props && props.children !== undefined && props.children !== null) {
        kids = flatChildren(Array.isArray(props.children) ? props.children : [props.children]);
    }
    return { [VNODE]: true, type: tag, props: props || null, children: kids };
}

function isVNode(value) {
    return !!value && typeof value === 'object' && value[VNODE] === true;
}

function isThenable(value) {
    return !!value && (typeof value === 'object' || typeof value === 'function') &&
        typeof value.then === 'function';
}

// ─── Hooks ───────────────────────────────────────────────────

let currentFiber = null;
let hookIndex = 0;

function prepareHooks(fiber) {
    currentFiber = fiber;
    hookIndex = 0;
}

function finishHooks() {
    currentFiber = null;
    hookIndex = 0;
}

function useState(initialValue) {
    const fiber = currentFiber;
    if (!fiber) throw new Error('useState called outside component');
    const idx = hookIndex++;
    if (fiber.hooks[idx] === undefined) {
        fiber.hooks[idx] = {
            value: typeof initialValue === 'function' ? initialValue() : initialValue,
        };
    }
    return [fiber.hooks[idx].value, () => {}];
}

function useReducer(reducer, initialState, init) {
    const [state] = useState(init ? init(initialState) : initialState);
    return [state, () => {}];
}

function useEffect() {
    // Effects never run during server rendering.
}

function useMemo(factory) {
    if (!currentFiber) throw new Error('useMemo called outside component');
    hookIndex++;
    return factory();
}

function useCallback(fn) {
    if (!currentFiber) throw new Error('useCallback called outside component');
    hookIndex++;
    return fn;
}

function useRef(initial) {
    const fiber = currentFiber;
    if (!fiber) throw new Error('useRef called outside component');
    const idx = hookIndex++;
    if (!fiber.hooks[idx]) fiber.hooks[idx] = { current: initial };
    return fiber.hooks[idx];
}

function createContext(defaultValue) {
    const ctx = { _defaultValue: defaultValue, _azizContext: true, Provider: null };
    function Provider(props) {
        return { [VNODE]: true, type: PROVIDER, props, children: props.children, ctx };
    }
    Provider.displayName = 'Context.Provider';
    ctx.Provider = Provider;
    return ctx;
}

function useContext(ctx) {
    const renderCtx = getRenderContext();
    const stack = renderCtx ? renderCtx.ctxStack : [];
    for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].ctx === ctx) return stack[i].value;
    }
    return ctx._defaultValue;
}

function useLocalStorage(key, initial) {
    return [initial, () => {}];
}

function useTransition() {
    return [false, callback => callback()];
}

// ─── Navigation hooks (request-scoped) ───────────────────────

function usePathname() {
    const ctx = getRenderContext();
    return ctx ? ctx.pathname : '/';
}

function useParams() {
    const ctx = getRenderContext();
    return (ctx && ctx.params) || {};
}

function useSearchParams() {
    const ctx = getRenderContext();
    const params = (ctx && ctx.searchParams) || new URLSearchParams();
    return {
        get: key => params.get(key),
        getAll: key => params.getAll(key),
        has: key => params.has(key),
        entries: () => params.entries(),
        keys: () => params.keys(),
        values: () => params.values(),
        forEach: fn => params.forEach(fn),
        toString: () => params.toString(),
    };
}

function useLocale() {
    const ctx = getRenderContext();
    return (ctx && ctx.locale) || (ctx && ctx.defaultLocale) || '';
}

function useRouter() {
    return {
        pathname: usePathname(),
        params: useParams(),
        locale: useLocale(),
        push: () => {},
        replace: () => {},
        back: () => {},
        forward: () => {},
        refresh: () => {},
        prefetch: () => Promise.resolve(),
    };
}

function useNavigation() {
    return { isPending: false, state: 'idle', ...useRouter() };
}

// ─── Navigation signals ──────────────────────────────────────

function notFound() {
    const err = new Error('AZIZ_NOT_FOUND');
    err.__azizNotFound = true;
    throw err;
}

function redirect(url, status = 307) {
    const err = new Error('AZIZ_REDIRECT');
    err.__azizRedirect = String(url);
    err.__azizRedirectStatus = status;
    throw err;
}

// ─── Suspense ────────────────────────────────────────────────

function Suspense(props) {
    return { [VNODE]: true, type: SUSPENSE, props, children: props.children };
}

function createResource(source) {
    let status = 'pending';
    let value;
    let error;
    let started = false;
    let promise;

    const run = () => {
        if (started) return promise;
        started = true;
        let result;
        try {
            result = typeof source === 'function' ? source() : source;
        } catch (err) {
            status = 'error';
            error = err;
            promise = Promise.reject(err);
            promise.catch(() => {});
            return promise;
        }
        if (!isThenable(result)) {
            status = 'success';
            value = result;
            promise = Promise.resolve(result);
            return promise;
        }
        promise = result.then(
            v => { status = 'success'; value = v; return v; },
            e => { status = 'error'; error = e; throw e; }
        );
        promise.catch(() => {});
        return promise;
    };

    const read = () => {
        run();
        if (status === 'pending') throw promise;
        if (status === 'error') throw error;
        return value;
    };

    return {
        read,
        prefetch: run,
        get status() { run(); return status; },
        get value() { run(); return value; },
        get error() { return error; },
        get promise() { run(); return promise; },
        get pending() { run(); return status === 'pending'; },
    };
}

function use(resource) {
    if (resource && typeof resource.read === 'function') return resource.read();
    if (isThenable(resource)) return createResource(resource).read();
    return resource;
}

function fetchKey(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    return method + ':' + url + (method === 'GET' ? '' : '|' + String(options.body ?? ''));
}

function serverFetch(url, options = {}, ctxOverride) {
    const ctx = ctxOverride || getRenderContext();
    const key = fetchKey(url, options);

    if (ctx && ctx.fetchCache.has(key)) {
        return Promise.resolve(ctx.fetchCache.get(key));
    }

    let absolute = String(url);
    if (!/^https?:\/\//i.test(absolute) && ctx) {
        absolute = ctx.origin.replace(/\/+$/, '') + (absolute.startsWith('/') ? absolute : '/' + absolute);
    }

    const headers = { ...(options.headers || {}) };
    if (ctx) {
        const incoming = ctx.requestHeaders || {};
        if (incoming.cookie && !headers.cookie && !headers.Cookie) headers.cookie = incoming.cookie;
        if (incoming.authorization && !headers.authorization) headers.authorization = incoming.authorization;
    }

    const doFetch = ctx && typeof ctx.fetchImpl === 'function' ? ctx.fetchImpl : globalThis.fetch;
    if (typeof doFetch !== 'function') {
        return Promise.reject(new Error('fetch() is not available in this runtime'));
    }

    const promise = doFetch(absolute, { ...options, headers }).then(async res => {
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        let data = null;
        if (res.status !== 204) {
            data = contentType.includes('application/json')
                ? await res.json().catch(() => null)
                : await res.text();
        }
        const entry = { data, status: res.status, ok: res.ok, url: absolute };
        if (ctx) {
            if (!res.ok) {
                const err = new Error(
                    (data && (data.error || data.message)) || `HTTP ${res.status}`
                );
                err.status = res.status;
                err.data = data;
                entry.error = err;
                ctx.fetchCache.set(key, entry);
                throw err;
            }
            ctx.fetchCache.set(key, entry);
        }
        return entry;
    });

    if (ctx) ctx.fetchInFlight.set(key, promise);
    return promise;
}

function fetchResource(url, options) {
    const ctx = getRenderContext();
    const key = fetchKey(url, options || {});
    if (ctx && ctx.fetchCache.has(key)) {
        const entry = ctx.fetchCache.get(key);
        if (entry.error) throw entry.error;
        return createResource(entry.data);
    }
    return createResource(async () => {
        const entry = await serverFetch(url, options || {});
        return entry.data;
    });
}

function useFetch(url, options = {}) {
    const ctx = getRenderContext();
    if (!url) {
        return { data: null, loading: false, error: null, status: null, refetch: () => {} };
    }

    const key = fetchKey(url, options);
    if (ctx && ctx.fetchCache.has(key)) {
        const entry = ctx.fetchCache.get(key);
        return {
            data: entry.data,
            loading: false,
            error: entry.error ? entry.error.message : null,
            status: entry.status,
            refetch: () => {},
        };
    }

    throw serverFetch(url, options);
}

function warmCache() {
    return Promise.resolve();
}

function clearFetchCache() {
    const ctx = getRenderContext();
    if (ctx) {
        ctx.fetchCache.clear();
        ctx.fetchInFlight.clear();
    }
}

function getPendingLoads() { return 0; }
function onLoadState(fn) { if (typeof fn === 'function') fn(0); return () => {}; }

// ─── Media / components ──────────────────────────────────────

const LOCALE_SEGMENT_RE = /^\/([a-z]{2}(?:-[a-zA-Z]{2,})?)(?:\/|$)/;

function localizeHref(href, ctx) {
    if (!ctx || !ctx.i18n) return href;
    if (!href || !href.startsWith('/')) return href;
    if (ctx.localePrefix === 'never') return href;
    if (LOCALE_SEGMENT_RE.test(href)) return href;
    const locale = ctx.locale || ctx.defaultLocale;
    if (!locale) return href;
    if (ctx.localePrefix === 'as-needed' && locale === ctx.defaultLocale) return href;
    return '/' + locale + (href === '/' ? '' : href);
}

function Link({ href, children, className, class: klass, style, onClick, replace, scroll, prefetch: prefetchProp, ...rest }) {
    const ctx = getRenderContext();
    const finalHref = localizeHref(href, ctx);
    return h('a', {
        ...rest,
        href: finalHref,
        class: className ?? klass,
        style,
        'data-aziz-link': '',
        'data-prefetch': prefetchProp === false ? 'false' : 'true',
    }, ...(Array.isArray(children) ? children : [children]));
}

function buildImageSrcSet(src, widths, quality, format) {
    return widths.map(w => {
        const params = new URLSearchParams({ src, w: String(w) });
        if (quality) params.set('q', String(quality));
        params.set('f', format || 'auto');
        return '/_aziz/image?' + params.toString() + ' ' + w + 'w';
    }).join(', ');
}

function Image({
    src,
    alt = '',
    width,
    height,
    sizes,
    quality = 75,
    format = 'auto',
    priority = false,
    fill = false,
    className,
    class: klass,
    style,
    ...rest
}) {
    const ctx = getRenderContext();
    const numericWidth = Number(width) || 0;
    const numericHeight = Number(height) || 0;
    const widths = rest.widths ||
        (numericWidth ? [numericWidth, numericWidth * 2].filter((v, i, a) => a.indexOf(v) === i) : []);
    delete rest.widths;

    const props = {
        ...rest,
        src: widths.length ? `/_aziz/image?src=${encodeURIComponent(src)}&w=${widths[0]}&q=${quality}&f=${format}` : src,
        alt,
        class: className ?? klass,
        decoding: 'async',
        loading: priority ? 'eager' : 'lazy',
    };
    if (priority) props.fetchpriority = 'high';
    if (fill) {
        props.style = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...(style || {}) };
    } else {
        if (width != null) props.width = width;
        if (height != null) props.height = height;
        if (style) props.style = style;
    }
    if (sizes) props.sizes = sizes;
    if (widths.length > 1) props.srcset = buildImageSrcSet(src, widths, quality, format);

    if (ctx && priority) {
        ctx.headLinks.push({
            rel: 'preload',
            as: 'image',
            href: props.src,
            imagesrcset: props.srcset,
            imagesizes: sizes,
            fetchpriority: 'high',
        });
    }

    return h('img', props);
}

function Font({ family, href, weight = '400', style = 'normal', display = 'swap', preload = true, sizeAdjust, ...rest }) {
    const ctx = getRenderContext();
    const type = href && href.endsWith('.woff2') ? 'font/woff2'
        : href && href.endsWith('.woff') ? 'font/woff'
        : href && href.endsWith('.ttf') ? 'font/ttf'
        : 'font/woff2';

    if (ctx && href && preload) {
        ctx.headLinks.push({ rel: 'preload', as: 'font', href, type, crossorigin: '' });
    }
    if (ctx && href) {
        ctx.headStyles.push(
            `@font-face{font-family:${JSON.stringify(family || 'AzizFont')};` +
            `src:url(${JSON.stringify(href)}) format(${JSON.stringify(type.replace('font/', ''))});` +
            `font-weight:${weight};font-style:${style};font-display:${display};` +
            (sizeAdjust ? `size-adjust:${sizeAdjust};` : '') + '}'
        );
    }
    return null;
}

function Script({ src, children, strategy = 'afterInteractive', ...rest }) {
    if (src) {
        return h('script', {
            ...rest,
            src,
            defer: strategy !== 'beforeInteractive',
            'data-strategy': strategy,
        });
    }
    return h('script', { ...rest, dangerouslySetInnerHTML: { __html: String(children ?? '') } });
}

// ─── Metadata ────────────────────────────────────────────────

function deepMerge(base, extra) {
    const out = { ...base };
    for (const [key, value] of Object.entries(extra || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            out[key] = deepMerge(out[key] || {}, value);
        } else if (value !== undefined) {
            out[key] = value;
        }
    }
    return out;
}

function mergeTitle(base, extra) {
    if (extra === undefined) return base;
    if (typeof extra === 'string') {
        if (base && typeof base === 'object' && base.template) {
            return { default: extra, template: base.template };
        }
        return extra;
    }
    if (extra && typeof extra === 'object') {
        const merged = {
            ...(base && typeof base === 'object' ? base : {}),
            ...extra,
        };
        if (!merged.template && base && typeof base === 'object' && base.template) {
            merged.template = base.template;
        }
        return merged;
    }
    return extra;
}

function mergeMetadata(...modules) {
    let acc = {};
    for (const mod of modules) {
        const block = (mod && mod.metadata) || {};
        const rest = { ...block };
        delete rest.title;
        acc = deepMerge(acc, rest);
        if (Object.prototype.hasOwnProperty.call(block, 'title')) {
            acc.title = mergeTitle(acc.title, block.title);
        }
    }
    return acc;
}

function metaTitle(title) {
    if (!title) return '';
    if (typeof title === 'string') return title;
    if (typeof title === 'object') return title.absolute || title.default || '';
    return '';
}

function metaTitleTemplate(title, metadata) {
    const t = metadata && metadata.title;
    if (t && typeof t === 'object' && t.template && typeof title === 'string') {
        return t.template.replace('%s', title);
    }
    return metaTitle(title) || title;
}

function HeadCollector(ctx) {
    ctx.headLinks = ctx.headLinks || [];
    ctx.headStyles = ctx.headStyles || [];
}

function getHead(ctx) {
    return { links: ctx.headLinks, styles: ctx.headStyles };
}

const exported = {
    // Descriptors / runtime
    h, Fragment, VNODE, PROVIDER, SUSPENSE,
    isVNode, isThenable, flatChildren,
    createRenderContext, getRenderContext, runWithRenderContext,
    prepareHooks, finishHooks,

    // Hooks
    useState, useReducer, useEffect, useMemo, useCallback, useRef,
    createContext, useContext, useLocalStorage, useTransition,
    usePathname, useParams, useSearchParams, useLocale, useRouter, useNavigation,
    useFetch, use, createResource, fetchResource, warmCache, clearFetchCache,
    getPendingLoads, onLoadState,

    // Navigation
    notFound, redirect,

    // Components
    Suspense, Link, Image, Font, Script,

    // Metadata
    mergeMetadata, metaTitle, metaTitleTemplate, deepMerge, HeadCollector, getHead,

    // Utilities
    localizeHref, buildImageSrcSet, serverFetch,
};

module.exports = exported;
