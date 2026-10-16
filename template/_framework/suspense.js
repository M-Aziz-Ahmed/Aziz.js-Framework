// ============================================================
//  Aziz.js Suspense
//  Page-level data suspension, Next.js `loading.js` style.
//
//  createResource(promise) → a cached, thenable-backed resource
//  use(resource)           → returns the value, or throws the promise
//                            while it is still pending
//
//  When a page suspends, the router shows the nearest loading.js and
//  re-renders the page once every thrown promise settles. That means a page
//  does not have to thread `loading`/`error` through every component — the
//  nearest loading.js is the fallback.
//
//  Scope: this is page-level suspension, not React's concurrent renderer.
//  There is no streaming and no partial in-place swap — the whole page is
//  replaced by loading.js and rendered again when its data arrives.
// ============================================================

function isThenable(value) {
    return !!value && (typeof value === 'object' || typeof value === 'function') &&
        typeof value.then === 'function';
}

const PENDING = 'pending';
const SUCCESS = 'success';
const ERROR = 'error';

// Wrap a promise so it can be read synchronously once it settles.
// `promise` may be a value, a promise, or a function returning either.
export function createResource(source) {
    let status = PENDING;
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
            status = ERROR;
            error = err;
            // A throw still needs to be awaitable so callers can settle.
            promise = Promise.reject(err);
            promise.catch(() => {});
            return promise;
        }

        if (!isThenable(result)) {
            status = SUCCESS;
            value = result;
            promise = Promise.resolve(result);
            return promise;
        }

        promise = result.then(
            (v) => { status = SUCCESS; value = v; return v; },
            (e) => { status = ERROR; error = e; throw e; }
        );
        // Swallow the rejection on our copy; the caller reads .error.
        promise.catch(() => {});
        return promise;
    };

    // Read the resource, suspending the caller if it is not ready yet.
    const read = () => {
        run();
        if (status === PENDING) throw promise;
        if (status === ERROR) throw error;
        return value;
    };

    // Warm it without reading, e.g. from an event handler.
    const prefetch = () => run();

    return {
        read,
        prefetch,
        get status() { run(); return status; },
        get value() { run(); return value; },
        get error() { return error; },
        get promise() { run(); return promise; },
        get pending() { return run() && status === PENDING; },
    };
}

// Read a resource (or bare promise) during render.
export function use(resource) {
    if (resource && typeof resource.read === 'function') return resource.read();
    if (isThenable(resource)) return createResource(resource).read();
    return resource;
}

// Convenience: fetch JSON and wrap it as a resource.
export function fetchResource(url, options) {
    return createResource(async () => {
        const res = await fetch(url, options);
        if (!res.ok) {
            const err = new Error(`HTTP ${res.status}`);
            err.status = res.status;
            throw err;
        }
        return res.json();
    });
}

export { isThenable };