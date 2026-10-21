// ============================================================
//  Aziz.js — server-side page route matching
//
//  Mirrors _framework/route-match.js in CommonJS so the dev server
//  and the static builder can resolve pages without importing the
//  browser ESM runtime. Kept in sync by tests.
// ============================================================

function normalizePath(pathname) {
    if (!pathname) return '/';
    let p = String(pathname).split('?')[0].split('#')[0];
    if (!p.startsWith('/')) p = '/' + p;
    if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '');
    return p || '/';
}

function splitPath(pathname) {
    return normalizePath(pathname).split('/').filter(Boolean);
}

function isDynamic(part) {
    return part.startsWith('[') && part.endsWith(']') && !part.startsWith('[...');
}

function isCatchAll(part) {
    return part.startsWith('[...') && part.endsWith(']');
}

function matchRoute(pattern, pathname) {
    const patternParts = splitPath(pattern);
    const pathParts = splitPath(pathname);
    const params = {};
    const catchAll = patternParts.findIndex(isCatchAll);

    if (catchAll !== -1) {
        if (pathParts.length < patternParts.length) return null;
        for (let i = 0; i < catchAll; i++) {
            const p = patternParts[i];
            if (isDynamic(p)) params[p.slice(1, -1)] = decodeURIComponent(pathParts[i]);
            else if (p !== pathParts[i]) return null;
        }
        params[patternParts[catchAll].slice(4, -1)] = pathParts.slice(catchAll).map(decodeURIComponent);
        return params;
    }

    if (patternParts.length !== pathParts.length) return null;
    for (let i = 0; i < patternParts.length; i++) {
        const p = patternParts[i];
        if (isDynamic(p)) params[p.slice(1, -1)] = decodeURIComponent(pathParts[i]);
        else if (p !== pathParts[i]) return null;
    }
    return params;
}

function specificity(pattern) {
    const parts = splitPath(pattern);
    let statics = 0, dynamics = 0, catchAll = 0;
    for (const p of parts) {
        if (isCatchAll(p)) catchAll++;
        else if (isDynamic(p)) dynamics++;
        else statics++;
    }
    return { statics, dynamics, catchAll, depth: parts.length };
}

function compareSpecificity(a, b) {
    if (a.catchAll !== b.catchAll) return a.catchAll - b.catchAll;
    if (a.statics !== b.statics) return b.statics - a.statics;
    if (a.dynamics !== b.dynamics) return b.dynamics - a.dynamics;
    return b.depth - a.depth;
}

function resolveRoute(routes, pathname) {
    const normalized = normalizePath(pathname);
    if (Object.prototype.hasOwnProperty.call(routes, normalized)) {
        return { pattern: normalized, params: {}, value: routes[normalized] };
    }

    const candidates = [];
    for (const pattern of Object.keys(routes)) {
        if (!pattern.includes('[')) continue;
        const params = matchRoute(pattern, normalized);
        if (params !== null) {
            candidates.push({ pattern, params, value: routes[pattern], score: specificity(pattern) });
        }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => compareSpecificity(a.score, b.score));
    const best = candidates[0];
    return { pattern: best.pattern, params: best.params, value: best.value };
}

function matchesLayout(pattern, pathname) {
    const patternParts = splitPath(pattern);
    if (patternParts.length === 0) return true;
    const pathParts = splitPath(pathname);
    if (pathParts.length < patternParts.length) return false;
    for (let i = 0; i < patternParts.length; i++) {
        const p = patternParts[i];
        if (isCatchAll(p)) return true;
        if (isDynamic(p)) continue;
        if (p !== pathParts[i]) return false;
    }
    return true;
}

function collectLayouts(layouts, pathname) {
    return layouts
        .filter(l => matchesLayout(l.path, pathname))
        .sort((a, b) => splitPath(a.path).length - splitPath(b.path).length);
}

function collectNearest(list, pathname) {
    const matches = list.filter(e => matchesLayout(e.path, pathname));
    if (!matches.length) return null;
    matches.sort((a, b) => splitPath(b.path).length - splitPath(a.path).length);
    return matches[0];
}

// ─── i18n helpers ────────────────────────────────────────────

function normalizeI18n(config) {
    if (!config || !Array.isArray(config.locales) || !config.locales.length) return null;
    return {
        locales: config.locales,
        defaultLocale: config.defaultLocale || config.locales[0],
        localePrefix: config.localePrefix || 'always',
        cookie: config.cookie || 'AZIZ_LOCALE',
    };
}

function detectLocale(pathname, config) {
    if (!config) return { locale: null, pathname: normalizePath(pathname), prefixed: false };
    const parts = splitPath(pathname);
    const first = parts[0];
    if (first && config.locales.includes(first)) {
        const rest = '/' + parts.slice(1).join('/');
        return {
            locale: first,
            pathname: normalizePath(rest),
            prefixed: true,
        };
    }
    return { locale: config.defaultLocale, pathname: normalizePath(pathname), prefixed: false };
}

function localeRedirect(pathname, config, acceptLanguage, cookieValue) {
    if (!config) return null;
    const detected = detectLocale(pathname, config);
    if (detected.prefixed) return null;

    let locale = config.defaultLocale;
    if (cookieValue && config.locales.includes(cookieValue)) locale = cookieValue;
    else if (acceptLanguage) {
        for (const part of String(acceptLanguage).split(',')) {
            const tag = part.split(';')[0].trim();
            const base = tag.split('-')[0];
            if (config.locales.includes(tag)) { locale = tag; break; }
            if (config.locales.includes(base)) { locale = base; break; }
        }
    }

    if (config.localePrefix === 'as-needed' && locale === config.defaultLocale) return null;
    const suffix = normalizePath(pathname) === '/' ? '' : normalizePath(pathname);
    return '/' + locale + suffix;
}

module.exports = {
    normalizePath,
    splitPath,
    matchRoute,
    specificity,
    compareSpecificity,
    resolveRoute,
    matchesLayout,
    collectLayouts,
    collectNearest,
    normalizeI18n,
    detectLocale,
    localeRedirect,
};
