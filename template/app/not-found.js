// Custom 404 page — rendered when no route matches (like Next.js app/not-found.js)
export default function NotFound() {
    return (
        <div style={{ padding: '80px 24px', textAlign: 'center' }}>
            <h1 style={{ fontSize: '96px', margin: '0 0 8px', color: '#61dafb' }}>404</h1>
            <h2 style={{ margin: '0 0 16px' }}>Page not found</h2>
            <p style={{ color: '#888', marginBottom: '32px' }}>
                We couldn't find the page you were looking for.
            </p>
            <button class="btn btn-primary" onClick={() => navigate('/')}>
                ← Back to Home
            </button>
        </div>
    );
}
