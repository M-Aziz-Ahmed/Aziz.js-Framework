#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Promisify question
function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

// Main function
async function main() {
    console.log(`\n⚡ Welcome to Aziz.js!\n`);
    console.log(`🎨 A lightweight Next.js clone — file-based routing, React hooks, API routes\n`);

    // Get project name
    let projectName = process.argv[2];
    if (!projectName) {
        projectName = await question('📁 Project name (my-aziz-js-app): ');
        projectName = projectName.trim() || 'my-aziz-js-app';
    }

    // Validate project name
    if (!/^[a-z0-9-_]+$/i.test(projectName)) {
        console.error(`❌ Invalid project name. Use only letters, numbers, hyphens, and underscores.`);
        rl.close();
        process.exit(1);
    }

    const targetDir = path.join(process.cwd(), projectName);

    // Check if directory exists
    if (fs.existsSync(targetDir)) {
        const overwrite = await question(`⚠️  Folder "${projectName}" already exists. Overwrite? (y/N): `);
        if (overwrite.toLowerCase() !== 'y' && overwrite.toLowerCase() !== 'yes') {
            console.log('❌ Cancelled.');
            rl.close();
            process.exit(0);
        }
        // Remove existing directory
        fs.rmSync(targetDir, { recursive: true, force: true });
    }

    // Ask for port
    let port = await question('🌐 Dev server port (3000): ');
    port = port.trim() || '3000';
    if (!/^\d+$/.test(port)) {
        console.log('⚠️  Invalid port, using default 3000');
        port = '3000';
    }

    // Ask for features
    console.log('\n✨ Features to include:');
    const includeExamples = await question('   Include example pages? (Y/n): ');
    const includeApiExamples = await question('   Include example API routes? (Y/n): ');
    const includeDocs = await question('   Include documentation? (Y/n): ');

    // Ask for CSS framework
    console.log('\n🎨 CSS Framework:');
    console.log('   1. None (custom CSS)');
    console.log('   2. Bootstrap 5');
    console.log('   3. Tailwind CSS');
    const cssChoice = await question('   Choose (1/2/3): ');
    
    let cssFramework = 'none';
    if (cssChoice === '2') cssFramework = 'bootstrap';
    else if (cssChoice === '3') cssFramework = 'tailwind';

    const features = {
        examples: includeExamples.toLowerCase() !== 'n' && includeExamples.toLowerCase() !== 'no',
        apiExamples: includeApiExamples.toLowerCase() !== 'n' && includeApiExamples.toLowerCase() !== 'no',
        docs: includeDocs.toLowerCase() !== 'n' && includeDocs.toLowerCase() !== 'no',
        cssFramework: cssFramework
    };

    console.log(`\n⚡ Creating "${projectName}"...\n`);

    const templateDir = path.join(__dirname, "../template");

    // Copy the template
    copyDir(templateDir, targetDir, features);

    // Update package.json with project name
    updatePackageJson(targetDir, projectName);

    // Update dev server port
    updateDevServerPort(targetDir, port);

    // Setup CSS framework
    setupCSSFramework(targetDir, features.cssFramework);

    console.log(`✅ Done! Your project is ready.\n`);
    console.log(`🎉 Welcome to Aziz.js\n`);
    console.log(`📁 Created project: ${projectName}\n`);
    console.log(`👉 Get started:\n`);
    console.log(`   cd ${projectName}`);
    console.log(`   npm install`);
    console.log(`   npm run dev\n`);
    console.log(`🌐 Dev server will run on: http://localhost:${port}/\n`);
    console.log(`📂 Project structure:\n`);
    console.log(`   app.html          ← Main HTML file`);
    console.log(`   modules/          ← Core system (router, state, API)`);
    console.log(`   pages/            ← Your pages (auto-imported)`);
    console.log(`   components/       ← Your components (auto-imported)`);
    console.log(`   api/              ← Your API routes (auto-imported)`);
    console.log(`   scripts/          ← Build tools`);
    if (features.docs) {
        console.log(`   docs/             ← Documentation`);
    }
    console.log(`\n✨ Features:\n`);
    console.log(`   • State Management    - useState() like React`);
    console.log(`   • File-based Routing  - pages/About.jsx → #/about`);
    console.log(`   • API Routes          - Next.js-like API system`);
    console.log(`   • Auto-Import         - No manual script tags!`);
    console.log(`   • Live Reload         - Instant browser refresh`);
    if (features.cssFramework === 'bootstrap') {
        console.log(`   • Bootstrap 5         - Responsive CSS framework`);
    } else if (features.cssFramework === 'tailwind') {
        console.log(`   • Tailwind CSS        - Utility-first CSS framework`);
    }
    console.log(`\n💡 Quick tips:\n`);
    console.log(`   • Create pages/MyPage.jsx → Auto-imported!`);
    console.log(`   • Create api/todos.js → Auto-imported!`);
    console.log(`   • Just save and browser refreshes automatically`);
    if (features.docs) {
        console.log(`   • Read docs/ folder for detailed guides`);
    }
    console.log(`\n🚀 Ready to build something awesome!\n`);

    rl.close();
}

// Helper to copy directory with filters
function copyDir(src, dest, features) {
    fs.mkdirSync(dest, { recursive: true });
    
    for (let file of fs.readdirSync(src)) {
        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);
        
        // Skip certain files based on features
        if (!features.docs && file === 'docs') continue;
        if (!features.examples && file === 'pages' && fs.statSync(srcPath).isDirectory()) {
            // Copy only essential pages
            fs.mkdirSync(destPath, { recursive: true });
            fs.copyFileSync(path.join(srcPath, 'Home.jsx'), path.join(destPath, 'Home.jsx'));
            continue;
        }
        if (!features.apiExamples && file === 'api' && fs.statSync(srcPath).isDirectory()) {
            // Skip API examples
            fs.mkdirSync(destPath, { recursive: true });
            continue;
        }
        
        if (fs.statSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath, features);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Update package.json with project name
function updatePackageJson(targetDir, projectName) {
    const packageJsonPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        packageJson.name = projectName;
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    }
}

// Update dev server port
function updateDevServerPort(targetDir, port) {
    const devServerPath = path.join(targetDir, 'scripts', 'dev-server.js');
    if (fs.existsSync(devServerPath)) {
        let content = fs.readFileSync(devServerPath, 'utf8');
        content = content.replace(
            'const PORT = process.env.PORT || 3000;',
            `const PORT = process.env.PORT || ${port};`
        );
        fs.writeFileSync(devServerPath, content);
    }
}

// Setup CSS framework
function setupCSSFramework(targetDir, framework) {
    const htmlPath = path.join(targetDir, 'app.html');
    if (!fs.existsSync(htmlPath)) return;
    
    let html = fs.readFileSync(htmlPath, 'utf8');
    
    // Ensure cache-control meta tags are present
    if (!html.includes('http-equiv="Cache-Control"')) {
        html = html.replace(
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
            `<meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">`
        );
    }
    
    if (framework === 'bootstrap') {
        // Replace globals.css with Bootstrap CDN
        html = html.replace(
            '<link rel="stylesheet" href="styles/globals.css">',
            `<!-- Bootstrap 5 CSS -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">`
        );
        
        // Ensure live reload script is present
        if (!html.includes('live-reload-client.js')) {
            html = html.replace(
                '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>',
                `<!-- Live Reload (only active in development) -->
    <script src="scripts/live-reload-client.js"></script>

    <!-- Babel compiles JSX in the browser -->
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>`
            );
        }
        
        // Add Bootstrap JS before closing body tag
        const bootstrapJS = `
    <!-- Bootstrap 5 JS -->
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>

`;
        html = html.replace('</body>', bootstrapJS + '</body>');
        
        // Update components
        updateComponentsForBootstrap(targetDir);
        
    } else if (framework === 'tailwind') {
        // Replace globals.css with Tailwind CSS
        html = html.replace(
            '<link rel="stylesheet" href="styles/globals.css">',
            `<!-- Tailwind CSS -->
    <link rel="stylesheet" href="styles/tailwind.css">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        primary: '#61dafb',
                        dark: '#282c34'
                    }
                }
            }
        }
    </script>`
        );
        
        // Ensure live reload script is present
        if (!html.includes('live-reload-client.js')) {
            html = html.replace(
                '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>',
                `<!-- Live Reload (only active in development) -->
    <script src="scripts/live-reload-client.js"></script>

    <!-- Babel compiles JSX in the browser -->
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>`
            );
        }
        
        // Update components
        updateComponentsForTailwind(targetDir);
    } else {
        // For 'none', ensure live reload script is present
        if (!html.includes('live-reload-client.js')) {
            html = html.replace(
                '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>',
                `<!-- Live Reload (only active in development) -->
    <script src="scripts/live-reload-client.js"></script>

    <!-- Babel compiles JSX in the browser -->
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>`
            );
        }
    }
    // If 'none', keep globals.css as is
    
    fs.writeFileSync(htmlPath, html);
}

// Update components for Bootstrap
function updateComponentsForBootstrap(targetDir) {
    // Update Navbar
    const navbarPath = path.join(targetDir, 'components', 'Navbar.jsx');
    if (fs.existsSync(navbarPath)) {
        const navbarContent = `/** @jsx h */

function Navbar() {
    const path = getCurrentPath();

    return (
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
            <div class="container-fluid">
                <span class="navbar-brand" onClick={() => navigate("home")} style={{ cursor: 'pointer' }}>
                    ⚡ Aziz.js
                </span>
                <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
                    <span class="navbar-toggler-icon"></span>
                </button>
                <div class="collapse navbar-collapse" id="navbarNav">
                    <ul class="navbar-nav">
                        <li class="nav-item">
                            <a href="#/home" class={\`nav-link \${path === "home" ? "active" : ""}\`}>Home</a>
                        </li>
                        <li class="nav-item">
                            <a href="#/about" class={\`nav-link \${path === "about" ? "active" : ""}\`}>About</a>
                        </li>
                        <li class="nav-item">
                            <a href="#/contact" class={\`nav-link \${path === "contact" ? "active" : ""}\`}>Contact</a>
                        </li>
                        <li class="nav-item">
                            <a href="#/test" class={\`nav-link \${path === "test" ? "active" : ""}\`}>Test</a>
                        </li>
                        <li class="nav-item">
                            <a href="#/api-demo" class={\`nav-link \${path === "api-demo" ? "active" : ""}\`}>API Demo</a>
                        </li>
                    </ul>
                </div>
            </div>
        </nav>
    );
}
`;
        fs.writeFileSync(navbarPath, navbarContent);
    }
    
    // Update Footer
    const footerPath = path.join(targetDir, 'components', 'Footer.jsx');
    if (fs.existsSync(footerPath)) {
        const footerContent = `/** @jsx h */

function Footer() {
    return (
        <footer class="bg-dark text-light text-center py-3 mt-auto">
            <div class="container">
                <p class="mb-0">Made with ⚡ Aziz.js</p>
            </div>
        </footer>
    );
}
`;
        fs.writeFileSync(footerPath, footerContent);
    }
    
    // Update all pages
    updatePagesForBootstrap(targetDir);
    
    // Update 404 page
    update404ForBootstrap(targetDir);
}

// Update components for Tailwind
function updateComponentsForTailwind(targetDir) {
    // Update Navbar
    const navbarPath = path.join(targetDir, 'components', 'Navbar.jsx');
    if (fs.existsSync(navbarPath)) {
        const navbarContent = `/** @jsx h */

function Navbar() {
    const path = getCurrentPath();

    return (
        <nav class="bg-dark shadow-lg">
            <div class="container mx-auto px-4">
                <div class="flex items-center justify-between h-16">
                    <span 
                        class="text-primary text-xl font-bold cursor-pointer hover:text-blue-300 transition"
                        onClick={() => navigate("home")}
                    >
                        ⚡ Aziz.js
                    </span>
                    <div class="flex space-x-4">
                        <a href="#/home" class={\`px-3 py-2 rounded-md text-sm font-medium transition \${path === "home" ? "bg-primary text-dark" : "text-gray-300 hover:bg-gray-700 hover:text-white"}\`}>
                            Home
                        </a>
                        <a href="#/about" class={\`px-3 py-2 rounded-md text-sm font-medium transition \${path === "about" ? "bg-primary text-dark" : "text-gray-300 hover:bg-gray-700 hover:text-white"}\`}>
                            About
                        </a>
                        <a href="#/contact" class={\`px-3 py-2 rounded-md text-sm font-medium transition \${path === "contact" ? "bg-primary text-dark" : "text-gray-300 hover:bg-gray-700 hover:text-white"}\`}>
                            Contact
                        </a>
                        <a href="#/test" class={\`px-3 py-2 rounded-md text-sm font-medium transition \${path === "test" ? "bg-primary text-dark" : "text-gray-300 hover:bg-gray-700 hover:text-white"}\`}>
                            Test
                        </a>
                        <a href="#/api-demo" class={\`px-3 py-2 rounded-md text-sm font-medium transition \${path === "api-demo" ? "bg-primary text-dark" : "text-gray-300 hover:bg-gray-700 hover:text-white"}\`}>
                            API Demo
                        </a>
                    </div>
                </div>
            </div>
        </nav>
    );
}
`;
        fs.writeFileSync(navbarPath, navbarContent);
    }
    
    // Update Footer
    const footerPath = path.join(targetDir, 'components', 'Footer.jsx');
    if (fs.existsSync(footerPath)) {
        const footerContent = `/** @jsx h */

function Footer() {
    return (
        <footer class="bg-dark text-gray-400 text-center py-4 mt-auto">
            <div class="container mx-auto">
                <p>Made with ⚡ Aziz.js</p>
            </div>
        </footer>
    );
}
`;
        fs.writeFileSync(footerPath, footerContent);
    }
    
    // Update all pages
    updatePagesForTailwind(targetDir);
    
    // Update 404 page
    update404ForTailwind(targetDir);
}

// Update all pages for Bootstrap
function updatePagesForBootstrap(targetDir) {
    const pagesDir = path.join(targetDir, 'pages');
    if (!fs.existsSync(pagesDir)) return;
    
    // Update Home.jsx
    const homePath = path.join(pagesDir, 'Home.jsx');
    if (fs.existsSync(homePath)) {
        fs.writeFileSync(homePath, getBootstrapHomePage());
    }
    
    // Update test.jsx
    const testPath = path.join(pagesDir, 'test.jsx');
    if (fs.existsSync(testPath)) {
        fs.writeFileSync(testPath, getBootstrapTestPage());
    }
    
    // About and Contact pages are simple, they work with any framework
}

// Update all pages for Tailwind
function updatePagesForTailwind(targetDir) {
    const pagesDir = path.join(targetDir, 'pages');
    if (!fs.existsSync(pagesDir)) return;
    
    // Update Home.jsx
    const homePath = path.join(pagesDir, 'Home.jsx');
    if (fs.existsSync(homePath)) {
        fs.writeFileSync(homePath, getTailwindHomePage());
    }
    
    // Update test.jsx
    const testPath = path.join(pagesDir, 'test.jsx');
    if (fs.existsSync(testPath)) {
        fs.writeFileSync(testPath, getTailwindTestPage());
    }
}

// Bootstrap Home Page
function getBootstrapHomePage() {
    return `/** @jsx h */

// Auto-registered as "home" route
function HomePage() {
    return (
        <div class="container py-5">
            <h1 class="display-4 mb-4">Welcome Home 👋</h1>

            <div class="card mb-4">
                <div class="card-body">
                    <h2 class="card-title">Global State Counter</h2>
                    <p class="card-text">This uses the global state. Click the buttons to update it.</p>

                    <div class="text-center my-4">
                        <h1 class="display-1 fw-bold text-primary">{state.count}</h1>
                    </div>

                    <div class="d-flex gap-2 justify-content-center">
                        <button class="btn btn-danger" onClick={() => setState({ count: state.count - 1 })}>−</button>
                        <button class="btn btn-primary" onClick={() => setState({ count: state.count + 1 })}>+</button>
                        <button class="btn btn-secondary" onClick={() => setState({ count: 0 })}>Reset</button>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-body">
                    <h2 class="card-title">File-based Routing</h2>
                    <p class="card-text">
                        Each file in <strong>pages/</strong> is a route — just like Next.js.
                        Add a new file, run the build script, and it's a new page.
                    </p>
                    <div class="d-flex gap-2">
                        <button class="btn btn-primary" onClick={() => navigate("test")}>
                            Go to Test Page →
                        </button>
                        <button class="btn btn-outline-primary" onClick={() => navigate("about")}>
                            Go to About →
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
`;
}

// Tailwind Home Page
function getTailwindHomePage() {
    return `/** @jsx h */

// Auto-registered as "home" route
function HomePage() {
    return (
        <div class="container mx-auto py-10 px-4">
            <h1 class="text-4xl font-bold mb-6 text-gray-800">Welcome Home 👋</h1>

            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 class="text-2xl font-bold mb-3 text-gray-800">Global State Counter</h2>
                <p class="text-gray-600 mb-4">This uses the global state. Click the buttons to update it.</p>

                <div class="text-center my-6">
                    <h1 class="text-7xl font-bold text-primary">{state.count}</h1>
                </div>

                <div class="flex gap-3 justify-center">
                    <button class="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition" onClick={() => setState({ count: state.count - 1 })}>−</button>
                    <button class="px-6 py-2 bg-primary text-dark font-bold rounded-lg hover:opacity-80 transition" onClick={() => setState({ count: state.count + 1 })}>+</button>
                    <button class="px-6 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition" onClick={() => setState({ count: 0 })}>Reset</button>
                </div>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6">
                <h2 class="text-2xl font-bold mb-3 text-gray-800">File-based Routing</h2>
                <p class="text-gray-600 mb-4">
                    Each file in <strong>pages/</strong> is a route — just like Next.js.
                    Add a new file, run the build script, and it's a new page.
                </p>
                <div class="flex gap-3">
                    <button class="px-6 py-2 bg-primary text-dark font-bold rounded-lg hover:opacity-80 transition" onClick={() => navigate("test")}>
                        Go to Test Page →
                    </button>
                    <button class="px-6 py-2 border-2 border-primary text-primary rounded-lg hover:bg-primary hover:text-dark transition" onClick={() => navigate("about")}>
                        Go to About →
                    </button>
                </div>
            </div>
        </div>
    );
}
`;
}

// Bootstrap Test Page
function getBootstrapTestPage() {
    return `/** @jsx h */

// Auto-registered as "test" route
function TestPage() {
    const [count, setCount] = useState(0);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    
    const handleSubmit = (e) => {
        e.preventDefault();
        alert(\`Form submitted!\\nName: \${name}\\nEmail: \${email}\\nCount: \${count}\`);
    };
    
    return (
        <div class="container py-5">
            <h1 class="display-4 mb-4">Test Page 🧪</h1>

            <div class="card mb-4">
                <div class="card-body">
                    <h2 class="card-title">Counter Example</h2>
                    <p class="card-text">This demonstrates the state management system.</p>
                    
                    <div class="text-center my-4">
                        <h1 class="display-1 fw-bold text-primary">{count}</h1>
                    </div>
                    <div class="d-flex gap-2 justify-content-center">
                        <button class="btn btn-primary" onClick={() => setCount(count + 1)}>
                            Increment
                        </button>
                        <button class="btn btn-danger" onClick={() => setCount(0)}>
                            Reset
                        </button>
                    </div>
                </div>
            </div>

            <div class="card mb-4">
                <div class="card-body">
                    <h2 class="card-title">Form Example</h2>
                    <p class="card-text">Try the form with state management.</p>
                    
                    <form onSubmit={handleSubmit}>
                        <div class="mb-3">
                            <label class="form-label">Name:</label>
                            <input 
                                type="text" 
                                class="form-control"
                                value={name}
                                onInput={(e) => setName(e.target.value)}
                                placeholder="Enter your name"
                            />
                        </div>
                        
                        <div class="mb-3">
                            <label class="form-label">Email:</label>
                            <input 
                                type="email" 
                                class="form-control"
                                value={email}
                                onInput={(e) => setEmail(e.target.value)}
                                placeholder="Enter your email"
                            />
                        </div>
                        
                        <button type="submit" class="btn btn-primary">
                            Submit Form
                        </button>
                    </form>
                </div>
            </div>
            
            <div class="card">
                <div class="card-body">
                    <h2 class="card-title">State Information</h2>
                    <p class="mb-2">Current count: <strong class="text-primary">{count}</strong></p>
                    <p class="mb-2">Current name: <strong class="text-primary">{name || 'Not set'}</strong></p>
                    <p class="mb-0">Current email: <strong class="text-primary">{email || 'Not set'}</strong></p>
                </div>
            </div>
        </div>
    );
}
`;
}

// Tailwind Test Page
function getTailwindTestPage() {
    return `/** @jsx h */

// Auto-registered as "test" route
function TestPage() {
    const [count, setCount] = useState(0);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    
    const handleSubmit = (e) => {
        e.preventDefault();
        alert(\`Form submitted!\\nName: \${name}\\nEmail: \${email}\\nCount: \${count}\`);
    };
    
    return (
        <div class="container mx-auto py-10 px-4">
            <h1 class="text-4xl font-bold mb-6 text-gray-800">Test Page 🧪</h1>

            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 class="text-2xl font-bold mb-3 text-gray-800">Counter Example</h2>
                <p class="text-gray-600 mb-4">This demonstrates the state management system.</p>
                
                <div class="text-center my-6">
                    <h1 class="text-7xl font-bold text-primary">{count}</h1>
                </div>
                <div class="flex gap-3 justify-center">
                    <button class="px-6 py-2 bg-primary text-dark font-bold rounded-lg hover:opacity-80 transition" onClick={() => setCount(count + 1)}>
                        Increment
                    </button>
                    <button class="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition" onClick={() => setCount(0)}>
                        Reset
                    </button>
                </div>
            </div>

            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 class="text-2xl font-bold mb-3 text-gray-800">Form Example</h2>
                <p class="text-gray-600 mb-4">Try the form with state management.</p>
                
                <form onSubmit={handleSubmit} class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Name:</label>
                        <input 
                            type="text" 
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none transition"
                            value={name}
                            onInput={(e) => setName(e.target.value)}
                            placeholder="Enter your name"
                        />
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Email:</label>
                        <input 
                            type="email" 
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none transition"
                            value={email}
                            onInput={(e) => setEmail(e.target.value)}
                            placeholder="Enter your email"
                        />
                    </div>
                    
                    <button type="submit" class="px-6 py-2 bg-primary text-dark font-bold rounded-lg hover:opacity-80 transition">
                        Submit Form
                    </button>
                </form>
            </div>
            
            <div class="bg-white rounded-lg shadow-md p-6">
                <h2 class="text-2xl font-bold mb-3 text-gray-800">State Information</h2>
                <p class="mb-2 text-gray-700">Current count: <strong class="text-primary">{count}</strong></p>
                <p class="mb-2 text-gray-700">Current name: <strong class="text-primary">{name || 'Not set'}</strong></p>
                <p class="mb-0 text-gray-700">Current email: <strong class="text-primary">{email || 'Not set'}</strong></p>
            </div>
        </div>
    );
}
`;
}

// Update 404 page for Bootstrap
function update404ForBootstrap(targetDir) {
    const routerPath = path.join(targetDir, 'modules', 'router.js');
    if (!fs.existsSync(routerPath)) return;
    
    let content = fs.readFileSync(routerPath, 'utf8');
    
    const old404 = `// 404 page — shown when no route matches
function NotFoundPage() {
    return (
        <div class="not-found">
            <h1>404</h1>
            <p>Page not found.</p>
            <button class="btn btn-primary" onClick={() => navigate("home")}>Go Home</button>
        </div>
    );
}`;
    
    const new404 = `// 404 page — shown when no route matches
function NotFoundPage() {
    return (
        <div class="container text-center py-5">
            <h1 class="display-1 fw-bold text-primary mb-4">404</h1>
            <p class="lead mb-4">Oops! The page you're looking for doesn't exist.</p>
            <button class="btn btn-primary btn-lg" onClick={() => navigate("home")}>
                <i class="bi bi-house-door me-2"></i>Go Home
            </button>
        </div>
    );
}`;
    
    content = content.replace(old404, new404);
    fs.writeFileSync(routerPath, content);
}

// Update 404 page for Tailwind
function update404ForTailwind(targetDir) {
    const routerPath = path.join(targetDir, 'modules', 'router.js');
    if (!fs.existsSync(routerPath)) return;
    
    let content = fs.readFileSync(routerPath, 'utf8');
    
    const old404 = `// 404 page — shown when no route matches
function NotFoundPage() {
    return (
        <div class="not-found">
            <h1>404</h1>
            <p>Page not found.</p>
            <button class="btn btn-primary" onClick={() => navigate("home")}>Go Home</button>
        </div>
    );
}`;
    
    const new404 = `// 404 page — shown when no route matches
function NotFoundPage() {
    return (
        <div class="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
            <h1 class="text-9xl font-bold text-primary mb-4">404</h1>
            <p class="text-2xl text-gray-600 mb-8">Oops! The page you're looking for doesn't exist.</p>
            <button 
                class="px-8 py-3 bg-primary text-dark font-bold rounded-lg hover:opacity-80 transition transform hover:scale-105"
                onClick={() => navigate("home")}
            >
                ← Go Home
            </button>
        </div>
    );
}`;
    
    content = content.replace(old404, new404);
    fs.writeFileSync(routerPath, content);
}

// Run main function
main().catch(err => {
    console.error('❌ Error:', err);
    rl.close();
    process.exit(1);
});
