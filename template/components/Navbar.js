/** @jsx h */
import { h } from '/_framework/runtime.js';

// navigate and useRouter are globals set by boot.js
export default function Navbar() {
    const { pathname } = useRouter();

    const links = [
        { href: '/',         label: 'Home'     },
        { href: '/about',    label: 'About'    },
        { href: '/test',     label: 'Test'     },
        { href: '/contact',  label: 'Contact'  },
    ];

    return (
        <nav>
            <span class="brand" onClick={() => navigate('/')}>⚡ Aziz.js</span>
            {links.map(({ href, label }) =>
                <a
                    href={href}
                    class={pathname === href ? 'active' : ''}
                    onClick={(e) => { e.preventDefault(); navigate(href); }}
                >
                    {label}
                </a>
            )}
        </nav>
    );
}
