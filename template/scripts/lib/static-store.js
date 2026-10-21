// ============================================================
//  Aziz.js — static output & ISR cache
//
//  `aziz build` writes pre-rendered documents to .aziz/static and a
//  manifest to .aziz/static-manifest.json. ISR entries are stored in
//  .aziz/cache/isr and served stale while a fresh render is produced.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function azizDir(root) {
    return path.join(root, '.aziz');
}

function staticDir(root) {
    return path.join(root, '.aziz', 'static');
}

function isrDir(root) {
    return path.join(root, '.aziz', 'cache', 'isr');
}

function manifestPath(root) {
    return path.join(root, '.aziz', 'static-manifest.json');
}

function normalize(pathname) {
    let p = String(pathname || '/').split('?')[0].split('#')[0];
    if (!p.startsWith('/')) p = '/' + p;
    if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '');
    return p || '/';
}

function fileForStatic(root, pathname) {
    const p = normalize(pathname);
    if (p === '/') return path.join(staticDir(root), 'index.html');
    const safe = p.slice(1).split('/').map(seg => encodeURIComponent(seg).replace(/%/g, '_')).join('/');
    return path.join(staticDir(root), safe, 'index.html');
}

// The manifest holds one entry per prerendered page. Parsing it on
// every request is O(pages) per request, so it is cached and
// re-read only when the file changes on disk.
const manifestCache = new Map(); // root → { mtimeMs, manifest }

function loadManifest(root) {
    const file = manifestPath(root);
    let mtimeMs = 0;
    try {
        mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
        return { pages: {} };
    }

    const hit = manifestCache.get(root);
    if (hit && hit.mtimeMs === mtimeMs) return hit.manifest;

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return { pages: {} };
    }
    manifestCache.set(root, { mtimeMs, manifest });
    return manifest;
}

function saveManifest(root, manifest) {
    fs.mkdirSync(path.dirname(manifestPath(root)), { recursive: true });
    const file = manifestPath(root);
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch { /* ignore */ }
    manifestCache.set(root, { mtimeMs, manifest });
}

function writeStatic(root, pathname, html, meta = {}) {
    const p = normalize(pathname);
    const file = fileForStatic(root, p);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);

    const manifest = loadManifest(root);
    manifest.pages[p] = {
        file: path.relative(root, file).replace(/\\/g, '/'),
        generatedAt: Date.now(),
        revalidate: meta.revalidate ?? null,
        dynamic: meta.dynamic || 'force-static',
        status: meta.status || 200,
    };
    saveManifest(root, manifest);
    return manifest.pages[p];
}

function readStatic(root, pathname) {
    const p = normalize(pathname);
    const manifest = loadManifest(root);
    const entry = manifest.pages && manifest.pages[p];
    if (!entry) return null;

    const file = path.join(root, entry.file);
    try {
        return { html: fs.readFileSync(file, 'utf8'), meta: entry };
    } catch {
        return null;
    }
}

function isrFile(root, pathname) {
    const hash = crypto.createHash('sha1').update(normalize(pathname)).digest('hex');
    return path.join(isrDir(root), hash + '.json');
}

function readISR(root, pathname) {
    try {
        return JSON.parse(fs.readFileSync(isrFile(root, pathname), 'utf8'));
    } catch {
        return null;
    }
}

function writeISR(root, pathname, entry) {
    const file = isrFile(root, pathname);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...entry, at: Date.now() }));
    return entry;
}

// Removes the rendered output (prerendered pages + ISR cache) but
// keeps the rest of .aziz/ — notably .aziz/compiled, the precompiled
// modules written by the build step.
function clear(root) {
    fs.rmSync(staticDir(root), { recursive: true, force: true });
    fs.rmSync(isrDir(root), { recursive: true, force: true });
}

module.exports = {
    azizDir,
    staticDir,
    isrDir,
    manifestPath,
    fileForStatic,
    normalize,
    loadManifest,
    saveManifest,
    writeStatic,
    readStatic,
    readISR,
    writeISR,
    clear,
};
