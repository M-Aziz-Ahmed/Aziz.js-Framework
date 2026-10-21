// ============================================================
//  Aziz.js — response compression
//
//  A no-bundler framework ships dozens of small ES modules to the
//  browser. Without compression every one of them travels as plain
//  text. gzip and brotli are built into Node, so this costs no
//  dependency — but it is the difference between a 40 KB page and
//  a 9 KB one.
//
//  Rules:
//   - only compressible content types (text, JSON, JS, CSS, SVG, HTML)
//   - only above a minimum size (small bodies cost more than they save)
//   - never double-compress (already-encoded payloads pass through)
//   - HEAD requests get the headers but no body
// ============================================================

const zlib = require('zlib');

const MIN_BYTES = 1024;

const COMPRESSIBLE = [
    'text/',
    'application/javascript',
    'application/json',
    'application/ld+json',
    'application/xml',
    'image/svg+xml',
    'application/manifest+json',
];

// Types we never touch: images and archives are already compressed.
function isCompressible(contentType) {
    if (!contentType) return false;
    const type = contentType.split(';')[0].trim().toLowerCase();
    if (type.startsWith('image/') && type !== 'image/svg+xml') return false;
    if (type === 'application/zip' || type === 'application/gzip') return false;
    if (type === 'application/octet-stream') return false;
    return COMPRESSIBLE.some(t => type.startsWith(t) || type === t);
}

// Pick the best encoding the client accepts. Brotli first (smaller),
// then gzip (universally supported).
function negotiate(acceptEncoding) {
    if (!acceptEncoding) return null;
    const accepted = String(acceptEncoding).toLowerCase();
    if (accepted.includes('br')) return 'br';
    if (accepted.includes('gzip')) return 'gzip';
    return null;
}

function compressBuffer(buffer, encoding) {
    if (encoding === 'br') {
        return zlib.brotliCompressSync(buffer, {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
            },
        });
    }
    return zlib.gzipSync(buffer, { level: 6 });
}

// Returns { body, headers } or null when the response should not be
// compressed (caller sends the original bytes).
function compress(req, buffer, contentType) {
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(String(buffer));
    if (buffer.length < MIN_BYTES) return null;
    if (!isCompressible(contentType)) return null;

    const encoding = negotiate(req.headers['accept-encoding']);
    if (!encoding) return null;

    let body;
    try {
        body = compressBuffer(buffer, encoding);
    } catch {
        return null;
    }

    // Compression made it bigger (tiny or already-compressed payloads).
    if (body.length >= buffer.length) return null;

    return {
        body,
        headers: {
            'Content-Encoding': encoding,
            'Vary': 'Accept-Encoding',
        },
    };
}

module.exports = { compress, isCompressible, negotiate, MIN_BYTES };
