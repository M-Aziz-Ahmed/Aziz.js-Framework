// ============================================================
//  Aziz.js Framework Boot
// ============================================================

import { h, Fragment } from '/_framework/runtime.js';
import { initHooks } from '/_framework/hooks.js';
import { router } from '/_framework/router.js';
import api from '/_framework/api.js';

// Make h and Fragment globally available for JSX in pages
window.h = h;
window.Fragment = Fragment;

// Global API client: api.get('/api/users'), api.post(...), etc.
window.api = api;

async function boot() {
    initHooks();
    await router.init();
    window.__azizReady = true;
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
