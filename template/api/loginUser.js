// API Route: /api/loginUser
// Next.js App Router style

const { NextResponse } = require('../_framework/next-response');

// Mock database
const users = [
    { _id: '1', name: 'Aziz Ahmed', email: 'aziz@example.com', password: 'admin123', role: 'admin' },
    { _id: '2', name: 'John Doe', email: 'john@example.com', password: 'user123', role: 'user' }
];

// POST handler
async function POST(request) {
    try {
        // Parse request body
        const body = await request.json();
        const { email, password } = body;

        // Validation
        if (!email || !password) {
            return NextResponse.json(
                { error: 'Email and password are required' },
                { status: 400 }
            );
        }

        // Find user
        const user = users.find(u => u.email === email);
        
        if (!user) {
            return NextResponse.json(
                { error: 'Invalid credentials' },
                { status: 401 }
            );
        }

        // Check password (in production, use bcrypt!)
        if (user.password !== password) {
            return NextResponse.json(
                { error: 'Invalid credentials' },
                { status: 401 }
            );
        }

        // Return user data (without password)
        const { password: _, ...userData } = user;
        
        return NextResponse.json({
            ...userData,
            message: 'Login successful'
        });
    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json(
            { error: 'Failed to login' },
            { status: 500 }
        );
    }
}

module.exports = { POST };
