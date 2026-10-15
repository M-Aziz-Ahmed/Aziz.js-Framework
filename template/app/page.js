// Home page — route: /
export default function Page() {
    const [count, setCount] = useState(0);

    return (
        <div style={{ padding: '40px 32px', maxWidth: '900px', margin: '0 auto' }}>
            <h1>Welcome to Aziz.js</h1>

            <div class="card">
                <h2>Counter</h2>
                <p>useState works exactly like React!</p>
                <div class="count-display">{count}</div>
                <div class="counter-actions">
                    <button class="btn btn-danger"  onClick={() => setCount(c => c - 1)}>−</button>
                    <button class="btn btn-primary" onClick={() => setCount(c => c + 1)}>+</button>
                    <button class="btn btn-grey"    onClick={() => setCount(0)}>Reset</button>
                </div>
            </div>

            <div class="card">
                <h2>File-based Routing</h2>
                <p>
                    Each <code>page.js</code> inside <code>app/</code> is a route — just like Next.js.
                    Create <code>app/about/page.js</code> and it becomes <code>/about</code>.
                </p>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <button class="btn btn-primary" onClick={() => navigate('/about')}>
                        Go to About →
                    </button>
                    <button class="btn btn-primary" onClick={() => navigate('/blog/hello-world')}>
                        Blog Post →
                    </button>
                    <button class="btn btn-primary" onClick={() => navigate('/contact')}>
                        Contact →
                    </button>
                    <button class="btn btn-primary" onClick={() => navigate('/test')}>
                        Go to Test →
                    </button>
                </div>
            </div>

            <div class="card">
                <h2>Import Anything</h2>
                <p>
                    Use <code>import</code> statements just like Next.js.
                    The dev server resolves bare imports from <code>node_modules</code> automatically.
                </p>
                <pre style={{ background: '#282c34', color: '#61dafb', padding: '16px', borderRadius: '8px', overflow: 'auto', fontSize: '13px' }}>
{`import mongoose from 'mongoose';
import connectDB from '@/lib/db';
import User from '@/models/User';`}
                </pre>
            </div>
        </div>
    );
}
