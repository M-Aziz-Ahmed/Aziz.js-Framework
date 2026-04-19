// API Route: /api/users
// Next.js App Router style

const { NextResponse } = require('../_framework/next-response');

let users = [
    { id: 1, name: 'Aziz Ahmed', email: 'aziz@example.com', createdAt: new Date().toISOString() },
    { id: 2, name: 'John Doe', email: 'john@example.com', createdAt: new Date().toISOString() },
    { id: 3, name: 'Jane Smith', email: 'jane@example.com', createdAt: new Date().toISOString() }
];

async function GET(request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
        const user = users.find(u => u.id === parseInt(id));
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
        return NextResponse.json(user);
    }

    return NextResponse.json({ users, total: users.length });
}

async function POST(request) {
    const { name, email } = await request.json();

    if (!name || !email) {
        return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }

    if (users.find(u => u.email === email)) {
        return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    }

    const newUser = {
        id: Math.max(...users.map(u => u.id)) + 1,
        name, email,
        createdAt: new Date().toISOString()
    };
    users.push(newUser);

    return NextResponse.json({ message: 'User created', user: newUser }, { status: 201 });
}

async function DELETE(request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const idx = users.findIndex(u => u.id === parseInt(id));
    if (idx === -1) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const deleted = users.splice(idx, 1)[0];
    return NextResponse.json({ message: 'User deleted', user: deleted });
}

module.exports = { GET, POST, DELETE };
