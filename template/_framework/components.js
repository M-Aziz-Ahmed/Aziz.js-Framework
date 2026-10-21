// ============================================================
//  Aziz.js browser components
//  <Suspense>, <Image>, <Font>, <Script>
//
//  <Suspense> is a real boundary now: it materialises its children
//  inside the boundary, catches a thrown resource promise, renders
//  the fallback, and re-renders just when the promise settles.
// ============================================================

import { h, materialize } from '/_framework/runtime.js';
import { useState, useEffect, useRef } from '/_framework/hooks.js';
import { isThenable } from '/_framework/suspense.js';

function imageSrcSet(src, widths, quality, format) {
    return widths.map(w => {
        const params = new URLSearchParams({ src, w: String(w) });
        if (quality) params.set('q', String(quality));
        params.set('f', format || 'auto');
        return '/_aziz/image?' + params.toString() + ' ' + w + 'w';
    }).join(', ');
}

export function Image({
    src,
    alt = '',
    width,
    height,
    sizes,
    quality = 75,
    format = 'auto',
    priority = false,
    fill = false,
    className,
    class: klass,
    style,
    widths: explicitWidths,
    ...rest
}) {
    const numericWidth = Number(width) || 0;
    const widths = explicitWidths ||
        (numericWidth ? [numericWidth, numericWidth * 2].filter((v, i, a) => a.indexOf(v) === i) : []);

    const props = {
        ...rest,
        src: widths.length
            ? `/_aziz/image?src=${encodeURIComponent(src)}&w=${widths[0]}&q=${quality}&f=${format}`
            : src,
        alt,
        class: className ?? klass,
        decoding: 'async',
        loading: priority ? 'eager' : 'lazy',
    };

    if (priority) props.fetchpriority = 'high';
    if (sizeParams(sizes)) props.sizes = sizes;

    if (fill) {
        props.style = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...(style || {}) };
    } else {
        if (width != null) props.width = width;
        if (height != null) props.height = height;
        if (style) props.style = style;
    }
    if (widths.length > 1) props.srcset = imageSrcSet(src, widths, quality, format);
    return h('img', props);
}

function sizeParams(sizes) {
    return typeof sizes === 'string' && sizes.length > 0;
}

export function Font({ family, href, weight = '400', style = 'normal', display = 'swap', preload = true, sizeAdjust }) {
    useEffect(() => {
        if (!href) return;
        const id = 'aziz-font-' + family + '-' + weight + '-' + style;
        if (!document.getElementById(id)) {
            const el = document.createElement('style');
            el.id = id;
            el.textContent =
                `@font-face{font-family:${JSON.stringify(family || 'AzizFont')};` +
                `src:url(${JSON.stringify(href)});` +
                `font-weight:${weight};font-style:${style};font-display:${display};` +
                (sizeAdjust ? `size-adjust:${sizeAdjust};` : '') + '}';
            document.head.appendChild(el);
        }
        if (preload && !document.querySelector(`link[rel="preload"][href="${href}"]`)) {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'font';
            link.href = href;
            link.crossOrigin = 'anonymous';
            document.head.appendChild(link);
        }
    }, [family, href, weight, style, display, preload, sizeAdjust]);
    return null;
}

export function Script({ src, children, strategy = 'afterInteractive', ...rest }) {
    const injected = useRef(false);

    useEffect(() => {
        if (!src || injected.current) return;
        injected.current = true;
        if (document.querySelector(`script[src="${src}"]`)) return;
        const el = document.createElement('script');
        el.src = src;
        if (strategy !== 'beforeInteractive') el.defer = true;
        document.body.appendChild(el);
    }, [src, strategy]);

    if (src) return null;
    return h('script', { ...rest, dangerouslySetInnerHTML: { __html: String(children ?? '') } });
}

export function Suspense({ children, fallback = null }) {
    const [, force] = useState(0);

    try {
        // Materialise inside the boundary so a thrown resource promise can
        // be caught here rather than replacing the whole page.
        return materialize(children);
    } catch (err) {
        if (!isThenable(err)) throw err;
        err.then(
            () => force(n => n + 1),
            () => force(n => n + 1)
        );
        return materialize(fallback);
    }
}

export default { Suspense, Image, Font, Script };
