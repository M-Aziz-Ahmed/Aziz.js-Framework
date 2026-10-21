// ============================================================
//  Aziz.js — static output & ISR cache
//
//  `npm run build` writes pre-rendered documents to the cache root
//  and a manifest next to them. ISR entries live in <cache>/cache/isr
//  and are served stale while a fresh render is produced.
//
//  The cache root is `<project>/.aziz` by default. Set AZIZ_CACHE_DIR
//  to move the *ISR cache* somewhere else — a mounted volume, for
//  example — so several server instances share one cache:
//
//      AZIZ_CACHE_DIR=/data/aziz
//
//  Only the ISR cache moves. The prerendered pages and their manifest
//  are build output: they ship with the image and are identical on
//  every instance, so they stay next to the source.
//
//  Writes are atomic (temp file + rename), so an instance never reads
//  a half-written entry, and ISR regeneration takes a lock file, so a
//  fleet of instances does not all regenerate the same stale page.
//
//  For a cache that is not a filesystem, set AZIZ_CACHE_ADAPTER to a
//  module exporting { create(ctx) → { readStatic, writeStatic,
//  readISR, writeISR } }. The adapter's methods may be async — this is
//  the seam where a Redis/Memcached handler goes.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Compiled modules are a deploy artifact, not a cache: they ship with
// the build and always live next to the source.
function compiledDir(root) {
    return path.join(root, '.aziz', 'compiled');
}

// Prerendered pages — build output, identical on every instance.
function staticDir(root) {
    return path.join(root, '.aziz', 'static');
}

function manifestPath(root) {
    return path.join(root, '.aziz', 'static-manifest.json');
}

// ISR cache — runtime state. This is the part that is shared between
// instances, so it is the only thing AZIZ_CACHE_DIR moves.
function isrCacheRoot(root) {
    const dir = process.env.AZIZ_CACHE_DIR;
    return dir ? path.resolve(dir) : path.join(root, '.aziz', 'cache');
}

function isrDir(root) {
    return path.join(isrCacheRoot(root), 'isr');
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

// ─── Atomic writes ───────────────────────────────────────────
//
// write → rename. A reader either sees the old file or the new one,
// never a truncated one. Renaming over an existing file is atomic on
// POSIX and on Windows (Node uses MoveFileEx with REPLACE_EXISTING).

function writeFileAtomic(file, data) {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
    try {
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, file);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch { /* best effort */ }
        throw err;
    }
}

// ─── ISR lock ────────────────────────────────────────────────
//
// One instance regenerates a stale page; the others keep serving the
// stale copy. Without this, every instance in a fleet re-renders the
// same page at the same moment.

function lockFile(root, pathname) {
    const hash = crypto.createHash('sha1').update(normalize(pathname)).digest('hex');
    return path.join(isrDir(root), hash + '.lock');
}

// Returns a release function, or null when someone else holds the
// lock. Stale locks (older than ttlMs) are broken.
function acquireLock(root, pathname, options = {}) {
    const ttlMs = options.ttlMs || 60_000;
    const file = lockFile(root, pathname);

    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
    } catch { /* the write below will report the real problem */ }

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = fs.openSync(file, 'wx');
            try { fs.writeSync(fd, String(process.pid)); } catch { /* ignore */ }
            fs.closeSync(fd);
            return () => {
                try { fs.unlinkSync(file); } catch { /* already gone */ }
            };
        } catch (err) {
            if (err.code !== 'EEXIST') return null;
            // Break a lock left behind by a crashed process.
            try {
                const stat = fs.statSync(file);
                if (Date.now() - stat.mtimeMs > ttlMs) {
                    fs.unlinkSync(file);
                    continue;
                }
            } catch { /* the lock vanished — retry once */ }
            return null;
        }
    }
    return null;
}

// ─── Manifest ────────────────────────────────────────────────
//
// The manifest holds one entry per prerendered page. Parsing it on
// every request is O(pages) per request, so it is cached and re-read
// only when the file changes on disk.

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
    const file = manifestPath(root);
    writeFileAtomic(file, JSON.stringify(manifest, null, 2) + '\n');
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch { /* ignore */ }
    manifestCache.set(root, { mtimeMs, manifest });
}

// ─── Prerendered pages ───────────────────────────────────────
//
// The HTML of a prerendered page is kept in memory. It only changes
// when the build rewrites it, so the cache is invalidated by the
// manifest's generation timestamp rather than by a timer.

const staticMemory = new Map(); // root|pathname → { html, meta }
const STATIC_MEMORY_MAX = 500;

function memoryKey(root, pathname) {
    return root + '|' + normalize(pathname);
}

function rememberStatic(root, pathname, html, meta) {
    if (staticMemory.size >= STATIC_MEMORY_MAX) {
        const oldest = staticMemory.keys().next().value;
        staticMemory.delete(oldest);
    }
    staticMemory.set(memoryKey(root, pathname), { html, meta });
}

function forgetStatic(root, pathname) {
    staticMemory.delete(memoryKey(root, pathname));
}

// ─── Default file adapter ────────────────────────────────────

function resolveStaticFile(root, entry) {
    // Older builds stored the path relative to the project root; the
    // cache root may have moved since.
    const candidates = [
        path.join(root, entry.file),
        path.join(root, '.aziz', entry.file),
    ];
    for (const candidate of candidates) {
        try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* try the next */ }
    }
    return null;
}

const fileAdapter = {
    async readStatic(root, pathname) {
        const p = normalize(pathname);
        const manifest = loadManifest(root);
        const entry = manifest.pages && manifest.pages[p];
        if (!entry) return null;

        const cached = staticMemory.get(memoryKey(root, p));
        if (cached && cached.meta && cached.meta.generatedAt === entry.generatedAt) {
            return { html: cached.html, meta: entry };
        }

        const file = resolveStaticFile(root, entry);
        if (!file) return null;
        try {
            const html = fs.readFileSync(file, 'utf8');
            rememberStatic(root, p, html, entry);
            return { html, meta: entry };
        } catch {
            return null;
        }
    },

    async writeStatic(root, pathname, html, meta = {}) {
        const p = normalize(pathname);
        const file = fileForStatic(root, p);
        writeFileAtomic(file, html);

        const manifest = loadManifest(root);
        manifest.pages[p] = {
            file: path.relative(root, file).replace(/\\/g, '/'),
            generatedAt: Date.now(),
            revalidate: meta.revalidate ?? null,
            dynamic: meta.dynamic || 'force-static',
            status: meta.status || 200,
        };
        saveManifest(root, manifest);
        forgetStatic(root, p);
        return manifest.pages[p];
    },

    async readISR(root, pathname) {
        try {
            const file = path.join(isrDir(root), crypto.createHash('sha1')
                .update(normalize(pathname)).digest('hex') + '.json');
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            return null;
        }
    },

    async writeISR(root, pathname, entry) {
        const file = path.join(isrDir(root), crypto.createHash('sha1')
            .update(normalize(pathname)).digest('hex') + '.json');
        writeFileAtomic(file, JSON.stringify({ ...entry, at: Date.now() }));
        return entry;
    },
};

// ─── Adapter plumbing ────────────────────────────────────────
//
// AZIZ_CACHE_ADAPTER=/abs/path/to/adapter.js
//   module.exports = { create(ctx) { return { readStatic, writeStatic, readISR, writeISR } } }

let adapter = fileAdapter;

function loadAdapter() {
    const spec = process.env.AZIZ_CACHE_ADAPTER;
    if (!spec) return fileAdapter;
    try {
        const resolved = spec.startsWith('.') ? path.resolve(process.cwd(), spec) : spec;
        const mod = require(resolved);
        const factory = mod && (mod.create || mod.default);
        if (typeof factory !== 'function') {
            console.warn(`⚠️  Cache adapter "${spec}" has no create() export — using the file cache.`);
            return fileAdapter;
        }
        const custom = factory({
            root: process.cwd(),
            isrCacheRoot: isrCacheRoot(process.cwd()),
            staticDir: staticDir(process.cwd()),
        });
        for (const key of ['readStatic', 'writeStatic', 'readISR', 'writeISR']) {
            if (typeof custom[key] !== 'function') {
                console.warn(`⚠️  Cache adapter "${spec}" is missing ${key}() — using the file cache.`);
                return fileAdapter;
            }
        }
        console.log(`🗄️  Cache adapter: ${spec}`);
        return custom;
    } catch (err) {
        console.warn(`⚠️  Failed to load cache adapter "${spec}": ${err.message} — using the file cache.`);
        return fileAdapter;
    }
}

function getAdapter() {
    if (adapter === fileAdapter && process.env.AZIZ_CACHE_ADAPTER) adapter = loadAdapter();
    return adapter;
}

// Lets a host application inject an adapter at runtime.
function setAdapter(custom) {
    adapter = custom;
}

// ─── Public API ──────────────────────────────────────────────

async function readStatic(root, pathname) {
    return getAdapter().readStatic(root, pathname);
}

async function writeStatic(root, pathname, html, meta = {}) {
    return getAdapter().writeStatic(root, pathname, html, meta);
}

async function readISR(root, pathname) {
    return getAdapter().readISR(root, pathname);
}

async function writeISR(root, pathname, entry) {
    return getAdapter().writeISR(root, pathname, entry);
}

// Removes the rendered output (prerendered pages + ISR cache) but
// keeps the compiled modules, which are a deploy artifact.
function clear(root) {
    fs.rmSync(staticDir(root), { recursive: true, force: true });
    fs.rmSync(isrDir(root), { recursive: true, force: true });
}

module.exports = {
    azizDir: (root) => path.join(root, '.aziz'),
    compiledDir,
    staticDir,
    isrDir,
    isrCacheRoot,
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
    acquireLock,
    setAdapter,
    writeFileAtomic,
};
