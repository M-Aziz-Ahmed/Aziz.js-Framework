// Root layout — wraps every page (like Next.js app/layout.js)
export default function Layout({ children }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <main style={{ flex: 1 }}>
                {children}
            </main>
            <footer>
                Built with Aziz.js
            </footer>
        </div>
    );
}

export const metadata = {
    title: 'My App',
    description: 'Built with Aziz.js'
};
