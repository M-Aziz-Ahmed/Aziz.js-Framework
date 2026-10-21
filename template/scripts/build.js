#!/usr/bin/env node

// ============================================================
//  Aziz.js static build (SSG + ISR seed)
//
//  Boots the production server on a private port, asks it for the
//  pages that are statically renderable, and writes the resulting
//  documents to .aziz/static. Dynamic routes are expanded with
//  generateStaticParams(); pages with `dynamic = 'force-dynamic'`
//  are left to the runtime. Pages that set `revalidate` are written
//  as ISR seeds and revalidated by the server.
// ============================================================

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { buildServerRoutes } = require('./lib/route-manifest');
const { ServerModuleLoader } = require('./lib/module-loader');
const staticStore = require('./lib/static-store');
const tailwind = require('./lib/tailwind');
const precompile = require('./lib/precompile');

const ROOT = process.cwd();
const SERVER = path.join(__dirname, 'dev-server.js');
const PORT = parseInt(process.env.BUILD_PORT, 10) || 34000 + Math.floor(Math.random() * 2000);

function applyParams(pattern, params) {
    let p = pattern.replace(/\[\.\.\.([^\]]+)\]/g, (_, name) => {
        const value = params[name];
        return Array.isArray(value) ? value.map(encodeURIComponent).join('/') : encodeURIComponent(value || '');
    });
    p = p.replace(/\[([^\]]+)\]/g, (_, name) => encodeURIComponent(params[name] ?? ''));
    if (!p.startsWith('/')) p = '/' + p;
    return p.replace(/\/+/g, '/') || '/';
}

function hasParams(pattern) {
    return /\[[^\]]+\]/.test(pattern);
}

function localizedPaths(pattern, i18n) {
    if (!i18n || /\[locale\]/.test(pattern)) return [pattern];
    const base = pattern === '/' ? '' : pattern;
    return i18n.locales.map(locale => {
        if (i18n.localePrefix === 'as-needed' && locale === i18n.defaultLocale) return pattern;
        return '/' + locale + base;
    });
}

async function waitForServer(getBase, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const res = await fetch(getBase() + '/_framework/routes.json');
            if (res.ok) return true;
        } catch { /* not ready */ }
        await new Promise(r => setTimeout(r, 150));
    }
    return false;
}

async function main() {
    const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
    console.log('📦 Aziz.js build\n');

    if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
        console.error('❌ index.html not found. Run this from the project root.');
        process.exit(1);
    }

    const css = tailwind.build(ROOT, { minify: true });
    if (!css.ok) {
        throw new Error(`Tailwind CSS failed: ${css.reason}`);
    }
    if (!css.skipped) console.log('🎨 Tailwind CSS built\n');

    // ─── Precompile ────────────────────────────────────────────
    // JSX/TypeScript is compiled once, here, instead of on every
    // server start. The production server then loads these artifacts
    // directly: no Babel in the request path, ~100 ms faster cold
    // start, ~60 MB less memory per worker.
    const compiled = precompile.compileProject(ROOT);
    if (!compiled.ok) {
        console.error(`❌ Precompile failed: ${compiled.reason}`);
        process.exit(1);
    }
    const fileCount = Object.keys(compiled.manifest.files).length;
    console.log(`⚡ Precompiled ${fileCount} module(s) in ${compiled.manifest.durationMs} ms`);

    // Dependency report — the no-bundler failure mode is a package
    // that cannot run in a browser. Fail the build instead of
    // shipping a blank page.
    const deps = compiled.manifest.deps;
    if (deps.packages.length) {
        console.log(`📦 ${deps.packages.length} browser dependenc${deps.packages.length === 1 ? 'y' : 'ies'}: ` +
            deps.packages.map(d => `${d.name}@${d.version || '?'}`).join(', '));
    }
    if (deps.commonjsOnly.length) {
        console.warn(`⚠️  CommonJS-only (no browser/ESM build) — these will fail in the browser:`);
        for (const name of deps.commonjsOnly) {
            console.warn(`     - ${name}: import it in an API route, or use a package with an ESM build.`);
        }
    }
    if (deps.missing.length) {
        console.error(`❌ Missing dependenc${deps.missing.length === 1 ? 'y' : 'ies'}: ${deps.missing.join(', ')}`);
        console.error('   Run "npm install" and build again.');
        process.exit(1);
    }
    console.log('');

    staticStore.clear(ROOT);

    const routes = buildServerRoutes(ROOT, { compiled: precompile.browserUrlMap(compiled.manifest) });
    const loader = new ServerModuleLoader(ROOT, {
        precompiled: precompile.serverArtifactMap(ROOT, compiled.manifest),
    });

    const jobs = [];
    const seenPaths = new Set();
    for (const page of Object.values(routes.pages)) {
        let mod;
        try {
            mod = loader.load(page.pageFile);
        } catch (err) {
            console.warn(`⚠️  Skipping ${page.pattern}: ${err.message}`);
            continue;
        }

        if (mod.dynamic === 'force-dynamic' || mod.prerender === false) {
            console.log(`   ⏭️  ${page.pattern} — dynamic (server-rendered)`);
            continue;
        }

        const revalidate = Number(mod.revalidate) || null;
        let paths = [];

        if (hasParams(page.pattern)) {
            let paramsList;
            const localeOnly = routes.i18n && page.pattern.includes('[locale]') &&
                !/\[[^\]]+\]/.test(page.pattern.replace(/\[locale\]/g, ''));

            if (typeof mod.generateStaticParams === 'function') {
                try {
                    paramsList = await mod.generateStaticParams();
                } catch (err) {
                    console.warn(`⚠️  ${page.pattern} generateStaticParams() failed: ${err.message}`);
                    continue;
                }
            } else if (localeOnly) {
                paramsList = routes.i18n.locales.map(locale => ({ locale }));
            } else {
                console.log(`   ⏭️  ${page.pattern} — dynamic (no generateStaticParams)`);
                continue;
            }
            paths = (paramsList || []).map(params => applyParams(page.pattern, params));
        } else {
            paths = localizedPaths(page.pattern, routes.i18n);
        }

        if (only.length) {
            paths = paths.filter(p => only.some(o => p === o || p.startsWith(o.replace(/\/$/, '') + '/')));
        }

        for (const p of paths) {
            if (seenPaths.has(p)) continue;
            seenPaths.add(p);
            jobs.push({ pathname: p, page, revalidate, dynamic: mod.dynamic || 'force-static' });
        }
    }

    if (!jobs.length) {
        console.log('\nNo statically renderable pages found.');
        return;
    }

    const child = spawn(process.execPath, [SERVER, '--production'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT), AZIZ_BUILD: '1', AZIZ_STREAMING: '0', AZIZ_SKIP_CSS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let serverOutput = '';
    child.stdout.on('data', d => { serverOutput += d.toString(); });
    child.stderr.on('data', d => { serverOutput += d.toString(); });

    let base = `http://127.0.0.1:${PORT}`;
    const ready = await waitForServer(() => {
        const match = serverOutput.match(/http:\/\/localhost:(\d+)/);
        if (match) base = `http://127.0.0.1:${match[1]}`;
        return base;
    });
    if (!ready) {
        child.kill();
        console.error('❌ Build server failed to start.\n' + serverOutput);
        process.exit(1);
    }

    let built = 0;
    const failures = [];

    for (const job of jobs) {
        try {
            const res = await fetch(base + job.pathname);
            const html = await res.text();
            if (!res.ok) {
                failures.push(`${job.pathname} (HTTP ${res.status})`);
                continue;
            }
            staticStore.writeStatic(ROOT, job.pathname, html, {
                revalidate: job.revalidate,
                dynamic: job.dynamic,
                status: res.status,
            });
            built++;
            console.log(`   ✅ ${job.pathname}${job.revalidate ? ` (ISR ${job.revalidate}s)` : ''}`);
        } catch (err) {
            failures.push(`${job.pathname} (${err.message})`);
        }
    }

    child.kill();
    await new Promise(r => setTimeout(r, 150));

    console.log(`\n✨ Built ${built} page(s) into .aziz/static`);
    if (failures.length) {
        console.log('⚠️  Failures:');
        failures.forEach(f => console.log('   ' + f));
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error('❌ Build failed:', err);
    process.exit(1);
});
