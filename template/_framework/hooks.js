// ============================================================
//  Aziz.js Hooks
//  React-identical hooks: useState, useEffect, useMemo,
//  useCallback, useRef, useReducer, useContext
// ============================================================

let currentFiber = null;   // current component being rendered
let hookIndex = 0;         // current hook slot

// Called before rendering a component
export function prepareHooks(fiber) {
    currentFiber = fiber;
    hookIndex = 0;
}

// Called after rendering a component
export function finishHooks() {
    currentFiber = null;
    hookIndex = 0;
}

// Global reset (called before full page re-render)
export function resetHooks() {
    currentFiber = null;
    hookIndex = 0;
}

export function initHooks() {
    // Expose all hooks globally (no import needed in pages)
    window.useState    = useState;
    window.useEffect   = useEffect;
    window.useMemo     = useMemo;
    window.useCallback = useCallback;
    window.useRef      = useRef;
    window.useReducer  = useReducer;
    window.useContext  = useContext;
    window.createContext = createContext;
    window.useLocalStorage = useLocalStorage;
    window.useFetch    = useFetch;
    window.resetHooks  = resetHooks;
    window.prepareHooks = prepareHooks;
    window.finishHooks  = finishHooks;
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
        // Queue cleanup + effect after render
        queueMicrotask(() => {
            if (prev?.cleanup) prev.cleanup();
            const cleanup = callback();
            if (fiber.hooks[idx]) {
                fiber.hooks[idx].cleanup = typeof cleanup === 'function' ? cleanup : undefined;
            }
        });
    }

    fiber.hooks[idx] = { deps, cleanup: prev?.cleanup };
}

// ─── useMemo ─────────────────────────────────────────────────
export function useMemo(factory, deps) {
    const fiber = currentFiber;
    const idx   = hookIndex++;

    if (!fiber) throw new Error('useMemo called outside component');

    const prev = fiber.hooks[idx];
    const changed = !prev || deps.some((d, i) => d !== prev.deps?.[i]);

    if (changed) {
        fiber.hooks[idx] = { value: factory(), deps };
    }

    return fiber.hooks[idx].value;
}

// ─── useCallback ─────────────────────────────────────────────
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

// ─── useContext ───────────────────────────────────────────────
const contexts = new Map();

export function createContext(defaultValue) {
    const ctx = {
        _value: defaultValue,
        Provider({ value, children }) {
            ctx._value = value;
            return children;
        }
    };
    return ctx;
}

export function useContext(ctx) {
    return ctx._value;
}

// ─── useLocalStorage ─────────────────────────────────────────
export function useLocalStorage(key, initial) {
    const [value, setValue] = useState(() => {
        try {
            const stored = localStorage.getItem(key);
            return stored !== null ? JSON.parse(stored) : initial;
        } catch { return initial; }
    });

    const set = (next) => {
        const val = typeof next === 'function' ? next(value) : next;
        setValue(val);
        try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
    };

    return [value, set];
}

// ─── useFetch ────────────────────────────────────────────────
export function useFetch(url, options = {}) {
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);

        fetch(url, options)
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then(d  => { if (!cancelled) { setData(d); setLoading(false); } })
            .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });

        return () => { cancelled = true; };
    }, [url]);

    return { data, loading, error };
}

// ─── Render scheduler ────────────────────────────────────────
let renderScheduled = false;

function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
        renderScheduled = false;
        if (typeof window.__rerenderPage === 'function') {
            window.__rerenderPage();
        }
    });
}
