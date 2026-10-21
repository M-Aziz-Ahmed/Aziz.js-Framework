// ============================================================
//  Aziz.js — route manifest
//  Scans app/ once and produces both the browser manifest
//  (/_framework/routes.json) and the richer server route table.
// ============================================================

const fs = require('fs');
const path = require('path');
const pageRouter = require('./page-router');

const PAGE_EXT = ['.js', '.jsx', '.ts', '.tsx'];

function matchFile(base, name) {
    const dot = name.lastIndexOf('.');
    if (dot === -1) return false;
    return name.slice(0, dot) === base && PAGE_EXT.includes(name.slice(dot).toLowerCase());
}

function buildRouteManifest(root) {
    const manifest = [];
    const appDir = path.join(root, 'app');
    if (!fs.existsSync(appDir)) return manifest;

    const filePathFor = (routeBase, fileName) =>
        '/app' + (routeBase === '/' ? '' : routeBase) + '/' + fileName;

    function scan(dir, routeBase) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                const segment = entry.name;
                scan(fullPath, routeBase === '/' ? '/' + segment : routeBase + '/' + segment);
                continue;
            }

            const name = entry.name;
            const base = { pathname: routeBase || '/', filePath: filePathFor(routeBase, name), file: fullPath };

            if (matchFile('page', name)) manifest.push({ type: 'page', ...base });
            else if (matchFile('layout', name)) manifest.push({ type: 'layout', ...base });
            else if (matchFile('loading', name)) manifest.push({ type: 'loading', ...base });
            else if (matchFile('error', name)) manifest.push({ type: 'error', ...base });
            else if (matchFile('not-found', name) || matchFile('404', name)) {
                if (routeBase === '/') manifest.push({ type: 'not-found', ...base });
            }
        }
    }

    scan(appDir, '/');
    return manifest;
}

function loadI18nConfig(root) {
    for (const name of ['i18n.js', 'i18n.cjs', 'i18n.mjs', 'i18n.json']) {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) continue;
        try {
            if (!file.endsWith('.json')) delete require.cache[require.resolve(file)];
            let config = file.endsWith('.json') ? JSON.parse(fs.readFileSync(file, 'utf8')) : require(file);
            if (config && config.default) config = config.default;
            return pageRouter.normalizeI18n(config);
        } catch (err) {
            console.warn(`⚠️  Failed to load ${name}: ${err.message}`);
        }
    }
    return null;
}

function buildServerRoutes(root) {
    const manifest = buildRouteManifest(root);
    const pages = {};
    const layouts = manifest.filter(e => e.type === 'layout').map(e => ({ path: e.pathname, file: e.file }));
    const loadings = manifest.filter(e => e.type === 'loading').map(e => ({ path: e.pathname, file: e.file }));
    const errors = manifest.filter(e => e.type === 'error').map(e => ({ path: e.pathname, file: e.file }));
    const notFoundEntry = manifest.find(e => e.type === 'not-found') || null;

    for (const page of manifest.filter(e => e.type === 'page')) {
        const layoutChain = pageRouter.collectLayouts(layouts, page.pathname);
        const loading = pageRouter.collectNearest(loadings, page.pathname);
        const error = pageRouter.collectNearest(errors, page.pathname);
        pages[page.pathname] = {
            pattern: page.pathname,
            pageFile: page.file,
            pagePath: page.filePath,
            layoutFiles: layoutChain.map(l => l.file),
            loadingFile: loading ? loading.file : null,
            errorFile: error ? error.file : null,
            notFoundFile: notFoundEntry ? notFoundEntry.file : null,
        };
    }

    return {
        manifest,
        pages,
        notFoundFile: notFoundEntry ? notFoundEntry.file : null,
        layouts,
        loadings,
        errors,
        i18n: loadI18nConfig(root),
    };
}

module.exports = {
    PAGE_EXT,
    matchFile,
    buildRouteManifest,
    loadI18nConfig,
    buildServerRoutes,
};
