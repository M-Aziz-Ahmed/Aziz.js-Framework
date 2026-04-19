// NextResponse — identical to Next.js App Router API
// Used in api/ route handlers

class NextResponse {
    constructor(body, init = {}) {
        this.body = body;
        this.status = init.status || 200;
        this.headers = new Map(Object.entries(init.headers || {}));
    }

    static json(data, init = {}) {
        return new NextResponse(JSON.stringify(data), {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                ...(init.headers || {})
            }
        });
    }

    static text(text, init = {}) {
        return new NextResponse(text, {
            ...init,
            headers: {
                'Content-Type': 'text/plain',
                ...(init.headers || {})
            }
        });
    }

    static redirect(url, init = {}) {
        return new NextResponse(null, {
            ...init,
            status: init.status || 307,
            headers: {
                'Location': url,
                ...(init.headers || {})
            }
        });
    }

    static error() {
        return new NextResponse(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

module.exports = { NextResponse };
