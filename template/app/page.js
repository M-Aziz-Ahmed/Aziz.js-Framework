// Home page — route: /
export default function Page() {
    const [count, setCount] = useState(0);

    return (
        <div style={{ padding: '48px 32px', maxWidth: '720px', margin: '0 auto' }}>
            <h1>Welcome to Aziz.js</h1>
            <p>
                Your app is running. Edit <code>app/page.js</code> and save —
                the browser refreshes automatically.
            </p>

            <div class="card">
                <h2>Interactive state</h2>
                <p>A tiny slice of state, exactly like React's <code>useState</code>.</p>
                <div class="count-display">{count}</div>
                <div class="counter-actions">
                    <button class="btn btn-danger"  onClick={() => setCount(c => c - 1)}>−</button>
                    <button class="btn btn-primary" onClick={() => setCount(c => c + 1)}>+</button>
                    <button class="btn btn-grey"    onClick={() => setCount(0)}>Reset</button>
                </div>
            </div>

            <div class="card">
                <h2>Add a page</h2>
                <p>
                    Each <code>page.js</code> inside <code>app/</code> is a route.
                    Create <code>app/about/page.js</code> and it becomes <code>/about</code>.
                </p>
            </div>
        </div>
    );
}
