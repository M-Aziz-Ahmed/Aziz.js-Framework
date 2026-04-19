/** @jsx h */
import { h } from '/_framework/runtime.js';

// About page — route: /about
export default function Page() {
    return (
        <div style={{ padding: '40px 32px', maxWidth: '900px', margin: '0 auto' }}>
            <h1>About 📖</h1>

            <div class="card">
                <h2>What is Aziz.js?</h2>
                <p>
                    A lightweight Next.js clone — file-based routing, React hooks,
                    server-side API routes, and ES module imports. Zero dependencies.
                </p>
            </div>

            <div class="card">
                <h2>File Structure</h2>
                <pre style={{ background: '#282c34', color: '#61dafb', padding: '16px', borderRadius: '8px', fontSize: '13px' }}>
{`app/
  layout.js       ← root layout
  page.js         ← /
  about/
    page.js       ← /about
  blog/
    [slug]/
      page.js     ← /blog/:slug

api/
  users.js        ← /api/users

components/
  Navbar.js
  Footer.js`}
                </pre>
            </div>

            <button class="btn btn-primary" onClick={() => navigate('/')}>
                ← Back Home
            </button>
        </div>
    );
}
