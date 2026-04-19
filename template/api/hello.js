// API Route: /api/hello
// Next.js App Router style

const { NextResponse } = require('../_framework/next-response');

async function GET(request) {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name') || 'World';
    
    return NextResponse.json({
        message: `Hello, ${name}!`,
        timestamp: new Date().toISOString(),
        method: request.method
    });
}

module.exports = { GET };
