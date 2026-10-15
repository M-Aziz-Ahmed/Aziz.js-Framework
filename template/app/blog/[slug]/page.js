// Blog post page — route: /blog/:slug  (dynamic segment)
export default function BlogPost() {
    const { slug } = useParams();
    const search = useSearchParams();
    const from = search.get('from');

    return (
        <div style={{ padding: '40px 32px', maxWidth: '900px', margin: '0 auto' }}>
            <p style={{ color: '#888', marginBottom: '8px' }}>
                <a href="/blog/hello-world" onClick={(e) => { e.preventDefault(); navigate('/blog/hello-world'); }}>hello-world</a>
                {'  ·  '}
                <a href="/blog/aziz-js" onClick={(e) => { e.preventDefault(); navigate('/blog/aziz-js'); }}>aziz-js</a>
            </p>

            <h1>Blog: {slug}</h1>

            <div class="card">
                <h2>Dynamic routing works!</h2>
                <p>
                    This page is <code>app/blog/[slug]/page.js</code> and it matches any
                    <code>/blog/&lt;anything&gt;</code> URL. The matched value is available
                    through the <code>useParams()</code> hook.
                </p>
                <p><strong>useParams().slug</strong> = <code>{slug}</code></p>
                {from && <p><strong>?from=</strong> = <code>{from}</code></p>}
            </div>

            <button class="btn btn-primary" onClick={() => navigate('/')}>← Back Home</button>
        </div>
    );
}
