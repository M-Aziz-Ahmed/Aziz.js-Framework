const test = require('node:test');
const assert = require('node:assert');
const { loadFramework } = require('./helpers/esm.js');

let rm;

test.before(async () => {
    ({ routeMatch: rm } = await loadFramework(['route-match.js']));
});

test('normalizePath strips query/hash and trailing slash', () => {
    assert.equal(rm.normalizePath('/a/b/'), '/a/b');
    assert.equal(rm.normalizePath('/a?x=1'), '/a');
    assert.equal(rm.normalizePath('/a#frag'), '/a');
    assert.equal(rm.normalizePath(''), '/');
    assert.equal(rm.normalizePath('/'), '/');
});

test('static exact match', () => {
    assert.deepEqual(rm.matchRoute('/about', '/about'), {});
    assert.equal(rm.matchRoute('/about', '/contact'), null);
    assert.equal(rm.matchRoute('/about', '/about/team'), null);
});

test('dynamic segment captures params', () => {
    assert.deepEqual(rm.matchRoute('/blog/[slug]', '/blog/hello'), { slug: 'hello' });
    assert.equal(rm.matchRoute('/blog/[slug]', '/blog'), null);
    assert.equal(rm.matchRoute('/blog/[slug]', '/blog/a/b'), null);
});

test('catch-all captures remaining segments', () => {
    assert.deepEqual(rm.matchRoute('/files/[...path]', '/files/a/b/c'), { path: ['a', 'b', 'c'] });
    assert.deepEqual(rm.matchRoute('/files/[...path]', '/files/one'), { path: ['one'] });
});

test('BUGFIX: catch-all does not swallow paths with a different prefix', () => {
    assert.equal(rm.matchRoute('/files/[...path]', '/other/a'), null);
    assert.equal(rm.matchRoute('/files/[...path]', '/'), null);
    assert.equal(rm.matchRoute('/files/[...path]', '/files'), null);
});

test('BUGFIX: dynamic segments before catch-all are validated', () => {
    assert.deepEqual(rm.matchRoute('/blog/[id]/[...rest]', '/blog/42/a/b'), { id: '42', rest: ['a', 'b'] });
    assert.equal(rm.matchRoute('/blog/[id]/[...rest]', '/news/42/a'), null);
});

test('specificity ranks static > dynamic > catch-all', () => {
    const routes = {
        '/[...all]': 'catchall',
        '/blog/[slug]': 'dynamic',
        '/blog/new': 'static',
    };
    assert.equal(rm.resolveRoute(routes, '/blog/new').value, 'static');
    assert.equal(rm.resolveRoute(routes, '/blog/hello').value, 'dynamic');
    assert.equal(rm.resolveRoute(routes, '/other/x').value, 'catchall');
});

test('resolveRoute returns null for no match', () => {
    assert.equal(rm.resolveRoute({ '/about': 1 }, '/nope'), null);
});

test('resolveRoute normalizes trailing slash', () => {
    assert.equal(rm.resolveRoute({ '/about': 'a' }, '/about/').value, 'a');
});

test('layouts match by prefix', () => {
    assert.ok(rm.matchesLayout('/', '/anything/deep'));
    assert.ok(rm.matchesLayout('/about', '/about'));
    assert.ok(rm.matchesLayout('/about', '/about/team'));
    assert.ok(!rm.matchesLayout('/about', '/aboutus'));
});

test('BUGFIX: dynamic layouts match concrete paths', () => {
    assert.ok(rm.matchesLayout('/blog/[slug]', '/blog/hello'));
    assert.ok(rm.matchesLayout('/blog/[slug]', '/blog/hello/deeper'));
    assert.ok(!rm.matchesLayout('/blog/[slug]', '/news/hello'));
});

test('collectLayouts orders outermost first', () => {
    const layouts = [
        { path: '/blog', module: 'blog' },
        { path: '/', module: 'root' },
        { path: '/about', module: 'about' },
    ];
    const chain = rm.collectLayouts(layouts, '/blog/post');
    assert.deepEqual(chain.map(l => l.module), ['root', 'blog']);
});

test('collectLayouts includes dynamic layout for concrete path', () => {
    const layouts = [
        { path: '/', module: 'root' },
        { path: '/blog/[slug]', module: 'slug' },
    ];
    const chain = rm.collectLayouts(layouts, '/blog/hello');
    assert.deepEqual(chain.map(l => l.module), ['root', 'slug']);
});
