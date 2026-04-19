// ============================================================
//  Aziz.js Framework Boot
//  Loads layout.js + page.js for the current route
//  Handles client-side navigation like Next.js App Router
// ============================================================

import { h, render, Fragment } from '/_framework/runtime.js';
import { initHooks, resetHooks } from '/_framework/hooks.js';
import { router } from '/_framework/router.js';

// Make h and Fragment globally available for JSX
window.h = h;
window.Fragment = Fragment;

// Boot the app
async function boot() {
    console.log('⚡ Aziz.js booting...');

    // Initialize hooks system
    initHooks();

    // Start the router
    await router.init();

    console.log('✅ Aziz.js ready');
}

boot().catch(err => {
    console.error('❌ Boot failed:', err);
    document.getElementById('root').innerHTML = `
        <div style="padding:40px;font-family:monospace;color:red">
            <h2>Boot Error</h2>
            <pre>${err.message}</pre>
        </div>
    `;
});
