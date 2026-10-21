const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ServerModuleLoader } = require('../template/scripts/lib/module-loader');
const renderer = require('../template/scripts/lib/renderer');
const pageRouter = require('../template/scripts/lib/page-router');
const staticStore = require('../template/scripts/lib/static-store');
const fontOptimizer = require('../template/scripts/lib/font-optimizer');
const imageOptimizer = require('../template/scripts/lib/image-optimizer');
const edgeRuntime = require('../template/scripts/lib/edge-runtime');

const roots = [];

function makeApp(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aziz-ssr-'));
    roots.push(root);
    for (const [name, content] of Object.entries(files)) {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    return root;
}

function baseFiles(extra = {}) {
    return {
        'index.html': '<!doctype html><html><head><title>old</title></head><body><div id="root"></div><script type="module" src="/_framework/boot.js"></script></body></html>',
        'app/layout.js': `
            export const metadata = { title: { default: 'Layout', template: '%s | Site' }, description: 'layout desc' };
            export default function Layout({ children }) {
                return <div class="shell"><header>Header</header><main>{children}</main></div>;
            }
        `,
        'app/page.js': `
            export const metadata = { title: 'Home', openGraph: { type: 'article' } };
            export default function Page() {
                return <section><h1>Hello SSR</h1><p>Rendered on the server.</p></section>;
            }
        `,
        ...extra,
    };
}

function load(root, name) {
    return new ServerModuleLoader(root).load(path.join(root, name));
}

test.after(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('renderToString renders layouts, page HTML and merged metadata', async () => {
    const root = makeApp(baseFiles());
    const loader = new ServerModuleLoader(root);
    const result = await renderer.renderToString({
        loader,
        pageFile: path.join(root, 'app/page.js'),
        layoutFiles: [path.join(root, 'app/layout.js')],
        pathname: '/',
        params: {},
        indexHtml: fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
    });

    assert.equal(result.status, 200);
    assert.match(result.html, /<h1>Hello SSR<\/h1>/);
    assert.match(result.html, /<header>Header<\/header>/);
    const doc = renderer.buildPageHTML(
        fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
        result,
        { lang: 'en' }
    );
    assert.match(doc, /<title>Home \| Site<\/title>/);
    assert.match(doc, /<meta name="description" content="layout desc">/);
    assert.match(doc, /property="og:type" content="article"/);
    assert.match(doc, /data-aziz-ssr="1"/);
    assert.match(doc, /window\.__AZIZ_SSR__=/);
    assert.doesNotMatch(doc, /<title>old<\/title>/);
});

test('renderToString awaits async server components', async () => {
    const root = makeApp(baseFiles({
        'app/page.js': `
            async function Slow() {
                await new Promise(resolve => setTimeout(resolve, 10));
                return <strong>async data</strong>;
            }
            export default async function Page() {
                return <section><Slow /></section>;
            }
        `,
    }));

    const loader = new ServerModuleLoader(root);
    const result = await renderer.renderToString({
        loader,
        pageFile: path.join(root, 'app/page.js'),
        layoutFiles: [path.join(root, 'app/layout.js')],
        pathname: '/',
        params: {},
    });

    assert.match(result.html, /<strong>async data<\/strong>/);
});

test('streaming Suspense sends the fallback first, then a replacement script', async () => {
    const root = makeApp(baseFiles({
        'app/page.js': `
            async function Slow() {
                await new Promise(resolve => setTimeout(resolve, 25));
                return <p id="late">late data</p>;
            }
            export default function Page() {
                return <section><h1>Boundary</h1><Suspense fallback={<p id="fallback">loading</p>}><Slow /></Suspense></section>;
            }
        `,
    }));

    const loader = new ServerModuleLoader(root);
    const result = await renderer.renderPage({
        loader,
        pageFile: path.join(root, 'app/page.js'),
        layoutFiles: [path.join(root, 'app/layout.js')],
        pathname: '/',
        params: {},
        streaming: true,
    });

    assert.equal(result.mode, 'boundaries');
    assert.match(result.html, /id="fallback"/);
    assert.doesNotMatch(result.html, /id="late"/);

    const final = await result.done;
    const chunks = final.chunks.join('\n');
    assert.match(chunks, /late data/);
    assert.match(chunks, /data-aziz-boundary="1"/);
});

test('route-level streaming renders loading.js as the shell', async () => {
    const root = makeApp(baseFiles({
        'app/loading.js': `export default function Loading() { return <p id="loading">Route loading</p>; }`,
        'app/page.js': `
            export default async function Page() {
                await new Promise(resolve => setTimeout(resolve, 15));
                return <h1 id="ready">Ready</h1>;
            }
        `,
    }));

    const loader = new ServerModuleLoader(root);
    const result = await renderer.renderPage({
        loader,
        pageFile: path.join(root, 'app/page.js'),
        layoutFiles: [path.join(root, 'app/layout.js')],
        loadingFile: path.join(root, 'app/loading.js'),
        pathname: '/',
        params: {},
        streaming: true,
    });

    assert.equal(result.mode, 'shell');
    assert.match(result.shell, /Route loading/);
    const final = await result.done;
    assert.match(final.html, /id="ready"/);
});

test('generateMetadata receives params and deep-merges over the layout', async () => {
    const root = makeApp(baseFiles({
        'app/[slug]/page.js': `
            export async function generateMetadata({ params }) {
                return { title: params.slug.toUpperCase(), description: 'dynamic ' + params.slug };
            }
            export default function Page({ params }) {
                return <h1>{params.slug}</h1>;
            }
        `,
    }));

    const loader = new ServerModuleLoader(root);
    const result = await renderer.renderToString({
        loader,
        pageFile: path.join(root, 'app/[slug]/page.js'),
        layoutFiles: [path.join(root, 'app/layout.js')],
        pathname: '/hello',
        params: { slug: 'hello' },
    });

    assert.match(result.html, /<h1>hello<\/h1>/);
    assert.match(result.metadata.description, /dynamic hello/);
    assert.equal(result.metadata.title.default, 'HELLO');
    assert.equal(result.metadata.title.template, '%s | Site');
});

test('page components receive params, searchParams and locale', async () => {
    const root = makeApp(baseFiles({
        'app/post/page.js': `
            export default function Page(props) {
                return <p id="props">{props.params.slug}:{props.searchParams.get('q')}:{props.locale}</p>;
            }
        `,
    }));

    const loader = new ServerModuleLoader(root);
    const result = await renderer.renderToString({
        loader,
        pageFile: path.join(root, 'app/post/page.js'),
        layoutFiles: [path.join(root, 'app/layout.js')],
        pathname: '/fr/post',
        params: { slug: 'abc' },
        searchParams: new URLSearchParams('q=term'),
        locale: 'fr',
    });

    assert.match(result.html, /abc:term:fr/);
});

test('i18n: detection, redirect and as-needed prefixes', () => {
    const config = pageRouter.normalizeI18n({
        locales: ['en', 'fr'],
        defaultLocale: 'en',
        localePrefix: 'always',
    });

    assert.deepEqual(pageRouter.detectLocale('/fr/about', config), {
        locale: 'fr', pathname: '/about', prefixed: true,
    });
    assert.equal(pageRouter.localeRedirect('/about', config, 'fr-CA,fr;q=0.9'), '/fr/about');
    assert.equal(pageRouter.localeRedirect('/fr/about', config, 'en'), null);

    const asNeeded = pageRouter.normalizeI18n({
        locales: ['en', 'fr'], defaultLocale: 'en', localePrefix: 'as-needed',
    });
    assert.equal(pageRouter.localeRedirect('/about', asNeeded, 'en-US'), null);
    assert.equal(pageRouter.localeRedirect('/about', asNeeded, 'de'), null);
    assert.equal(pageRouter.localeRedirect('/about', asNeeded, 'fr'), '/fr/about');
});

test('static store writes, reads and expires ISR entries', async () => {
    const root = makeApp({});
    await staticStore.writeStatic(root, '/hello', '<h1>static</h1>', { revalidate: 60 });
    assert.match((await staticStore.readStatic(root, '/hello')).html, /static/);
    assert.equal(await staticStore.readStatic(root, '/missing'), null);

    await staticStore.writeISR(root, '/hello', { html: '<h1>isr</h1>', revalidate: 5 });
    const isr = await staticStore.readISR(root, '/hello');
    assert.match(isr.html, /isr/);
    assert.equal(isr.revalidate, 5);
    assert.ok(isr.at > 0);
});

test('font optimizer injects font-display and finds local preloads', () => {
    const root = makeApp({
        'styles/fonts.css': `@font-face { font-family: Test; src: url(/fonts/test.woff2); }`,
    });
    const css = fontOptimizer.optimizeCSS(
        fs.readFileSync(path.join(root, 'styles/fonts.css'), 'utf8')
    );
    assert.match(css, /font-display:swap/);
    const preloads = fontOptimizer.collectFontPreloads(root);
    assert.deepEqual(preloads[0], {
        rel: 'preload', as: 'font', href: '/fonts/test.woff2', type: 'font/woff2', crossorigin: '',
    });
});

test('image optimizer confines sources to the project and blocks server dirs', () => {
    const root = makeApp({
        'images/pixel.png': Buffer.from('89504e470d0a1a0a', 'hex'),
        'server/secret.png': Buffer.from('secret'),
    });

    assert.equal(imageOptimizer.resolveSource(root, '/images/pixel.png').file,
        path.join(root, 'images', 'pixel.png'));
    assert.equal(imageOptimizer.resolveSource(root, '/server/secret.png'), null);
    assert.equal(imageOptimizer.resolveSource(root, '../../etc/passwd'), null);
});

test('edge runtime: Web Request/Response works and Node builtins are blocked', async () => {
    const root = makeApp({
        'api/edge.js': `
            export const runtime = 'edge';
            export async function GET(request) {
                return new Response(JSON.stringify({ x: request.query.get('x') }), {
                    headers: { 'content-type': 'application/json' },
                });
            }
        `,
        'api/node.js': `
            export const runtime = 'edge';
            export function GET() { require('fs'); return new Response('nope'); }
        `,
    });

    const edge = edgeRuntime.loadEdgeRoute(path.join(root, 'api/edge.js'));
    assert.equal(edge.runtime, 'edge');
    const response = await edgeRuntime.invokeEdgeHandler(edge.GET, {
        method: 'GET',
        url: 'http://localhost/api/edge?x=7',
        headers: {},
        params: {},
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { x: '7' });

    const node = edgeRuntime.loadEdgeRoute(path.join(root, 'api/node.js'));
    await assert.rejects(
        () => edgeRuntime.invokeEdgeHandler(node.GET, {
            method: 'GET', url: 'http://localhost/api/node', headers: {}, params: {},
        }),
        /require\("fs"\) is not available/
    );
});
