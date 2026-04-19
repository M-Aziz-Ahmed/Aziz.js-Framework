import Navbar from '/components/Navbar.js';
import Footer from '/components/Footer.js';

// Root layout — wraps every page (like Next.js app/layout.js)
export default function Layout({ children }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <Navbar />
            <main style={{ flex: 1 }}>
                {children}
            </main>
            <Footer />
        </div>
    );
}

export const metadata = {
    title: 'My App',
    description: 'Built with Aziz.js'
};
