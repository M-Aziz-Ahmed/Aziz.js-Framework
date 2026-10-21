// ============================================================
//  Aziz.js server module loader
//
//  The browser loads project modules as native ES modules from
//  disk. The server cannot: page files contain JSX, imports use
//  the browser's absolute "/app/..." form, and TypeScript is not
//  executable. This loader compiles each module to CommonJS with
//  Babel, evaluates it in an isolated vm context whose globals are
//  the server runtime (h, hooks, Link, …), and caches by mtime.
// ============================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { transformCommonJS } = require('./js-transform');
const serverRuntime = require('./server-runtime');

const EXTENSIONS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.mts', '.json'];

const SERVER_MODULE_RE = /\.server\.(m?js|jsx|ts|tsx)$/i;

function isFile(p) {
    try { return fs.statSync(p).isFile(); } catch { return false; }
}

function resolveFile(base) {
    for (const ext of EXTENSIONS) {
        const candidate = base + ext;
        if (isFile(candidate)) return candidate;
    }
    for (const ext of ['.js', '.jsx', '.ts', '.tsx', '.mjs']) {
        const candidate = path.join(base, 'index' + ext);
        if (isFile(candidate)) return candidate;
    }
    return null;
}

function noop() {}

function createFrameworkExports() {
    const runtime = serverRuntime;

    const routerStub = {
        navigate: noop,
        replace: noop,
        back: noop,
        forward: noop,
        refresh: noop,
        redirect: runtime.redirect,
        notFound: runtime.notFound,
        prefetch: () => Promise.resolve(),
        Link: runtime.Link,
        useRouter: runtime.useRouter,
        useParams: runtime.useParams,
        usePathname: runtime.usePathname,
        useSearchParams: runtime.useSearchParams,
        useNavigation: runtime.useNavigation,
        useTransition: runtime.useTransition,
        useLocale: runtime.useLocale,
        router: {},
    };

    const i18nStub = {
        useLocale: runtime.useLocale,
        getLocale: () => runtime.useLocale(),
        localizeHref: runtime.localizeHref,
        locales: [],
        defaultLocale: null,
    };

    const apiStub = {
        get: () => Promise.resolve(null),
        post: () => Promise.resolve(null),
        put: () => Promise.resolve(null),
        patch: () => Promise.resolve(null),
        delete: () => Promise.resolve(null),
        del: () => Promise.resolve(null),
        request: () => Promise.resolve(null),
        configure: () => apiStub,
        setBaseURL: () => apiStub,
        setHeaders: () => apiStub,
        ApiError: class ApiError extends Error {},
    };

    const withDefault = (obj, def = obj) => ({ __esModule: true, ...obj, default: def });

    return {
        '/_framework/runtime.js': withDefault({
            h: runtime.h,
            Fragment: runtime.Fragment,
            materialize: noop,
            render: noop,
            mountPage: noop,
            hydratePage: noop,
            disposeFibers: noop,
            getFiber: noop,
            fiberCount: () => 0,
            beginRender: noop,
        }),
        '/_framework/hooks.js': withDefault({
            useState: runtime.useState,
            useReducer: runtime.useReducer,
            useEffect: runtime.useEffect,
            useMemo: runtime.useMemo,
            useCallback: runtime.useCallback,
            useRef: runtime.useRef,
            useContext: runtime.useContext,
            createContext: runtime.createContext,
            useLocalStorage: runtime.useLocalStorage,
            useFetch: runtime.useFetch,
            useApi: runtime.useFetch,
            createResource: runtime.createResource,
            fetchResource: runtime.fetchResource,
            use: runtime.use,
            onLoadState: runtime.onLoadState,
            getPendingLoads: runtime.getPendingLoads,
            clearFetchCache: runtime.clearFetchCache,
            warmCache: runtime.warmCache,
            initHooks: noop,
            resetHooks: noop,
            prepareHooks: runtime.prepareHooks,
            finishHooks: runtime.finishHooks,
            beginLoad: noop,
            endLoad: noop,
        }),
        '/_framework/suspense.js': withDefault({
            createResource: runtime.createResource,
            fetchResource: runtime.fetchResource,
            use: runtime.use,
            isThenable: runtime.isThenable,
        }),
        '/_framework/metadata.js': withDefault({
            mergeMetadata: runtime.mergeMetadata,
            metaTitle: runtime.metaTitle,
            applyMetadata: noop,
        }),
        '/_framework/router.js': withDefault(routerStub),
        '/_framework/i18n.js': withDefault(i18nStub),
        '/_framework/components.js': withDefault({
            Suspense: runtime.Suspense,
            Link: runtime.Link,
            Image: runtime.Image,
            Font: runtime.Font,
            Script: runtime.Script,
        }),
        '/_framework/api.js': withDefault(apiStub, apiStub),
        '/_framework/boot.js': withDefault({}),
        '/_framework/next-response.js': require(path.join(__dirname, '..', '..', '_framework', 'next-response.js')),
    };
}

class ServerModuleLoader {
    constructor(root, options = {}) {
        this.root = path.resolve(root);
        this.frameworkExports = createFrameworkExports();
        this.cache = new Map();
        this.context = vm.createContext(this.createSandbox());
        this.servedFiles = new Set();
        // Precompiled CommonJS artifacts (absolute source path → artifact).
        // When present the server never invokes Babel: the build already did.
        this.precompiled = options.precompiled || new Map();
    }

    createSandbox() {
        const runtime = serverRuntime;
        return {
            console,
            process,
            Buffer,
            URL,
            URLSearchParams,
            TextEncoder,
            TextDecoder,
            AbortController,
            AbortSignal,
            Blob,
            FormData,
            Headers,
            Request,
            Response,
            ReadableStream,
            TransformStream,
            WritableStream,
            crypto: globalThis.crypto,
            atob: globalThis.atob,
            btoa: globalThis.btoa,
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            setImmediate,
            clearImmediate,
            queueMicrotask,
            performance: globalThis.performance,
            fetch: (...args) => runtime.serverFetch(args[0], args[1] || {}),
            h: runtime.h,
            Fragment: runtime.Fragment,
            Suspense: runtime.Suspense,
            Link: runtime.Link,
            Image: runtime.Image,
            Font: runtime.Font,
            Script: runtime.Script,
            notFound: runtime.notFound,
            redirect: runtime.redirect,
            ...runtime,
        };
    }

    resolve(fromFile, specifier) {
        if (typeof specifier !== 'string') return null;

        if (this.frameworkExports[specifier]) return { framework: specifier };

        if (specifier.startsWith('node:') || require('module').builtinModules.includes(specifier)) {
            return { native: specifier };
        }

        if (/^[a-zA-Z]+:\/\//.test(specifier)) return null;

        let base;
        if (specifier.startsWith('@/')) {
            base = path.join(this.root, specifier.slice(2));
        } else if (specifier.startsWith('.')) {
            base = path.resolve(path.dirname(fromFile), specifier);
        } else if (specifier.startsWith('/')) {
            base = path.join(this.root, specifier);
            if (!isFile(base) && !fs.existsSync(path.dirname(base))) return null;
        } else {
            return { native: specifier };
        }

        const resolved = resolveFile(base);
        return resolved ? { file: resolved } : null;
    }

    makeRequire(fromFile) {
        return (specifier) => {
            const target = this.resolve(fromFile, specifier);
            if (!target) {
                throw new Error(`Cannot resolve module "${specifier}" imported from ${fromFile}`);
            }
            if (target.framework) {
                return this.frameworkExports[target.framework];
            }
            if (target.native) {
                return require(target.native);
            }
            return this.load(target.file);
        };
    }

    load(filePath) {
        const resolved = path.resolve(filePath);
        const stat = fs.statSync(resolved);
        const hit = this.cache.get(resolved);
        if (hit && hit.mtimeMs === stat.mtimeMs) return hit.exports;

        this.servedFiles.add(resolved);

        if (resolved.endsWith('.json')) {
            const exports = JSON.parse(fs.readFileSync(resolved, 'utf8'));
            this.cache.set(resolved, { mtimeMs: stat.mtimeMs, exports });
            return exports;
        }

        if (!/\.(m?[jt]sx?)$/i.test(resolved)) {
            // CSS/asset imports are side-effect free on the server.
            const exports = {};
            this.cache.set(resolved, { mtimeMs: stat.mtimeMs, exports });
            return exports;
        }

        const artifact = this.precompiled.get(resolved);
        let source = '';
        let isServerModule = artifact ? !!artifact.serverModule : false;
        if (fs.existsSync(resolved)) {
            source = fs.readFileSync(resolved, 'utf8');
            isServerModule = isServerModule ||
                SERVER_MODULE_RE.test(resolved) ||
                /^\s*['"]use server['"]/.test(source);
        }

        let code;
        if (artifact && fs.existsSync(artifact.file)) {
            // Built ahead of time by `npm run build` — no Babel in the
            // request path.
            code = fs.readFileSync(artifact.file, 'utf8');
        } else {
            try {
                code = transformCommonJS(source, path.basename(resolved));
            } catch (err) {
                throw new Error(`Failed to compile ${path.relative(this.root, resolved)}: ${err.message}`);
            }
        }

        const module = { exports: {} };
        const wrapper = `(function (exports, require, module, __filename, __dirname) {\n${code}\n})`;
        const fn = vm.runInContext(wrapper, this.context, {
            filename: resolved,
            displayErrors: true,
        });

        fn.call(
            module.exports,
            module.exports,
            this.makeRequire(resolved),
            module,
            resolved,
            path.dirname(resolved)
        );

        if (isServerModule) {
            module.exports.__azizServerModule = true;
            for (const value of Object.values(module.exports)) {
                if (typeof value === 'function') {
                    value.__azizServer = true;
                    value.__azizServerFile = path.relative(this.root, resolved).replace(/\\/g, '/');
                }
            }
        }

        this.cache.set(resolved, { mtimeMs: stat.mtimeMs, exports: module.exports });
        return module.exports;
    }

    invalidate(filePath) {
        this.cache.delete(path.resolve(filePath));
    }

    clear() {
        this.cache.clear();
    }
}

module.exports = {
    ServerModuleLoader,
    resolveFile,
    createFrameworkExports,
    SERVER_MODULE_RE,
};
