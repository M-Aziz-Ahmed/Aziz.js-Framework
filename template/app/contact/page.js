// Contact page — route: /contact
// Demonstrates the global `api` client calling a server route handler.
export default function ContactPage() {
    const [name, setName]     = useState('');
    const [email, setEmail]   = useState('');
    const [message, setMessage] = useState('');
    const [status, setStatus] = useState(null); // { type, text }
    const [sending, setSending] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSending(true);
        setStatus(null);
        try {
            const res = await api.post('/api/contact', { name, email, message });
            setStatus({ type: 'ok', text: res.message || 'Message sent!' });
            setName(''); setEmail(''); setMessage('');
        } catch (err) {
            setStatus({ type: 'error', text: err.message || 'Something went wrong' });
        } finally {
            setSending(false);
        }
    };

    return (
        <div style={{ padding: '40px 32px', maxWidth: '640px', margin: '0 auto' }}>
            <h1>Contact 📬</h1>

            <div class="card">
                <h2>Send us a message</h2>
                <p>This form posts to <code>/api/contact</code> using the global <code>api</code> client.</p>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                    <input
                        type="text"
                        placeholder="Your name"
                        value={name}
                        onInput={(e) => setName(e.target.value)}
                        required
                    />
                    <input
                        type="email"
                        placeholder="Your email"
                        value={email}
                        onInput={(e) => setEmail(e.target.value)}
                        required
                    />
                    <textarea
                        placeholder="Your message"
                        value={message}
                        onInput={(e) => setMessage(e.target.value)}
                        rows={4}
                        required
                    />
                    <button type="submit" class="btn btn-primary" disabled={sending}>
                        {sending ? 'Sending…' : 'Send message'}
                    </button>
                </form>

                {status && (
                    <p style={{ marginTop: '12px', color: status.type === 'ok' ? '#1a7f37' : '#c0392b' }}>
                        {status.text}
                    </p>
                )}
            </div>
        </div>
    );
}
