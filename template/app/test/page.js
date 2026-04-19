/** @jsx h */
import { h } from '/_framework/runtime.js';

// Test page — route: /test
export default function Page() {
    const [count, setCount]   = useState(0);
    const [name, setName]     = useState('');
    const [email, setEmail]   = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        alert(`Name: ${name}\nEmail: ${email}\nCount: ${count}`);
    };

    return (
        <div style={{ padding: '40px 32px', maxWidth: '900px', margin: '0 auto' }}>
            <h1>Test Page 🧪</h1>

            <div class="card">
                <h2>useState</h2>
                <div class="count-display">{count}</div>
                <div class="counter-actions">
                    <button class="btn btn-primary" onClick={() => setCount(c => c + 1)}>+</button>
                    <button class="btn btn-danger"  onClick={() => setCount(0)}>Reset</button>
                </div>
            </div>

            <div class="card">
                <h2>Form</h2>
                <form onSubmit={handleSubmit}>
                    <input
                        type="text"
                        value={name}
                        onInput={(e) => setName(e.target.value)}
                        placeholder="Your name"
                    />
                    <input
                        type="email"
                        value={email}
                        onInput={(e) => setEmail(e.target.value)}
                        placeholder="Your email"
                    />
                    <button type="submit" class="btn btn-primary">Submit</button>
                </form>
            </div>

            <div class="card">
                <h2>State</h2>
                <p>Name: <strong>{name || '—'}</strong></p>
                <p>Email: <strong>{email || '—'}</strong></p>
                <p>Count: <strong>{count}</strong></p>
            </div>
        </div>
    );
}
