// ============================================================
//  NextResponse — a small, Next.js App Router-compatible response
//  object used inside api/** route handlers (server-side, Node).
//
//    return NextResponse.json({ ok: true });
//    return NextResponse.json({ error: 'nope' }, { status: 400 });
//    return NextResponse.redirect('/login');
//    const res = NextResponse.json({ ok: true });
//    res.cookies.set('token', 'abc', { httpOnly: true });
//    return res;
// ============================================================

class ResponseCookies {
    constructor(headers) {
        this.headers = headers;
    }

    set(name, value, options = {}) {
        let cookie = `${name}=${encodeURIComponent(value)}`;

        if (options.maxAge != null) cookie += `; Max-Age=${Math.floor(options.maxAge)}`;
        if (options.expires) cookie += `; Expires=${new Date(options.expires).toUTCString()}`;
        cookie += `; Path=${options.path || '/'}`;
        if (options.domain) cookie += `; Domain=${options.domain}`;
        if (options.httpOnly) cookie += '; HttpOnly';
        if (options.secure) cookie += '; Secure';
        if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;

        const existing = this.headers.get('Set-Cookie');
        if (!existing) this.headers.set('Set-Cookie', [cookie]);
        else if (Array.isArray(existing)) existing.push(cookie);
        else this.headers.set('Set-Cookie', [existing, cookie]);

        return this;
    }

    delete(name, options = {}) {
        return this.set(name, '', { ...options, maxAge: 0 });
    }

    get(name) {
        const existing = this.headers.get('Set-Cookie');
        const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
        for (const cookie of list) {
            if (cookie.startsWith(`${name}=`)) {
                return { name, value: cookie.slice(name.length + 1).split(';')[0] };
            }
        }
        return undefined;
    }
}

class NextResponse {
    constructor(body = null, init = {}) {
        this.body = body;
        this.status = init.status || 200;
        this.statusText = init.statusText || '';
        this.headers = new Map();

        const headers = init.headers || {};
        if (headers instanceof Map) {
            for (const [k, v] of headers) this.headers.set(k, v);
        } else if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
            headers.forEach((v, k) => this.headers.set(k, v)); // Headers instance
        } else if (typeof headers === 'object') {
            for (const k of Object.keys(headers)) this.headers.set(k, headers[k]);
        }

        this.cookies = new ResponseCookies(this.headers);
    }

    get ok() {
        return this.status >= 200 && this.status < 300;
    }

    static json(data, init = {}) {
        return new NextResponse(JSON.stringify(data), {
            ...init,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                ...(init.headers || {}),
            },
        });
    }

    static text(text, init = {}) {
        return new NextResponse(String(text), {
            ...init,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                ...(init.headers || {}),
            },
        });
    }

    static html(html, init = {}) {
        return new NextResponse(String(html), {
            ...init,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                ...(init.headers || {}),
            },
        });
    }

    static redirect(url, init = {}) {
        const destination = typeof url === 'string' ? url : String(url);
        return new NextResponse(null, {
            ...init,
            status: init.status || 307,
            headers: { 'Location': destination, ...(init.headers || {}) },
        });
    }

    // "Continue to the next handler." The dev server reads .rewrite from the
    // result; .continue signals an explicit pass-through.
    static next(init = {}) {
        const res = new NextResponse(null, { ...init, status: 200 });
        res.continue = true;
        return res;
    }

    static rewrite(url, init = {}) {
        const destination = typeof url === 'string' ? url : String(url);
        const res = new NextResponse(null, { ...init, status: 200 });
        res.rewrite = destination;
        return res;
    }

    static error() {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    async json() {
        return JSON.parse(this.body ?? 'null');
    }

    async text() {
        return this.body == null ? '' : String(this.body);
    }
}

module.exports = { NextResponse };
