// ============================================================
//  Aziz.js font optimizer
//  - injects font-display:swap into @font-face blocks
//  - discovers local font files in styles/ and preloads them
// ============================================================

const fs = require('fs');
const path = require('path');

const FONT_RE = /\.(woff2|woff|ttf|otf)$/i;
const FONT_TYPES = {
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
};

function optimizeCSS(css) {
    return String(css).replace(/@font-face\s*\{([^}]*)\}/gi, (match, body) => {
        if (/font-display\s*:/i.test(body)) return match;
        return `@font-face{${body.trim()}font-display:swap;}`;
    });
}

function walkCSS(dir, out) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkCSS(full, out);
        else if (entry.name.endsWith('.css')) out.push(full);
    }
}

function collectFontPreloads(root) {
    const files = [];
    walkCSS(path.join(root, 'styles'), files);
    walkCSS(path.join(root, 'app'), files);

    const seen = new Set();
    const links = [];

    for (const file of files) {
        let css;
        try { css = fs.readFileSync(file, 'utf8'); } catch { continue; }
        for (const match of css.matchAll(/url\(\s*(['"]?)([^)'"]+\.(?:woff2|woff|ttf|otf))\1\s*\)/gi)) {
            let href = match[2].trim();
            if (/^(data:|https?:)/i.test(href)) continue;
            if (!href.startsWith('/')) {
                const rel = path.relative(root, path.resolve(path.dirname(file), href)).replace(/\\/g, '/');
                href = '/' + rel;
            }
            if (seen.has(href)) continue;
            seen.add(href);
            const ext = path.extname(href).toLowerCase();
            links.push({
                rel: 'preload',
                as: 'font',
                href,
                type: FONT_TYPES[ext] || 'font/woff2',
                crossorigin: '',
            });
        }
    }

    return links;
}

module.exports = {
    FONT_RE,
    FONT_TYPES,
    optimizeCSS,
    collectFontPreloads,
};
