// ============================================================
//  Aziz.js server renderer
//
//  Walks the same lazy descriptor tree the browser runtime uses
//  and emits HTML. Suspensions are real: a thrown thenable is
//  awaited and the tree is rendered again. <Suspense> boundaries
//  emit their fallback first and are patched in-place when the
//  promise settles, which is what makes route-level streaming and
//  component-level partial swaps possible without React.
// ============================================================

const path = require('path');

const runtime = require('./server-runtime');

const {
    h, Fragment, VNODE, PROVIDER, SUSPENSE,
    isVNode, isThenable,
    createRenderContext, runWithRenderContext,
    prepareHooks, finishHooks,
    mergeMetadata, metaTitle,
    getHead,
} = runtime;

const VOID_TAGS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
]);

const RAW_TAGS = new Set(['script', 'style']);

const ATTRIBUTE_ALIASES = {
    className: 'class',
    htmlFor: 'for',
    httpEquiv: 'http-equiv',
    acceptCharset: 'accept-charset',
    charSet: 'charset',
    srcSet: 'srcset',
    imageSrcSet: 'imagesrcset',
    imageSizes: 'imagesizes',
    fetchPriority: 'fetchpriority',
    autoComplete: 'autocomplete',
    autoFocus: 'autofocus',
    autoPlay: 'autoplay',
    cellPadding: 'cellpadding',
    cellSpacing: 'cellspacing',
    colSpan: 'colspan',
    contentEditable: 'contenteditable',
    crossOrigin: 'crossorigin',
    dateTime: 'datetime',
    encType: 'enctype',
    formAction: 'formaction',
    formEncType: 'formenctype',
    formMethod: 'formmethod',
    formNoValidate: 'formnovalidate',
    formTarget: 'formtarget',
    frameBorder: 'frameborder',
    maxLength: 'maxlength',
    minLength: 'minlength',
    noModule: 'nomodule',
    noValidate: 'novalidate',
    readOnly: 'readonly',
    referrerPolicy: 'referrerpolicy',
    rowSpan: 'rowspan',
    spellCheck: 'spellcheck',
    tabIndex: 'tabindex',
    useMap: 'usemap',
};

const BOOLEAN_ATTRIBUTES = new Set([
    'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls',
    'default', 'defer', 'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap',
    'itemscope', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate', 'open',
    'playsinline', 'readonly', 'required', 'reversed', 'selected',
]);

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return escapeHtml(value);
}

function styleToCSS(style) {
    if (!style) return '';
    if (typeof style === 'string') return style;
    return Object.entries(style)
        .filter(([, v]) => v !== null && v !== undefined && v !== false)
        .map(([k, v]) => {
            const prop = k.startsWith('--') ? k : k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
            return `${prop}:${v}`;
        })
        .join(';');
}

function attrName(key) {
    if (ATTRIBUTE_ALIASES[key]) return ATTRIBUTE_ALIASES[key];
    if (key.startsWith('data-') || key.startsWith('aria-')) return key;
    return key;
}

function renderAttributes(props) {
    if (!props) return '';
    const out = [];
    for (const [key, value] of Object.entries(props)) {
        if (key === 'children' || key === 'key' || key === 'ref') continue;
        if (key === 'dangerouslySetInnerHTML' || key === 'style') continue;
        if (key.startsWith('on') && typeof value === 'function') continue;

        const name = attrName(key);
        if (value === false || value === null || value === undefined) continue;
        if (value === true) {
            out.push(BOOLEAN_ATTRIBUTES.has(name) ? name : `${name}=""`);
            continue;
        }
        out.push(`${name}="${escapeAttr(value)}"`);
    }
    if (props.style) {
        const css = styleToCSS(props.style);
        if (css) out.push(`style="${escapeAttr(css)}"`);
    }
    return out.length ? ' ' + out.join(' ') : '';
}

function settle(thenable) {
    return Promise.resolve(thenable);
}

// ─── Metadata → <head> ───────────────────────────────────────

function metaTags(metadata, ctx, options = {}) {
    if (!metadata || typeof metadata !== 'object') metadata = {};
    const tags = [];
    const push = (tag, attrs) => {
        const body = Object.entries(attrs)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
            .join(' ');
        tags.push(`<${tag}${body ? ' ' + body : ''}>`);
    };

    let title = metaTitle(metadata.title);
    if (metadata.title && typeof metadata.title === 'object' && metadata.title.template &&
        !metadata.title.absolute && title) {
        title = metadata.title.template.replace('%s', title);
    }
    if (title) tags.push(`<title>${escapeHtml(title)}</title>`);

    const name = (key, value) => { if (value !== undefined && value !== null && value !== '') push('meta', { name: key, content: value }); };
    const property = (key, value) => { if (value !== undefined && value !== null && value !== '') push('meta', { property: key, content: value }); };

    name('description', metadata.description);
    name('keywords', Array.isArray(metadata.keywords) ? metadata.keywords.join(', ') : metadata.keywords);
    name('author', metadata.author);
    name('robots', typeof metadata.robots === 'string' ? metadata.robots : undefined);
    name('theme-color', metadata.themeColor);
    name('viewport', metadata.viewport);

    const og = metadata.openGraph || {};
    property('og:title', og.title || title);
    property('og:description', og.description || metadata.description);
    property('og:url', og.url || metadata.canonical);
    property('og:site_name', og.siteName);
    property('og:type', og.type || 'website');
    const ogImage = Array.isArray(og.images) ? og.images[0] : (og.images || og.image);
    if (ogImage) property('og:image', typeof ogImage === 'string' ? ogImage : ogImage.url);
    const ogImageAlt = Array.isArray(og.images) ? og.images[0] && og.images[0].alt : (og.images && og.images.alt);
    if (ogImageAlt) property('og:image:alt', ogImageAlt);

    const tw = metadata.twitter || {};
    name('twitter:card', tw.card);
    name('twitter:title', tw.title || title);
    name('twitter:description', tw.description || metadata.description);
    name('twitter:image', tw.image || (typeof ogImage === 'string' ? ogImage : ogImage && ogImage.url));
    name('twitter:creator', tw.creator);

    if (metadata.canonical) push('link', { rel: 'canonical', href: metadata.canonical });
    if (metadata.manifest) push('link', { rel: 'manifest', href: metadata.manifest });

    const icons = metadata.icons;
    if (icons) {
        const list = Array.isArray(icons) ? icons : [icons];
        for (const icon of list) {
            if (typeof icon === 'string') push('link', { rel: 'icon', href: icon });
            else if (icon && icon.url) push('link', { rel: icon.rel || 'icon', href: icon.url, type: icon.type, sizes: icon.sizes });
        }
    }

    const alternates = metadata.alternates || {};
    const languages = alternates.languages || {};
    for (const [lang, href] of Object.entries(languages)) {
        push('link', { rel: 'alternate', hreflang: lang, href });
    }

    if (metadata.jsonLd) {
        const json = JSON.stringify(metadata.jsonLd).replace(/</g, '\\u003c');
        tags.push(`<script type="application/ld+json">${json}</script>`);
    }

    const head = ctx ? getHead(ctx) : { links: [], styles: [] };
    for (const link of head.links || []) {
        push('link', link);
    }
    if (head.styles && head.styles.length) {
        tags.push(`<style data-aziz-fonts>${head.styles.join('')}</style>`);
    }

    if (options.lang) tags.push(`<meta property="og:locale" content="${escapeAttr(options.lang)}">`);

    return tags.join('\n    ');
}

function cleanIndexHead(html) {
    return html
        .replace(/<title[^>]*>[\s\S]*?<\/title>/i, '')
        .replace(/<meta\s+name=["']description["'][^>]*>/i, '');
}

function injectDocument(indexHtml, { rootHtml, headHtml, lang, ssrData, hasSsr, extraHtml }) {
    let html = indexHtml;

    if (lang) {
        if (/<html[^>]*\blang=/i.test(html)) {
            html = html.replace(/<html([^>]*)\blang=["'][^"']*["']/i, `<html$1lang="${escapeAttr(lang)}"`);
        } else {
            html = html.replace(/<html/i, `<html lang="${escapeAttr(lang)}"`);
        }
    }

    html = cleanIndexHead(html);
    if (headHtml) html = html.replace('</head>', `    ${headHtml}\n</head>`);

    const rootRe = /<div\s+id=["']root["']\s*><\/div>/i;
    const marker = `data-aziz-ssr="1"`;
    if (rootRe.test(html)) {
        html = html.replace(rootRe, `<div id="root" ${marker}>${rootHtml || ''}</div>`);
    } else if (/<div\s+id=["']root["'][^>]*>/i.test(html)) {
        html = html.replace(/<div\s+id=["']root["'][^>]*>([\s\S]*?)<\/div>/i,
            `<div id="root" ${marker}>${rootHtml || '$1'}</div>`);
    } else {
        html = html.replace('</body>', `<div id="root" ${marker}>${rootHtml || ''}</div>\n</body>`);
    }

    if (hasSsr) {
        const json = JSON.stringify(ssrData || {}).replace(/</g, '\\u003c');
        const script = `<script>window.__AZIZ_SSR__=${json};</script>`;
        if (/<script[^>]+src=["'][^"']*boot\.js["']/i.test(html)) {
            html = html.replace(/(<script[^>]+src=["'][^"']*boot\.js["'][^>]*><\/script>)/i, `${script}\n    $1`);
        } else {
            html = html.replace('</body>', `${script}\n</body>`);
        }
    }

    if (extraHtml) {
        html = html.replace('</body>', `${extraHtml}\n</body>`);
    }

    return html;
}

// ─── Renderer ────────────────────────────────────────────────

class ServerRenderer {
    constructor(context, options = {}) {
        this.ctx = context;
        this.options = options;
        this.fibers = new Map();
        this.pathStack = [];
        this.counters = [];
        this.baseId = '';
        this.boundaries = [];
        this.boundarySeq = 0;
        this.rendering = false;
    }

    reset() {
        this.fibers.clear();
        this.pathStack.length = 0;
        this.counters.length = 0;
        this.baseId = '';
        this.boundaries = [];
        this.boundarySeq = 0;
    }

    nextKey(props) {
        if (props && props.key !== undefined && props.key !== null) return 'k:' + props.key;
        if (this.counters.length === 0) {
            this.rootCounter = (this.rootCounter || 0) + 1;
            return 'i:' + this.rootCounter;
        }
        const top = this.counters.length - 1;
        this.counters[top]++;
        return 'i:' + this.counters[top];
    }

    componentName(fn) {
        return fn.displayName || fn.name || 'Anonymous';
    }

    getFiber(id) {
        let fiber = this.fibers.get(id);
        if (!fiber) {
            fiber = { id, hooks: [], mounted: true };
            this.fibers.set(id, fiber);
        }
        return fiber;
    }

    async render(tree) {
        const attempts = this.options.maxSuspenseRetries || 30;
        let lastSuspension = null;

        for (let i = 0; i < attempts; i++) {
            this.reset();
            try {
                const html = await this.renderNode(tree, { insideSuspense: false });
                return { html, boundaries: this.boundaries };
            } catch (err) {
                if (isThenable(err)) {
                    lastSuspension = err;
                    if (this.options.stopOnSuspense) {
                        return { suspended: err, html: null, boundaries: [] };
                    }
                    try {
                        await settle(err);
                    } catch (settleErr) {
                        // The data rejected. Surface it through error.js.
                        return {
                            error: settleErr,
                            html: null,
                            boundaries: [],
                        };
                    }
                    continue;
                }
                return { error: err, html: null, boundaries: [] };
            }
        }

        return {
            error: lastSuspension || new Error('Suspense retry limit exceeded'),
            html: null,
            boundaries: [],
        };
    }

    async renderNode(node, flags = {}) {
        if (node === null || node === undefined || node === false || node === true) return '';

        if (Array.isArray(node)) {
            let out = '';
            for (const child of node) out += await this.renderNode(child, flags);
            return out;
        }

        if (!isVNode(node)) return escapeHtml(node);

        const { type, props, children } = node;

        if (type === Fragment) return this.renderChildren(children, flags);

        if (type === PROVIDER) {
            this.ctx.ctxStack.push({ ctx: node.ctx, value: props ? props.value : undefined });
            try {
                return await this.renderChildren(children, flags);
            } finally {
                this.ctx.ctxStack.pop();
            }
        }

        if (type === SUSPENSE) return this.renderSuspense(node, flags);

        if (typeof type === 'function') return this.renderComponent(type, props, children, flags);

        return this.renderElement(type, props, children, flags);
    }

    async renderChildren(children, flags) {
        let out = '';
        for (const child of children || []) out += await this.renderNode(child, flags);
        return out;
    }

    async renderComponent(type, props, children, flags) {
        const segment = this.componentName(type) + '@' + this.nextKey(props);
        this.pathStack.push(segment);
        this.counters.push(0);

        const id = (this.baseId ? this.baseId + '>' : '') + this.pathStack.join('>');
        const fiber = this.getFiber(id);

        let output;
        const cached = this.ctx.asyncOutputs.get(id);

        if (cached) {
            if (cached.status === 'error') throw cached.error;
            if (cached.status === 'pending') throw cached.promise;
            output = cached.value;
        } else {
            prepareHooks(fiber);
            try {
                output = type({ ...(props || {}), children });
            } catch (err) {
                finishHooks();
                this.counters.pop();
                this.pathStack.pop();
                throw err;
            }
            finishHooks();

            if (isThenable(output)) {
                const entry = { status: 'pending' };
                entry.promise = output.then(
                    value => { entry.status = 'success'; entry.value = value; return value; },
                    err => { entry.status = 'error'; entry.error = err; throw err; }
                );
                entry.promise.catch(() => {});
                this.ctx.asyncOutputs.set(id, entry);

                if (this.ctx.streaming) {
                    this.counters.pop();
                    this.pathStack.pop();
                    throw entry.promise;
                }
                output = await entry.promise;
            }
        }

        let html;
        try {
            html = await this.renderNode(output, flags);
        } finally {
            this.counters.pop();
            this.pathStack.pop();
        }

        if (type.__azizServer) {
            const file = type.__azizServerFile || '';
            const propsJson = safeJSON(props || {});
            return `<div data-aziz-server="1" data-aziz-component="${escapeAttr(file)}" ` +
                `data-aziz-props="${escapeAttr(propsJson)}" style="display:contents">${html}</div>`;
        }

        return html;
    }

    async renderSuspense(vnode, flags) {
        const id = ++this.boundarySeq;
        const pathStack = [...this.pathStack];
        const counters = [...this.counters];
        const baseId = this.baseId;
        try {
            const html = await this.renderNode(vnode.children, { ...flags, insideSuspense: true });
            return html;
        } catch (err) {
            if (!isThenable(err)) throw err;
            const fallback = await this.renderNode(
                vnode.props && vnode.props.fallback !== undefined ? vnode.props.fallback : null,
                { ...flags, insideSuspense: true }
            );
            this.boundaries.push({
                id,
                error: err,
                children: vnode.children,
                flags: { ...flags, insideSuspense: true },
                pathStack,
                counters,
                baseId,
            });
            return `<div data-aziz-boundary="${id}">${fallback}</div>`;
        }
    }

    async renderPendingBoundaries() {
        const chunks = [];
        while (this.boundaries.length) {
            const boundary = this.boundaries.shift();
            try {
                await settle(boundary.error);
            } catch (err) {
                const fallback = this.options.errorComponent
                    ? await this.renderNode(h(this.options.errorComponent, { error: err }), boundary.flags)
                    : `<p data-aziz-boundary-error>${escapeHtml(err && err.message || 'Error')}</p>`;
                chunks.push(replacementScript(boundary.id, fallback));
                continue;
            }

            const savedPath = this.pathStack;
            const savedCounters = this.counters;
            const savedBase = this.baseId;
            this.pathStack = [...boundary.pathStack];
            this.counters = [...boundary.counters];
            this.baseId = boundary.baseId;

            try {
                const html = await this.renderNode(boundary.children, boundary.flags);
                chunks.push(replacementScript(boundary.id, html));
            } catch (err) {
                if (isThenable(err)) {
                    // The component re-created its promise (or a nested
                    // component did). Wait for it and try once more.
                    try {
                        await settle(err);
                        const html = await this.renderNode(boundary.children, boundary.flags);
                        chunks.push(replacementScript(boundary.id, html));
                    } catch (err2) {
                        const fallback = `<p data-aziz-boundary-error>${escapeHtml(err2 && err2.message || 'Error')}</p>`;
                        chunks.push(replacementScript(boundary.id, fallback));
                    }
                } else {
                    const fallback = `<p data-aziz-boundary-error>${escapeHtml(err && err.message || 'Error')}</p>`;
                    chunks.push(replacementScript(boundary.id, fallback));
                }
            } finally {
                this.pathStack = savedPath;
                this.counters = savedCounters;
                this.baseId = savedBase;
            }
        }
        return chunks;
    }

    async renderElement(tag, props, children, flags) {
        if (typeof tag !== 'string') {
            throw new Error('Invalid element type: ' + String(tag));
        }

        const attrs = renderAttributes(props);
        if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;

        let inner;
        if (props && props.dangerouslySetInnerHTML && props.dangerouslySetInnerHTML.__html != null) {
            inner = String(props.dangerouslySetInnerHTML.__html);
        } else if (RAW_TAGS.has(tag)) {
            inner = children.map(c => (c == null ? '' : String(c))).join('');
        } else {
            inner = await this.renderChildren(children, flags);
        }
        return `<${tag}${attrs}>${inner}</${tag}>`;
    }
}

function safeJSON(value) {
    try { return JSON.stringify(value); } catch { return '{}'; }
}

function replacementScript(id, html) {
    const payload = JSON.stringify(String(html)).replace(/</g, '\\u003c');
    return `<script>(function(){var el=document.querySelector('[data-aziz-boundary="${id}"]');` +
        `if(el){el.outerHTML=${payload};}` +
        `if(window.__azizStreamQueue){window.__azizStreamQueue.push(${payload});}` +
        `})();</script>`;
}

// ─── Public rendering API ────────────────────────────────────

function defaultLoading() {
    return h('div', {
        style: { padding: '60px 24px', textAlign: 'center', color: '#666' },
    }, 'Loading…');
}

function defaultError({ error }) {
    return h('div', { style: { padding: '60px 24px', textAlign: 'center', color: '#666' } },
        h('h1', { style: { fontSize: '32px', color: '#c0392b', margin: '0 0 8px' } }, 'Something went wrong'),
        h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '13px' } },
            (error && error.message) || 'Unknown error')
    );
}

function defaultNotFound() {
    return h('div', { style: { padding: '60px 24px', textAlign: 'center' } },
        h('h1', { style: { fontSize: '72px', color: '#61dafb', margin: '0 0 8px' } }, '404'),
        h('p', { style: { color: '#666' } }, 'This page could not be found.')
    );
}

async function collectMetadata(modules, ctx) {
    let merged = {};
    for (const mod of modules) {
        if (!mod) continue;
        let data = mod.metadata;
        if (typeof mod.generateMetadata === 'function') {
            try {
                data = await mod.generateMetadata({ params: ctx.params, searchParams: ctx.searchParams });
            } catch (err) {
                if (isThenable(err)) {
                    await settle(err);
                    data = await mod.generateMetadata({ params: ctx.params, searchParams: ctx.searchParams });
                } else {
                    throw err;
                }
            }
        }
        merged = mergeMetadata({ metadata: merged }, { metadata: data || {} });
    }
    return merged;
}

function wrapPage(pageComponent, layoutComponents, pageProps = {}, layoutProps = {}) {
    let tree = h(pageComponent, pageProps);
    for (let i = layoutComponents.length - 1; i >= 0; i--) {
        tree = h(layoutComponents[i], { ...layoutProps, children: tree });
    }
    return tree;
}

function serializeData(ctx) {
    const data = {};
    for (const [key, entry] of ctx.fetchCache.entries()) {
        if (entry && entry.error) continue;
        data[key] = { data: entry.data, status: entry.status };
    }
    return {
        pathname: ctx.pathname,
        params: ctx.params,
        locale: ctx.locale,
        data,
    };
}

// Render a page. Returns one of:
//   { html }                       — complete render
//   { shell, done: Promise<...> }  — top-level suspension (streaming)
//   { error }                      — render failed
async function renderPage({
    loader,
    pageFile,
    layoutFiles = [],
    loadingFile = null,
    errorFile = null,
    notFoundFile = null,
    pathname,
    params = {},
    searchParams,
    locale = null,
    i18n = null,
    origin = 'http://localhost',
    requestHeaders = {},
    streaming = false,
    data = {},
    fetchImpl = null,
    indexHtml = '',
    headLinks = [],
    headStyles = [],
}) {
    const ctx = createRenderContext({
        pathname,
        params,
        searchParams: searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || ''),
        locale,
        locales: i18n && i18n.locales,
        defaultLocale: i18n && i18n.defaultLocale,
        localePrefix: (i18n && i18n.localePrefix) || 'always',
        origin,
        requestHeaders,
        streaming,
        fetchImpl,
        headLinks,
        headStyles,
    });
    ctx.i18n = !!i18n;

    // Seed fetch cache from ISR/SSG payload.
    for (const [key, entry] of Object.entries(data || {})) {
        ctx.fetchCache.set(key, entry);
    }

    return runWithRenderContext(ctx, async () => {
        const pageMod = pageFile ? loader.load(pageFile) : null;
        const layoutMods = layoutFiles.map(f => loader.load(f));
        const loadingMod = loadingFile ? loader.load(loadingFile) : null;
        const errorMod = errorFile ? loader.load(errorFile) : null;
        const notFoundMod = notFoundFile ? loader.load(notFoundFile) : null;

        const pageComponent = (pageMod && pageMod.default) || defaultNotFound;
        const layoutComponents = layoutMods.map(m => m.default).filter(Boolean);

        let metadata;
        try {
            metadata = await collectMetadata([...layoutMods, pageMod], ctx);
        } catch (metaErr) {
            metadata = {};
        }

        const pageProps = {
            params: params || {},
            searchParams,
            locale,
        };
        const tree = wrapPage(pageComponent, layoutComponents, pageProps, { params: params || {}, locale });
        const renderer = new ServerRenderer(ctx, {
            errorComponent: (errorMod && errorMod.default) || defaultError,
            stopOnSuspense: streaming,
        });

        const first = await renderer.render(tree);

        if (first.suspended) {
            const LoadingComponent = (loadingMod && loadingMod.default) || defaultLoading;
            const shellTree = wrapPage(LoadingComponent, layoutComponents);
            const shellRenderer = new ServerRenderer(ctx, {
                errorComponent: (errorMod && errorMod.default) || defaultError,
            });
            const shellResult = await shellRenderer.render(shellTree);

            const done = (async () => {
                ctx.streaming = false;
                const retryRenderer = new ServerRenderer(ctx, {
                    errorComponent: (errorMod && errorMod.default) || defaultError,
                });
                const final = await retryRenderer.render(tree);
                if (final.error) {
                    const ErrorComponent = (errorMod && errorMod.default) || defaultError;
                    const er = new ServerRenderer(ctx, { errorComponent: ErrorComponent });
                    const errTree = wrapPage(() => h(ErrorComponent, { error: final.error }), layoutComponents);
                    const rendered = await er.render(errTree);
                    return { html: rendered.html || '', chunks: [], status: 500, serialized: serializeData(ctx) };
                }
                const chunks = await retryRenderer.renderPendingBoundaries();
                return { html: final.html || '', chunks, status: 200, serialized: serializeData(ctx) };
            })();

            return {
                shell: shellResult.html || '',
                done,
                mode: 'shell',
                metadata,
                ctx,
                serialized: serializeData(ctx),
                status: 200,
            };
        }

        if (first.error && first.error.__azizRedirect) {
            return {
                redirect: first.error.__azizRedirect,
                status: first.error.__azizRedirectStatus || 307,
                metadata,
                ctx,
            };
        }

        if (first.error && first.error.__azizNotFound) {
            const NotFoundComponent = (notFoundMod && notFoundMod.default) || defaultNotFound;
            const nfMetadata = await collectMetadata([...layoutMods, notFoundMod], ctx);
            const nfTree = wrapPage(NotFoundComponent, layoutComponents);
            const nfRenderer = new ServerRenderer(ctx, {});
            const nf = await nfRenderer.render(nfTree);
            return {
                html: nf.html || '',
                metadata: Object.keys(nfMetadata).length ? nfMetadata : metadata,
                ctx,
                serialized: serializeData(ctx),
                status: 404,
            };
        }

        if (first.error) {
            const ErrorComponent = (errorMod && errorMod.default) || defaultError;
            const errorTree = wrapPage(() => h(ErrorComponent, { error: first.error, reset: () => {} }), layoutComponents);
            const errorRenderer = new ServerRenderer(ctx, { errorComponent: ErrorComponent });
            const rendered = await errorRenderer.render(errorTree);
            return {
                html: rendered.html || '',
                metadata,
                ctx,
                serialized: serializeData(ctx),
                status: 500,
            };
        }

        if (first.html !== null) {
            // Component-level Suspense: the shell already contains the
            // fallbacks. Stream the replacements as soon as each boundary
            // settles instead of buffering the whole page.
            if (streaming && first.boundaries.length) {
                const done = (async () => {
                    const chunks = await renderer.renderPendingBoundaries();
                    return {
                        html: null,
                        chunks,
                        status: 200,
                        serialized: serializeData(ctx),
                    };
                })();
                return {
                    html: first.html,
                    done,
                    mode: 'boundaries',
                    metadata,
                    ctx,
                    serialized: serializeData(ctx),
                    status: 200,
                };
            }

            const chunks = await renderer.renderPendingBoundaries();
            return {
                html: first.html,
                chunks,
                metadata,
                ctx,
                serialized: serializeData(ctx),
                status: 200,
            };
        }

        return {
            error: new Error('Render produced no output'),
            metadata,
            ctx,
            serialized: serializeData(ctx),
            status: 500,
        };
    });
}

async function renderToString(options) {
    const result = await renderPage({ ...options, streaming: false });
    if (result.error) return result;
    if (result.html !== undefined && result.html !== null && !result.done) {
        return result;
    }
    if (result.done) {
        const final = await result.done;
        return { ...result, ...final, shell: undefined, done: undefined };
    }
    return result;
}

function buildPageHTML(indexHtml, result, { lang } = {}) {
    const head = metaTags(result.metadata || {}, result.ctx, { lang });
    return injectDocument(indexHtml, {
        rootHtml: result.html || result.shell || '',
        headHtml: head,
        lang,
        hasSsr: true,
        ssrData: {
            ...(result.serialized || {}),
            streamed: !!result.done,
        },
        extraHtml: Array.isArray(result.chunks) ? result.chunks.join('\n') : '',
    });
}

module.exports = {
    ServerRenderer,
    renderPage,
    renderToString,
    buildPageHTML,
    metaTags,
    injectDocument,
    escapeHtml,
    escapeAttr,
    styleToCSS,
    defaultError,
    defaultLoading,
    defaultNotFound,
    collectMetadata,
};
