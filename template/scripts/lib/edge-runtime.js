// ============================================================
//  Aziz.js edge runtime for API routes
//
//    export const runtime = 'edge';
//    export function GET(request) {
//        return new Response(JSON.stringify({ ok: true }));
//    }
//
//  The module is evaluated in a vm context with Web-standard globals
//  and a require() that refuses Node built-ins. It is not a V8 isolate
//  — process-level escape hatches still exist — but it is a real
//  capability boundary for accidental fs/db use and it mirrors the
//  Web Request/Response contract edge platforms expose.
// ============================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { transformCommonJS } = require('./js-transform');

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    for (const part of String(header).split(';')) {
        const i = part.indexOf('=');
        if (i === -1) continue;
        const key = part.slice(0, i).trim();
        try { out[key] = decodeURIComponent(part.slice(i + 1).trim()); }
        catch { out[key] = part.slice(i + 1).trim(); }
    }
    return out;
}

const EDGE_RE = /(?:export\s+(?:const|let|var)\s+runtime\s*=\s*['"]edge['"]|runtime\s*[:=]\s*['"]edge['"])/;

function isEdgeSource(source) {
    return EDGE_RE.test(String(source || ''));
}

function edgeSandbox() {
    const env = { ...process.env };
    return {
        console,
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        Headers,
        Request,
        Response,
        fetch: (...args) => globalThis.fetch(...args),
        ReadableStream,
        TransformStream,
        WritableStream,
        AbortController,
        AbortSignal,
        Blob,
        File: typeof File !== 'undefined' ? File : undefined,
        FormData,
        crypto: globalThis.crypto,
        atob: globalThis.atob,
        btoa: globalThis.btoa,
        structuredClone: globalThis.structuredClone,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        queueMicrotask,
        performance: globalThis.performance,
        process: { env, nextTick: queueMicrotask },
        Buffer: undefined,
        globalThis: undefined,
    };
}

function loadEdgeRoute(filePath) {
    const source = fs.readFileSync(filePath, 'utf8');
    const code = transformCommonJS(source, path.basename(filePath));
    const sandbox = edgeSandbox();
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;

    const context = vm.createContext(sandbox);
    const module = { exports: {} };

    const forbiddenRequire = (spec) => {
        const err = new Error(
            `[edge] require("${spec}") is not available. ` +
            'Edge routes may only use Web APIs (fetch, Request, Response, crypto, …).'
        );
        err.code = 'ERR_EDGE_REQUIRE';
        throw err;
    };

    const wrapper = `(function (exports, require, module, __filename, __dirname) {\n${code}\n})`;
    const fn = vm.runInContext(wrapper, context, { filename: filePath, displayErrors: true });
    fn.call(module.exports, module.exports, forbiddenRequire, module, filePath, path.dirname(filePath));
    module.exports.__azizEdge = true;
    return module.exports;
}

async function invokeEdgeHandler(handler, { method, url, headers, body, params }) {
    const requestHeaders = new Headers();
    for (const [key, value] of Object.entries(headers || {})) {
        if (value === undefined) continue;
        if (Array.isArray(value)) value.forEach(v => requestHeaders.append(key, v));
        else requestHeaders.set(key, value);
    }

    const init = { method, headers: requestHeaders };
    if (method !== 'GET' && method !== 'HEAD' && body) init.body = body;

    const request = new Request(url, init);
    request.params = params || {};
    request.query = new URL(url).searchParams;
    request.nextUrl = new URL(url);
    request.cookies = parseCookies(headers && headers.cookie);

    const result = await handler(request);

    if (result instanceof Response) return result;
    if (typeof result === 'string') {
        return new Response(result, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (result === undefined || result === null) {
        return new Response(JSON.stringify({ error: 'Edge handler returned no response' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
    }
    return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

async function sendEdgeResponse(response, res, { headOnly = false } = {}) {
    const headers = {};
    response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') return;
        headers[key] = value;
    });
    const cookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    if (cookies.length) headers['Set-Cookie'] = cookies;

    const body = headOnly ? null : Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, headers);
    res.end(body || undefined);
}

module.exports = {
    isEdgeSource,
    loadEdgeRoute,
    invokeEdgeHandler,
    sendEdgeResponse,
};
