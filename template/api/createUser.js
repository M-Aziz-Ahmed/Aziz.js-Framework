// API Route: /api/createUser
// Next.js App Router style

const { NextResponse } = require('../_framework/next-response');

// Mock database
let users = [
    { _id: '1', name: 'Aziz Ahmed', email: 'aziz@example.com', role: 'admin', phone: '123-456-7890' }
];

// POST handler
async function POST(request) {
    try {
        // Parse request body
        const body = await request.json();
        const { name, email, password, role, phone } = body;

        // Validation
        if (!name || !email || !password) {
            return NextResponse.json(
                { 
                    error: 'Validation failed',
                    message: 'Name, email, and password are required'
                },
                { status: 400 }
            );
        }

        // Check if email already exists
        if (users.find(u => u.email === email)) {
            return NextResponse.json(
                { error: 'User with this email already exists' },
                { status: 409 }
            );
        }

        // Create new user
        const newUser = {
            _id: String(users.length + 1),
            name,
            email,
            password, // In production, hash this with bcrypt!
            role: role || 'user',
            phone: phone || '',
            createdAt: new Date().toISOString()
        };

        users.push(newUser);

        // Return user data (without password)
        const { password: _, ...userData } = newUser;

        return NextResponse.json(
            {
                message: 'User created successfully',
                user: userData
            },
            { status: 201 }
        );
    } catch (error) {
        console.error('Create user error:', error);
        return NextResponse.json(
            { error: 'Failed to create user' },
            { status: 500 }
        );
    }
}

module.exports = { POST };
