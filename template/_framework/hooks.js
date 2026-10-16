// ============================================================
//  Aziz.js Hooks
//  React-identical hooks: useState, useEffect, useMemo,
//  useCallback, useRef, useReducer, useContext, useFetch
// ============================================================

let currentFiber = null;   // component instance currently rendering
let hookIndex = 0;         // current hook slot

// Called by the runtime around each component render.
export function prepareHooks(fiber) {
    currentFiber = fiber;
    hookIndex = 0;
}

export function finishHooks() {
    currentFiber = null;
    hookIndex = 0;
}

export function resetHooks() {
    currentFiber = null;
    hookIndex = 0;
}

// ─── Global registration ─────────────────────────────────────

export function initHooks() {
    // Expose all hooks globally (no imports needed in pages)
    window.useState        = useState;
    window.useEffect       = useEffect;
    window.useMemo         = useMemo;
    window.useCallback     = useCallback;
    window.useRef          = useRef;
    window.useReducer      = useReducer;
    window.useContext      = useContext;
    window.createContext   = createContext;
    window.useLocalStorage = useLocalStorage;
    window.useFetch        = useFetch;
    window.useApi          = useFetch;
    window.onLoadState     = onLoadState;
    window.getPendingLoads = getPendingLoads;
    window.clearFetchCache = clearFetchCache;
    window.resetHooks      = resetHooks;
    window.prepareHooks    = prepareHooks;
    window.finishHooks     = finishHooks;
}

// ─── useState ────────────────────────────────────────────────

export function useState(initialValue) {
    const fiber = currentFiber;
    const idx   = hookIndex++;

    if (!fiber) throw new Error('useState called outside component');

    if (fiber.hooks[idx] === undefined) {
        fiber.hooks[idx] = {
            value: typeof initialValue === 'function' ? initialValue() : initialValue
        };
    }

    const hook = fiber.hooks[idx];

    const setState = (next) => {
        if (fiber.mounted === false) return; // component unmounted
        const nextVal = typeof next === 'function' ? next(hook.value) : next;
        if (nextVal !== hook.value) {
            hook.value = nextVal;
            scheduleRender();
        }
    };

    return [hook.value, setState];
}

// ─── useReducer ──────────────────────────────────────────────

export function useReducer(reducer, initialState, init) {
    const [state, setState] = useState(init ? init(initialState) : initialState);
    const dispatch = (action) => setState(prev => reducer(prev, action));
    return [state, dispatch];
}

// ─── useEffect ───────────────────────────────────────────────

export function useEffect(callback, deps) {
    const fiber = currentFiber;
    const idx   = hookIndex++;

    if (!fiber) throw new Error('useEffect called outside component');

    const prev = fiber.hooks[idx];
    const changed = !prev || !deps || deps.some((d, i) => d !== prev.deps?.[i]);

    if (changed) {
        queueMicrotask(() => {
            if (fiber.mounted === false) return;         // unmounted before flush
            if (prev && typeof prev.cleanup === 'function') prev.cleanup();
            const cleanup = callback();
            if (fiber.mounted !== false) {
                fiber.hooks[idx] = fiber.hooks[idx] || {};
                fiber.hooks[idx].cleanup = typeof cleanup === 'function' ? cleanup : undefined;
            }
        });
    }

    if (prev) {
        // Preserve deps/cleanup slots on re-render
        prev.deps = deps;
        fiber.hooks[idx] = prev;
    } else {
        fiber.hooks[idx] = { deps, cleanup: undefined };
    }
}

// ─── useMemo / useCallback ───────────────────────────────────

export function useMemo(factory, deps) {
    const fiber = currentFiber;
    const idx   = hookIndex++;

    if (!fiber) throw new Error('useMemo called outside component');

    const prev = fiber.hooks[idx];
    const changed = !prev || !deps || deps.some((d, i) => d !== prev.deps?.[i]);

    if (changed) {
        fiber.hooks[idx] = { value: factory(), deps };
    }

    return fiber.hooks[idx].value;
}

export function useCallback(fn, deps) {
    return useMemo(() => fn, deps);
}

// ─── useRef ──────────────────────────────────────────────────

export function useRef(initial) {
    const fiber = currentFiber;
    const idx   = hookIndex++;

    if (!fiber) throw new Error('useRef called outside component');

    if (!fiber.hooks[idx]) {
        fiber.hooks[idx] = { current: initial };
    }

    return fiber.hooks[idx];
}

// ─── Context ─────────────────────────────────────────────────

const ctxStack = []; // [{ ctx, value }] — active during provider children render

// Injected by runtime.js to materialize provider children inside the provider scope.
let materializeChildren = (children) => children;

export function setMaterializer(fn) {
    materializeChildren = fn;
}

export function createContext(defaultValue) {
    const ctx = { _defaultValue: defaultValue, Provider: null };

    function ContextProvider(props) {
        ctxStack.push({ ctx, value: props.value });
        try {
            return materializeChildren(props.children);
        } finally {
            ctxStack.pop();
        }
    }
    ContextProvider.displayName = 'Context.Provider';

    ctx.Provider = ContextProvider;
    return ctx;
}

export function useContext(ctx) {
    for (let i = ctxStack.length - 1; i >= 0; i--) {
        if (ctxStack[i].ctx === ctx) return ctxStack[i].value;
    }
    return ctx._defaultValue;
}

// ─── useLocalStorage ─────────────────────────────────────────

export function useLocalStorage(key, initial) {
    const [value, setValue] = useState(() => {
        try {
            const stored = localStorage.getItem(key);
            return stored !== null ? JSON.parse(stored) : initial;
        } catch { return initial; }
    });

    // Keep multiple tabs in sync
    useEffect(() => {
        function onStorage(e) {
            if (e.key !== key || e.newValue === null) return;
            try { setValue(JSON.parse(e.newValue)); } catch { /* ignore */ }
        }
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [key]);

    const set = (next) => {
        const val = typeof next === 'function' ? next(value) : next;
        setValue(val);
        try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
    };

    return [value, set];
}

// ─── Load tracking ───────────────────────────────────────────
//
// A tiny registry of in-flight requests so the router can tell when a route
// has settled. This is what lets app/<route>/loading.js work without a real
// Suspense renderer: after boot every page module is already imported, so
// data fetching is the only genuinely async part of a navigation.

let pendingLoads = 0;
const loadListeners = new Set();

function emitLoadState() {
    for (const fn of loadListeners) {
        try { fn(pendingLoads); } catch { /* listener errors must not break fetching */ }
    }
}

export function beginLoad() {
    pendingLoads++;
    emitLoadState();
}

export function endLoad() {
    pendingLoads = Math.max(0, pendingLoads - 1);
    emitLoadState();
}

export function getPendingLoads() {
    return pendingLoads;
}

export function onLoadState(fn) {
    loadListeners.add(fn);
    fn(pendingLoads);
    return () => loadListeners.delete(fn);
}

// ─── Response cache ──────────────────────────────────────────
//
// Re-mounting a page (for example swapping loading.js out for it) must not
// re-hit the network. Entries are keyed by URL and expire quickly.

const responseCache = new Map();
const CACHE_TTL = 5000;

export function clearFetchCache() {
    responseCache.clear();
}

function cacheKey(url, options) {
    const method = (options.method || 'GET').toUpperCase();
    return method === 'GET' ? url : url + '|' + JSON.stringify(options.body || null);
}

// ─── useFetch ────────────────────────────────────────────────

export function useFetch(url, options = {}) {
    const [state, setState] = useState({ data: null, loading: !!url, error: null, status: null });
    const abortRef = useRef(null);
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        if (!url) {
            setState({ data: null, loading: false, error: null, status: null });
            return;
        }

        // Cancel any in-flight request from a previous render
        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        // Serve a fresh cache entry immediately instead of refetching. This is
        // what makes swapping loading.js out for the page cheap.
        const key = cacheKey(url, options);
        const cached = responseCache.get(key);
        if (cached && Date.now() - cached.at < CACHE_TTL && (options.force || cached.data !== undefined)) {
            setState({ data: cached.data, loading: false, error: null, status: cached.status });
            return;
        }

        setState(prev => ({ ...prev, loading: true, error: null }));

        beginLoad();
        let counted = true;
        const settle = () => {
            if (!counted) return;
            counted = false;
            endLoad();
        };

        fetch(url, { ...options, signal: controller.signal })
            .then(async (res) => {
                const contentType = (res.headers.get('content-type') || '').toLowerCase();
                let data = null;
                if (res.status !== 204) {
                    if (contentType.includes('application/json')) {
                        data = await res.json().catch(() => null);
                    } else {
                        data = await res.text();
                    }
                }
                if (!res.ok) {
                    const message = (data && (data.error || data.message)) || `HTTP ${res.status}`;
                    const err = new Error(typeof message === 'string' ? message : JSON.stringify(message));
                    err.status = res.status;
                    err.data = data;
                    throw err;
                }
                responseCache.set(key, { data, status: res.status, at: Date.now() });
                setState({ data, loading: false, error: null, status: res.status });
                settle();
            })
            .catch((err) => {
                if (err.name === 'AbortError') { settle(); return; }
                setState(prev => ({ ...prev, loading: false, error: err.message, status: err.status || null }));
                settle();
            });

        return () => { controller.abort(); settle(); };
    }, [url, nonce]);

    const refetch = useCallback(() => setNonce(n => n + 1), []);

    return { ...state, refetch };
}

// ─── Render scheduler ────────────────────────────────────────

let renderScheduled = false;

function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;

    const run = () => {
        if (!renderScheduled) return;
        renderScheduled = false;
        if (typeof window.__rerenderPage === 'function') {
            window.__rerenderPage();
        }
    };

    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(run);
        // Fallback: rAF is paused in background tabs
        setTimeout(run, 120);
    } else {
        setTimeout(run, 0);
    }
}
