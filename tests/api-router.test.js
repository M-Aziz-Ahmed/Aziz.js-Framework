const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ar = require('../template/scripts/lib/api-router.js');
const { NextResponse } = require('../template/_framework/next-response.js');

const FIXTURES = path.join(__dirname, 'fixtures');

// ─── pattern matching ────────────────────────────────────────

test('matches static API routes', () => {
    assert.deepEqual(ar.matchApiPattern('/api/users', '/api/users'), {});
    assert.equal(ar.matchApiPattern('/api/users', '/api/posts'), null);
});

test('matches dynamic and catch-all API routes', () => {
    assert.deepEqual(ar.matchApiPattern('/api/users/[id]', '/api/users/42'), { id: '42' });
    assert.deepEqual(ar.matchApiPattern('/api/files/[...path]', '/api/files/a/b'), { path: ['a', 'b'] });
    assert.equal(ar.matchApiPattern('/api/files/[...path]', '/api/files'), null);
});

test('BUGFIX: catch-all API route validates its literal prefix', () => {
    assert.equal(ar.matchApiPattern('/api/files/[...path]', '/api/other/x'), null);
});

test('specificity sort puts static before dynamic before catch-all', () => {
    const routes = [
        { pattern: '/api/[...all]', ...ar.patternScore('/api/[...all]') },
        { pattern: '/api/users/[id]', ...ar.patternScore('/api/users/[id]') },
        { pattern: '/api/users/me', ...ar.patternScore('/api/users/me') },
    ].sort(ar.compareSpecificity);

    assert.equal(routes[0].pattern, '/api/users/me');
    assert.equal(routes[1].pattern, '/api/users/[id]');
    assert.equal(routes[2].pattern, '/api/[...all]');
});

// ─── module loading + normalization ──────────────────────────

test('normalizeHandlers handles CJS named exports', () => {
    const { methods, legacy } = ar.normalizeHandlers({ GET: () => {}, POST: () => {} });
    assert.deepEqual(Object.keys(methods).sort(), ['GET', 'POST']);
    assert.equal(legacy, null);
});

test('normalizeHandlers handles ESM namespace objects', () => {
    const { methods } = ar.normalizeHandlers({ GET: () => {}, default: {} });
    assert.ok(methods.GET);
});

test('normalizeHandlers handles a legacy function', () => {
    const fn = () => {};
    const { methods, legacy } = ar.normalizeHandlers(fn);
    assert.equal(Object.keys(methods).length, 0);
    assert.equal(legacy, fn);
});

test('loadApiRoutes discovers api/ and app/api/ routes (incl. dynamic + .mjs)', async () => {
    const { routes } = await ar.loadApiRoutes(FIXTURES, { verbose: false });
    const patterns = routes.map(r => r.pattern).sort();

    assert.ok(patterns.includes('/api/hello'));
    assert.ok(patterns.includes('/api/users/[id]'));
    assert.ok(patterns.includes('/api/files/[...path]'));
    assert.ok(patterns.includes('/api/legacy'));
    assert.ok(patterns.includes('/api/esm'));
    assert.ok(patterns.includes('/api/health'));

    const esm = routes.find(r => r.pattern === '/api/esm');
    assert.ok(esm.methods.GET, '.mjs module should expose GET');
});

test('findApiRoute resolves params', async () => {
    const { routes } = await ar.loadApiRoutes(FIXTURES, { verbose: false });
    const match = ar.findApiRoute(routes, '/api/users/7');
    assert.ok(match);
    assert.deepEqual(match.params, { id: '7' });
});

// ─── request building ────────────────────────────────────────

test('buildRequest exposes params, query and cookies', async () => {
    const req = {
        url: '/api/users/7?expand=posts',
        method: 'GET',
        headers: { cookie: 'token=abc; theme=dark' },
    };
    const request = ar.buildRequest(req, { id: '7' }, '', 3000);
    assert.deepEqual(request.params, { id: '7' });
    assert.equal(request.query.get('expand'), 'posts');
    assert.deepEqual(request.cookies, { token: 'abc', theme: 'dark' });
});

test('request.json() throws a 400 SyntaxError on invalid JSON', async () => {
    const request = ar.buildRequest({ url: '/api/x', method: 'POST', headers: {} }, {}, '{bad', 3000);
    await assert.rejects(() => request.json(), (err) => {
        assert.equal(err.status, 400);
        return true;
    });
});

test('request.json() parses valid JSON body', async () => {
    const request = ar.buildRequest(
        { url: '/api/x', method: 'POST', headers: { 'content-type': 'application/json' } },
        {}, '{"a":1}', 3000
    );
    assert.deepEqual(await request.json(), { a: 1 });
});

// ─── response sending ────────────────────────────────────────

function mockRes() {
    return {
        statusCode: 0,
        headers: null,
        body: undefined,
        writableEnded: false,
        writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
        end(body) { this.writableEnded = true; this.body = body; },
    };
}

test('plain object result is JSON-stringified with 200', () => {
    const res = mockRes();
    ar.sendHandlerResult({ ok: true }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, JSON.stringify({ ok: true }));
    assert.match(res.headers['Content-Type'], /application\/json/);
});

test('NextResponse result preserves status and headers', () => {
    const res = mockRes();
    ar.sendHandlerResult(NextResponse.json({ error: 'nope' }, { status: 400 }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body, JSON.stringify({ error: 'nope' }));
});

test('undefined result yields a 500 with a helpful hint', () => {
    const res = mockRes();
    ar.sendHandlerResult(undefined, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body, /returned no response/);
});

test('string result is sent as text/plain', () => {
    const res = mockRes();
    ar.sendHandlerResult('hello', res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /text\/plain/);
    assert.equal(res.body, 'hello');
});

test('headOnly suppresses the body', () => {
    const res = mockRes();
    ar.sendHandlerResult({ ok: true }, res, { headOnly: true });
    assert.equal(res.body, undefined);
});

// ─── next-response ───────────────────────────────────────────

test('NextResponse.json / text / html / redirect', () => {
    assert.equal(NextResponse.json({ a: 1 }).body, '{"a":1}');
    assert.equal(NextResponse.text('hi').body, 'hi');
    assert.equal(NextResponse.html('<b>x</b>').headers.get('Content-Type'), 'text/html; charset=utf-8');
    const redirect = NextResponse.redirect('/login');
    assert.equal(redirect.status, 307);
    assert.equal(redirect.headers.get('Location'), '/login');
});

test('NextResponse.cookies.set appends Set-Cookie headers', () => {
    const res = NextResponse.json({ ok: true });
    res.cookies.set('a', '1', { httpOnly: true });
    res.cookies.set('b', '2');
    const cookies = res.headers.get('Set-Cookie');
    assert.equal(cookies.length, 2);
    assert.match(cookies[0], /a=1; Path=\/; HttpOnly/);
    assert.match(cookies[1], /b=2/);
});

test('NextResponse.ok reflects status', () => {
    assert.ok(NextResponse.json({}).ok);
    assert.ok(!NextResponse.json({}, { status: 404 }).ok);
});
