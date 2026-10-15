// API Route: POST /api/contact  (classic style — api/contact.js)
//
// Demonstrates validation, cookies, and NextResponse helpers.

const { NextResponse } = require('../_framework/next-response');

// In-memory store (replace with a real database in production)
const messages = [];

async function GET(request) {
    return NextResponse.json({ count: messages.length, messages });
}

async function POST(request) {
    let body;
    try {
        body = await request.json();
    } catch (err) {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: err.status || 400 });
    }

    const { name, email, message } = body;

    if (!name || !email || !message) {
        return NextResponse.json(
            { error: 'name, email and message are required' },
            { status: 400 }
        );
    }

    const entry = { name, email, message, at: new Date().toISOString() };
    messages.push(entry);

    const res = NextResponse.json({ message: `Thanks, ${name}! We received your message.`, entry }, { status: 201 });
    res.cookies.set('last_contact', name, { path: '/', maxAge: 60 * 60 });
    return res;
}

module.exports = { GET, POST };
