// ============================================================
//  Aziz.js Framework Boot
// ============================================================

import { h, Fragment } from '/_framework/runtime.js';
import { initHooks } from '/_framework/hooks.js';
import { router } from '/_framework/router.js';
import { Suspense, Image, Font, Script } from '/_framework/components.js';
import api from '/_framework/api.js';

// Make h and Fragment globally available for JSX in pages
window.h = h;
window.Fragment = Fragment;
window.Suspense = Suspense;
window.Image = Image;
window.Font = Font;
window.Script = Script;

// Global API client: api.get('/api/users'), api.post(...), etc.
window.api = api;

// ─── CSRF ─────────────────────────────────────────────────────
//
// In strict mode the server hands every document a `__aziz_csrf`
// cookie and expects it back in the `X-Aziz-CSRF` header on
// state-changing requests. Patching window.fetch once covers the api
// client, useFetch(), fetchResource() and any raw fetch() a page
// writes — and only for same-origin URLs, so the token is never
// handed to a third party.

const CSRF_COOKIE = '__aziz_csrf';
const CSRF_HEADER = 'X-Aziz-CSRF';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfToken() {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + CSRF_COOKIE + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
}

function isSameOrigin(url) {
    try {
        return new URL(url, window.location.href).origin === window.location.origin;
    } catch {
        return false;
    }
}

function withCsrfHeader(input, init) {
    try {
        const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (SAFE_METHODS.has(method)) return [input, init];

        const url = typeof input === 'string' ? input : (input && input.url);
        if (!url || !isSameOrigin(url)) return [input, init];

        const token = csrfToken();
        if (!token) return [input, init];

        const headers = new Headers((init && init.headers) || (input && input.headers) || {});
        if (headers.has(CSRF_HEADER)) return [input, init];
        headers.set(CSRF_HEADER, token);

        if (init) return [input, { ...init, headers }];
        if (input && typeof input.clone === 'function') {
            try {
                return [new Request(input.clone(), { headers }), undefined];
            } catch {
                return [input, init];
            }
        }
        return [input, { headers }];
    } catch {
        return [input, init];
    }
}

const nativeFetch = window.fetch.bind(window);
window.fetch = function azizFetch(input, init) {
    const [url, options] = withCsrfHeader(input, init);
    return nativeFetch(url, options);
};

// ─── SSR data ────────────────────────────────────────────────
//
// The server serialises every GET response it used while rendering. On the
// client those responses are served from memory until the page is hydrated,
// so createResource()/useFetch() do not immediately refetch everything.

window.__AZIZ_DATA__ = (window.__AZIZ_SSR__ && window.__AZIZ_SSR__.data) || null;
window.__azizStreamQueue = [];

if (window.__AZIZ_DATA__ && typeof window.fetch === 'function') {
    const originalFetch = window.fetch.bind(window);
    window.fetch = function seededFetch(input, init) {
        try {
            const url = typeof input === 'string' ? input : (input && input.url);
            const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
            if (method === 'GET' && url && window.__AZIZ_DATA__.data) {
                const entry = window.__AZIZ_DATA__.data['GET:' + url];
                if (entry && !entry.error) {
                    return Promise.resolve(new Response(JSON.stringify(entry.data), {
                        status: entry.status || 200,
                        headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    }));
                }
            }
        } catch { /* fall through to the network */ }
        return originalFetch(input, init);
    };
}

// Route-level streaming lands after the shell has painted. Replace the root
// markup and let the router hydrate/re-render it so events are attached.
window.__azizStreamReplace = function azizStreamReplaceMaking(html) {
    const root = document.getElementById('root');
    if (!root) return;
    root.innerHTML = html;
    root.setAttribute('data-aziz-ssr', '1');
    if (window.__azizReady) {
        router._hydrated = false;
        router.render();
    }
};

async function boot() {
    initHooks();
    await router.init();
    window.__azizReady = true;

    if (window.__azizStreamQueue.length) {
        const pending = window.__azizStreamQueue.splice(0);
        for (const html of pending) window.__azizStreamReplace(html);
    }
}

boot().catch(err => {
    console.error('❌ Aziz.js boot failed:', err);
    const root = document.getElementById('root');
    if (root) {
        root.innerHTML = `<div style="padding:40px;font-family:monospace;color:#b00;background:#fff1f0;border:1px solid #e88;border-radius:8px;margin:40px">
            <h2>⚡ Aziz.js Boot Error</h2>
            <pre style="white-space:pre-wrap">${String(err && err.message || err)}</pre>
            <p style="color:#666;font-size:13px">Check the browser console for details.</p>
        </div>`;
    }
});
