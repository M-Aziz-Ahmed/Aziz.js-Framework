const test = require('node:test');
const assert = require('node:assert');
const { loadFramework } = require('./helpers/esm.js');

let api, ApiError;

test.before(async () => {
    const mod = (await loadFramework(['api.js'])).api;
    api = mod.api;
    ApiError = mod.ApiError;
    api.configure({ baseURL: '', timeout: 15000, retries: 0, headers: {} });
});

function jsonResponse(status, data) {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get: () => 'application/json' },
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

test('GET parses JSON and strips nothing', async () => {
    globalThis.fetch = async (url, opts) => {
        assert.equal(url, '/api/users');
        assert.equal(opts.method, 'GET');
        return jsonResponse(200, { users: [1, 2] });
    };
    const data = await api.get('/api/users');
    assert.deepEqual(data, { users: [1, 2] });
});

test('POST JSON-encodes body and sets Content-Type', async () => {
    globalThis.fetch = async (url, opts) => {
        assert.equal(opts.method, 'POST');
        assert.equal(opts.headers['Content-Type'], 'application/json');
        assert.equal(opts.body, JSON.stringify({ name: 'Aziz' }));
        return jsonResponse(201, { ok: true });
    };
    const data = await api.post('/api/users', { name: 'Aziz' });
    assert.equal(data.ok, true);
});

test('query object is serialized (arrays too)', async () => {
    globalThis.fetch = async (url) => {
        assert.ok(url.startsWith('/api/search?'));
        assert.ok(url.includes('q=hello'));
        assert.ok(url.includes('tag=a'));
        assert.ok(url.includes('tag=b'));
        return jsonResponse(200, {});
    };
    await api.get('/api/search', { query: { q: 'hello', tag: ['a', 'b'], skip: undefined } });
});

test('baseURL is prepended', async () => {
    api.setBaseURL('https://example.com');
    globalThis.fetch = async (url) => {
        assert.equal(url, 'https://example.com/api/x');
        return jsonResponse(200, {});
    };
    await api.get('/api/x');
    api.setBaseURL('');
});

test('4xx throws ApiError with status and does NOT retry', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return jsonResponse(400, { error: 'Bad input' }); };
    await assert.rejects(
        () => api.get('/api/x', { retries: 3 }),
        (err) => {
            assert.ok(err instanceof ApiError);
            assert.equal(err.status, 400);
            assert.equal(err.message, 'Bad input');
            return true;
        }
    );
    assert.equal(calls, 1);
});

test('5xx retries and finally throws', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return jsonResponse(500, { error: 'boom' }); };
    await assert.rejects(() => api.get('/api/x', { retries: 1 }), (err) => err.status === 500);
    assert.equal(calls, 2);
});

test('timeout aborts and throws ApiError', async () => {
    globalThis.fetch = (url, opts) => new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
        });
    });
    await assert.rejects(
        () => api.get('/api/slow', { timeout: 20 }),
        (err) => {
            assert.ok(err instanceof ApiError);
            assert.equal(err.status, 0);
            assert.match(err.message, /timed out/);
            return true;
        }
    );
});

test('network error is wrapped in ApiError', async () => {
    globalThis.fetch = async () => { throw new Error('Failed to fetch'); };
    await assert.rejects(() => api.get('/api/x'), (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 0);
        return true;
    });
});

test('204 returns null', async () => {
    globalThis.fetch = async () => ({
        status: 204, ok: true, headers: { get: () => '' }, json: async () => null, text: async () => '',
    });
    assert.equal(await api.delete('/api/x'), null);
});

test('raw returns the Response object', async () => {
    const fake = jsonResponse(200, { ok: 1 });
    globalThis.fetch = async () => fake;
    const res = await api.raw('/api/x');
    assert.equal(res, fake);
});
