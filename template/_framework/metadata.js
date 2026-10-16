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

export function mergeMetadata(...modules) {
    return modules.reduce((acc, mod) => deepMerge(acc, (mod && mod.metadata) || {}), {});
}

export function applyMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return;
    const merged = metadata;

    const title = metaTitle(merged.title);
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