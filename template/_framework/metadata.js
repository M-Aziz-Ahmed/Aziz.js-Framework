// ============================================================
//  Aziz.js Metadata
//  Next.js-style `export const metadata = { … }` on any layout or page.
//
//  Merges outermost-first so a page overrides its layout, with a deep merge
//  for openGraph/twitter so a page can override one field without restating
//  the rest. Everything is applied to <head> at runtime, which means it is
//  only visible to consumers that execute JavaScript — see the README's
//  "no SSR" limitation.
// ============================================================

const MANAGED = 'data-aziz-meta';

// name="…" tags, including our twitter:* additions
const NAME_TAGS = {
    description: 'description',
    keywords: 'keywords',
    author: 'author',
    robots: 'robots',
    viewport: 'viewport',
    'theme-color': 'themeColor',
    'twitter:card': 'twitter.card',
    'twitter:title': 'twitter.title',
    'twitter:description': 'twitter.description',
    'twitter:image': 'twitter.image',
    'twitter:creator': 'twitter.creator',
};

// property="…" tags for Open Graph
const PROPERTY_TAGS = {
    'og:title': 'openGraph.title',
    'og:description': 'openGraph.description',
    'og:image': 'openGraph.image',
    'og:url': 'openGraph.url',
    'og:site_name': 'openGraph.siteName',
    'og:type': 'openGraph.type',
};

function metaTitle(title) {
    if (!title) return '';
    if (typeof title === 'string') return title;
    if (typeof title === 'object') return title.absolute || title.default || '';
    return '';
}

function pick(source, path) {
    let cur = source;
    for (const key of path.split('.')) {
        if (cur == null) return undefined;
        cur = cur[key];
    }
    return cur;
}

function deepMerge(base, extra) {
    const out = { ...base };
    for (const [key, value] of Object.entries(extra || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            out[key] = deepMerge(out[key] || {}, value);
        } else if (value !== undefined) {
            out[key] = value;
        }
    }
    return out;
}

function upsert(attr, key, content) {
    if (content === undefined || content === null || content === '') return;
    const value = Array.isArray(content) ? content.join(', ') : String(content);

    let tag = document.head.querySelector(`${attr}="${key}"]`);
    if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(attr, key);
        tag.setAttribute(MANAGED, '');
        document.head.appendChild(tag);
    }
    tag.setAttribute('content', value);
}

function upsertCanonical(href) {
    if (!href) return;
    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        link.setAttribute(MANAGED, '');
        document.head.appendChild(link);
    }
    link.setAttribute('href', href);
}

function mergeTitle(base, extra) {
    if (extra === undefined) return base;
    if (typeof extra === 'string') {
        if (base && typeof base === 'object' && base.template) {
            return { default: extra, template: base.template };
        }
        return extra;
    }
    if (extra && typeof extra === 'object') {
        const merged = {
            ...(base && typeof base === 'object' ? base : {}),
            ...extra,
        };
        if (!merged.template && base && typeof base === 'object' && base.template) {
            merged.template = base.template;
        }
        return merged;
    }
    return extra;
}

export function mergeMetadata(...modules) {
    let acc = {};
    for (const mod of modules) {
        const block = (mod && mod.metadata) || {};
        const rest = { ...block };
        delete rest.title;
        acc = deepMerge(acc, rest);
        if (Object.prototype.hasOwnProperty.call(block, 'title')) {
            acc.title = mergeTitle(acc.title, block.title);
        }
    }
    return acc;
}

export function applyMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return;
    const merged = metadata;

    let title = metaTitle(merged.title);
    if (merged.title && typeof merged.title === 'object' && merged.title.template &&
        !merged.title.absolute && title) {
        title = merged.title.template.replace('%s', title);
    }
    if (title) document.title = title;

    for (const [tag, path] of Object.entries(NAME_TAGS)) {
        upsert('name', tag, pick(merged, path));
    }
    for (const [tag, path] of Object.entries(PROPERTY_TAGS)) {
        upsert('property', tag, pick(merged, path));
    }
    upsertCanonical(merged.canonical);
}

export { metaTitle };