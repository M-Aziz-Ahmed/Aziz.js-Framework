// ============================================================
//  Aziz.js image optimizer
//
//  /_aziz/image?src=/images/hero.jpg&w=640&q=75&f=auto
//
//  Resizing uses `sharp` when it is installed. Without sharp the
//  optimized URL still works: the original bytes are served with a
//  long-lived immutable cache, so <Image> is useful immediately and
//  gets real resizing as soon as sharp is present.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXT_RE = /\.(png|jpe?g|webp|avif|gif|svg)$/i;
const MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
};

let sharp = null;
try { sharp = require('sharp'); } catch { sharp = null; }

function hasSharp() {
    return !!sharp;
}

function resolveSource(root, src) {
    if (!src || typeof src !== 'string') return null;
    if (/^https?:\/\//i.test(src)) return { remote: src };
    if (src.startsWith('data:')) return null;

    let clean = src.split('?')[0].split('#')[0];
    try { clean = decodeURIComponent(clean); } catch { return null; }

    const rel = clean.replace(/^\/+/, '');
    const candidates = [
        path.join(root, 'public', rel),
        path.join(root, rel),
    ];

    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        const rootResolved = path.resolve(root);
        if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) continue;
        const parts = path.relative(rootResolved, resolved).split(path.sep);
        if (parts.some(p => p.startsWith('.') || p === 'server' || p === 'data' || p === 'node_modules')) continue;
        if (!EXT_RE.test(resolved)) continue;
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return { file: resolved };
    }
    return null;
}

function preferredFormat(accept, requested) {
    if (requested && requested !== 'auto') return requested;
    const a = String(accept || '');
    if (a.includes('image/avif') && sharp) return 'avif';
    if (a.includes('image/webp') && sharp) return 'webp';
    return 'auto';
}

function cacheFile(root, key) {
    return path.join(root, '.aziz', 'cache', 'images', key);
}

async function optimize(root, { file, width, quality = 75, format = 'auto', accept }) {
    const stat = fs.statSync(file);
    const ext = path.extname(file).toLowerCase();
    const chosen = preferredFormat(accept, format);

    if (ext === '.svg' || !sharp) {
        return {
            body: fs.readFileSync(file),
            contentType: MIME[ext] || 'application/octet-stream',
            cacheKey: crypto.createHash('sha1')
                .update(file + ':' + stat.mtimeMs + ':' + stat.size + ':raw')
                .digest('hex') + ext,
            optimized: false,
            ext,
        };
    }

    const targetWidth = Math.max(16, Math.min(4096, parseInt(width, 10) || 0));
    const q = Math.max(1, Math.min(100, parseInt(quality, 10) || 75));
    const fmt = chosen === 'auto' ? (ext === '.avif' ? 'avif' : ext === '.webp' ? 'webp' : 'webp')
        : chosen;
    const targetExt = fmt === 'avif' ? '.avif' : fmt === 'webp' ? '.webp' : fmt === 'png' ? '.png' : '.jpg';
    const key = crypto.createHash('sha1')
        .update(`${file}:${stat.mtimeMs}:${stat.size}:${targetWidth}:${q}:${targetExt}`)
        .digest('hex') + targetExt;

    const cached = cacheFile(root, key);
    if (fs.existsSync(cached)) {
        return { body: fs.readFileSync(cached), contentType: MIME[targetExt], cacheKey: key, optimized: true, ext: targetExt };
    }

    let pipeline = sharp(file).rotate();
    if (targetWidth) pipeline = pipeline.resize({ width: targetWidth, withoutEnlargement: true });

    if (targetExt === '.avif') pipeline = pipeline.avif({ quality: q });
    else if (targetExt === '.webp') pipeline = pipeline.webp({ quality: q });
    else if (targetExt === '.png') pipeline = pipeline.png({ compressionLevel: 9 });
    else pipeline = pipeline.jpeg({ quality: q, mozjpeg: true });

    const body = await pipeline.toBuffer();
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, body);
    return { body, contentType: MIME[targetExt], cacheKey: key, optimized: true, ext: targetExt };
}

async function handleImageRequest(req, res, url, root) {
    const src = url.searchParams.get('src');
    const width = url.searchParams.get('w');
    const quality = url.searchParams.get('q');
    const format = url.searchParams.get('f') || 'auto';

    const source = resolveSource(root, src);
    if (!source) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Image not found or not served by Aziz.js' }));
        return;
    }

    if (source.remote) {
        // Remote images are proxied and cached by the browser. We do not
        // fetch arbitrary URLs server-side (SSRF surface) without an allowlist.
        res.writeHead(302, { Location: source.remote, 'Cache-Control': 'public, max-age=3600' });
        res.end();
        return;
    }

    try {
        const result = await optimize(root, {
            file: source.file,
            width,
            quality,
            format,
            accept: req.headers.accept,
        });

        const etag = `"${result.cacheKey}"`;
        if (req.headers['if-none-match'] === etag) {
            res.writeHead(304, { ETag: etag });
            res.end();
            return;
        }

        res.writeHead(200, {
            'Content-Type': result.contentType,
            'Content-Length': result.body.length,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Vary': 'Accept',
            'ETag': etag,
            'X-Aziz-Image': result.optimized ? 'optimized' : 'passthrough',
        });
        res.end(req.method === 'HEAD' ? undefined : result.body);
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Image optimization failed', detail: err.message }));
    }
}

module.exports = {
    hasSharp,
    resolveSource,
    optimize,
    handleImageRequest,
    preferredFormat,
};
