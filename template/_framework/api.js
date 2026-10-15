// ============================================================
//  Aziz.js API Client
//  A tiny, dependency-free fetch wrapper for talking to
//  /api/** route handlers (or any REST backend).
//
//    const users = await api.get('/api/users');
//    const created = await api.post('/api/users', { name: 'A' });
//    await api.put('/api/users?id=1', { name: 'B' });
//    await api.delete('/api/users?id=1');
//
//  Features:
//    - baseURL + default headers
//    - automatic JSON encode / decode
//    - request timeouts (AbortController)
//    - external AbortSignal support
//    - retries with backoff for 5xx / network errors
//    - typed ApiError with { status, data }
//    - query string helper
// ============================================================

export class ApiError extends Error {
    constructor(message, { status = 0, data = null, url = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.data = data;
        this.url = url;
    }
}

const defaults = {
    baseURL: '',
    timeout: 15000,
    retries: 0,
    headers: {},
};

function buildURL(path, query) {
    let url = /^https?:\/\//i.test(path)
        ? path
        : defaults.baseURL
            ? defaults.baseURL.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path)
            : path;

    if (query && typeof query === 'object') {
        const qs = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined || value === null) continue;
            if (Array.isArray(value)) value.forEach(v => qs.append(key, v));
            else qs.append(key, value);
        }
        const s = qs.toString();
        if (s) url += (url.includes('?') ? '&' : '?') + s;
    }

    return url;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function parseResponse(res, raw) {
    if (raw) return res;

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (res.status === 204 || res.status === 205) return null;

    if (contentType.includes('application/json')) {
        return res.json().catch(() => null);
    }
    if (contentType.startsWith('text/') || contentType.includes('html') || contentType.includes('xml')) {
        return res.text();
    }
    return res.blob();
}

function extractMessage(data, status) {
    if (data && typeof data === 'object') {
        const raw = data.error ?? data.message ?? data.detail;
        if (typeof raw === 'string') return raw;
        if (raw && typeof raw === 'object') return raw.message || JSON.stringify(raw);
    }
    if (typeof data === 'string' && data.trim()) return data.trim().slice(0, 200);
    return `Request failed with status ${status}`;
}

async function request(path, options = {}) {
    const {
        method = 'GET',
        body,
        headers = {},
        query,
        timeout = defaults.timeout,
        retries = defaults.retries,
        signal,
        raw = false,
    } = options;

    const url = buildURL(path, query);

    const finalHeaders = { 'Accept': 'application/json', ...defaults.headers, ...headers };
    let payload = body;

    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const isBlob = typeof Blob !== 'undefined' && body instanceof Blob;

    if (body !== undefined && body !== null && !isFormData && !isBlob && typeof body !== 'string') {
        payload = JSON.stringify(body);
        if (!finalHeaders['Content-Type']) finalHeaders['Content-Type'] = 'application/json';
    }

    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        let timedOut = false;

        const timer = timeout > 0
            ? setTimeout(() => { timedOut = true; controller.abort(); }, timeout)
            : null;

        const onExternalAbort = () => controller.abort();
        if (signal) {
            if (signal.aborted) controller.abort();
            else signal.addEventListener('abort', onExternalAbort, { once: true });
        }

        try {
            const res = await fetch(url, {
                method,
                headers: finalHeaders,
                body: payload,
                signal: controller.signal,
            });

            const data = await parseResponse(res, raw);

            if (!res.ok) {
                const err = new ApiError(extractMessage(data, res.status), {
                    status: res.status,
                    data: raw ? null : data,
                    url,
                });
                // Only retry server errors / rate limits
                if (res.status >= 500 || res.status === 429) {
                    lastError = err;
                } else {
                    throw err;
                }
            } else {
                return data;
            }
        } catch (err) {
            if (err instanceof ApiError && !(err.status >= 500 || err.status === 429)) {
                throw err; // client error — never retry
            }
            if (err.name === 'AbortError') {
                if (signal && signal.aborted) throw err; // caller aborted
                lastError = new ApiError(
                    timedOut ? `Request timed out after ${timeout}ms` : 'Request aborted',
                    { status: 0, url }
                );
            } else if (err instanceof ApiError) {
                lastError = err;
            } else {
                lastError = new ApiError(err.message || 'Network error', { status: 0, url });
            }
        } finally {
            if (timer) clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onExternalAbort);
        }

        if (attempt < retries) {
            await sleep(200 * Math.pow(2, attempt)); // 200ms, 400ms, 800ms…
        }
    }

    throw lastError || new ApiError('Request failed', { status: 0, url });
}

export const api = {
    ApiError,

    /** Set a base URL applied to every relative path. */
    setBaseURL(baseURL) { defaults.baseURL = baseURL || ''; return api; },

    /** Merge default headers (e.g. Authorization). */
    setHeaders(headers) { Object.assign(defaults.headers, headers || {}); return api; },

    /** Configure timeout / retries / baseURL / headers at once. */
    configure(opts = {}) {
        if ('baseURL' in opts) defaults.baseURL = opts.baseURL || '';
        if ('timeout' in opts) defaults.timeout = opts.timeout;
        if ('retries' in opts) defaults.retries = opts.retries;
        if ('headers' in opts) Object.assign(defaults.headers, opts.headers || {});
        return api;
    },

    get defaults() { return { ...defaults, headers: { ...defaults.headers } }; },

    request,

    get:     (path, options) => request(path, { ...options, method: 'GET' }),
    post:    (path, body, options) => request(path, { ...options, method: 'POST', body }),
    put:     (path, body, options) => request(path, { ...options, method: 'PUT', body }),
    patch:   (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
    delete:  (path, options) => request(path, { ...options, method: 'DELETE' }),
    del:     (path, options) => request(path, { ...options, method: 'DELETE' }),
    head:    (path, options) => request(path, { ...options, method: 'HEAD', raw: true }),

    /** Send multipart/form-data. */
    form: (path, formData, options) => request(path, { ...options, method: 'POST', body: formData }),

    /** Low-level: return the raw Response instead of parsed data. */
    raw: (path, options) => request(path, { ...options, raw: true }),
};

export default api;
