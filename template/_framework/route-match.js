// ============================================================
//  Aziz.js — Route matching (pure, dependency-free)
//
//  Used by the client router. Kept side-effect free so it can
//  be unit-tested in isolation.
//
//  Supported patterns:
//    /about            → static
//    /blog/[slug]      → dynamic segment
//    /files/[...path]  → catch-all (one or more segments)
// ============================================================

// Strip query/hash, force leading slash, drop trailing slash (except root).
export function normalizePath(pathname) {
    if (!pathname) return '/';
    let p = String(pathname).split('?')[0].split('#')[0];
    if (!p.startsWith('/')) p = '/' + p;
    if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '');
    return p || '/';
}

export function splitPath(pathname) {
    return normalizePath(pathname).split('/').filter(Boolean);
}

function isDynamic(part) {
    return part.startsWith('[') && part.endsWith(']') && !part.startsWith('[...');
}

function isCatchAll(part) {
    return part.startsWith('[...') && part.endsWith(']');
}

// Match a route pattern against a pathname.
// Returns a params object, or null when there is no match.
export function matchRoute(pattern, pathname) {
    const patternParts = splitPath(pattern);
    const pathParts = splitPath(pathname);
    const params = {};

    const catchAll = patternParts.findIndex(isCatchAll);

    if (catchAll !== -1) {
        // Catch-all must be the final segment. It needs at least one
        // path segment of its own (/blog/[...slug] does not match /blog).
        if (pathParts.length < patternParts.length) return null;

        for (let i = 0; i < catchAll; i++) {
            const p = patternParts[i];
            if (isDynamic(p)) {
                params[p.slice(1, -1)] = decodeURIComponent(pathParts[i]);
            } else if (p !== pathParts[i]) {
                return null;
            }
        }
        params[patternParts[catchAll].slice(4, -1)] = pathParts.slice(catchAll).map(decodeURIComponent);
        return params;
    }

    if (patternParts.length !== pathParts.length) return null;

    for (let i = 0; i < patternParts.length; i++) {
        const p = patternParts[i];
        if (isDynamic(p)) {
            params[p.slice(1, -1)] = decodeURIComponent(pathParts[i]);
        } else if (p !== pathParts[i]) {
            return null;
        }
    }

    return params;
}

// Specificity score — higher is more specific.
export function specificity(pattern) {
    const parts = splitPath(pattern);
    let statics = 0;
    let dynamics = 0;
    let catchAll = 0;
    for (const p of parts) {
        if (isCatchAll(p)) catchAll++;
        else if (isDynamic(p)) dynamics++;
        else statics++;
    }
    return { statics, dynamics, catchAll, depth: parts.length };
}

export function compareSpecificity(a, b) {
    if (a.catchAll !== b.catchAll) return a.catchAll - b.catchAll;
    if (a.statics !== b.statics) return b.statics - a.statics;
    if (a.dynamics !== b.dynamics) return b.dynamics - a.dynamics;
    return b.depth - a.depth;
}

// Resolve the best route for a pathname from a { pattern: value } map.
// Returns { pattern, params, value } or null.
export function resolveRoute(routes, pathname) {
    const normalized = normalizePath(pathname);

    // 1. Exact match wins outright
    if (Object.prototype.hasOwnProperty.call(routes, normalized)) {
        return { pattern: normalized, params: {}, value: routes[normalized] };
    }

    // 2. Dynamic / catch-all patterns, ranked by specificity
    const candidates = [];
    for (const pattern of Object.keys(routes)) {
        if (!pattern.includes('[')) continue;
        const params = matchRoute(pattern, normalized);
        if (params !== null) {
            candidates.push({ pattern, params, value: routes[pattern], score: specificity(pattern) });
        }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => compareSpecificity(a.score, b.score));
    const best = candidates[0];
    return { pattern: best.pattern, params: best.params, value: best.value };
}

// Does a layout at `pattern` apply to `pathname`?
// Layouts are prefix-scoped: app/about/layout.js applies to /about and /about/*.
export function matchesLayout(pattern, pathname) {
    const patternParts = splitPath(pattern);
    if (patternParts.length === 0) return true; // root layout

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

// Collect matching layouts, outermost (root) first.
export function collectLayouts(layouts, pathname) {
    return layouts
        .filter(l => matchesLayout(l.path, pathname))
        .sort((a, b) => splitPath(a.path).length - splitPath(b.path).length);
}
