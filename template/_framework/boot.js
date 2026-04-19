// ============================================================
//  Aziz.js Framework Boot
// ============================================================

import { h, Fragment } from '/_framework/runtime.js';
import { initHooks } from '/_framework/hooks.js';
import { router } from '/_framework/router.js';

// Make h and Fragment globally available for JSX in pages
window.h = h;
window.Fragment = Fragment;

async function boot() {
    console.log('⚡ Aziz.js booting...');
    initHooks();
    await router.init();
    console.log('✅ Aziz.js ready');
}

boot().catch(err => {
    console.error('❌ Boot failed:', err);
    const root = document.getElementById('root');
    if (root) {
        root.innerHTML = `<div style="padding:40px;font-family:monospace;color:red;background:#fff1f0;border:1px solid red;border-radius:8px;margin:40px">
            <h2>⚡ Aziz.js Boot Error</h2>
            <pre style="white-space:pre-wrap">${err.message}</pre>
            <p style="color:#666;font-size:13px">Check the browser console for details.</p>
        </div>`;
    }
});
