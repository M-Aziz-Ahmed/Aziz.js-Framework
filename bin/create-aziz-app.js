#!/usr/bin/env node

// ============================================================
//  create-aziz-app — project scaffolder for Aziz.js
//
//  Usage:
//    npx create-aziz-app my-app
//    npx create-aziz-app my-app --css tailwind --no-docs
//    npx create-aziz-app my-app -y --port 4000
//
//  Options:
//    -y, --yes            Accept all defaults (no prompts)
//    --port <n>           Dev-server port (default 3000)
//    --css <name>         none | bootstrap | tailwind
//    --no-docs            Skip the docs/ folder
//    -h, --help           Show help
// ============================================================

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function parseArgs(argv) {
    const opts = {
        projectName: null,
        yes: false,
        port: null,
        css: null,
        docs: null,
        help: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '-h':
            case '--help': opts.help = true; break;
            case '-y':
            case '--yes': opts.yes = true; break;
            case '--port': opts.port = argv[++i]; break;
            case '--css': opts.css = argv[++i]; break;
            case '--no-docs': opts.docs = false; break;
            default:
                if (!arg.startsWith('-') && !opts.projectName) opts.projectName = arg;
        }
    }
    return opts;
}

function printHelp() {
    console.log(`
⚡ create-aziz-app — scaffold a new Aziz.js project

Usage:
  npx create-aziz-app <project-name> [options]

Options:
  -y, --yes           Accept all defaults (skip prompts)
  --port <n>          Dev-server port (default 3000)
  --css <name>        none | bootstrap | tailwind
  --no-docs           Skip the docs/ folder
  -h, --help          Show this help

Examples:
  npx create-aziz-app blog
  npx create-aziz-app shop --css tailwind --port 4000
`);
}

// Files/folders never copied into a new project.
function shouldSkip(relPath) {
    if (relPath === 'node_modules' || relPath.startsWith('node_modules' + path.sep)) return true;
    if (relPath === '.DS_Store' || relPath.endsWith('.log')) return true;
    return false;
}

function copyDir(src, dest, features) {
    fs.mkdirSync(dest, { recursive: true });

    for (const entry of fs.readdirSync(src)) {
        const srcPath = path.join(src, entry);
        const destPath = path.join(dest, entry);

        if (shouldSkip(entry)) continue;

        const isDir = fs.statSync(srcPath).isDirectory();

        // Docs are optional
        if (!features.docs && entry === 'docs' && isDir) continue;

        if (isDir) {
            copyDir(srcPath, destPath, features);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function updatePackageJson(targetDir, projectName) {
    const pkgPath = path.join(targetDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.name = projectName;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

function updateDevServerPort(targetDir, port) {
    const devServerPath = path.join(targetDir, 'scripts', 'dev-server.js');
    if (!fs.existsSync(devServerPath)) return;
    let content = fs.readFileSync(devServerPath, 'utf8');
    content = content.replace(
        /const PORT = parseInt\(process\.env\.PORT, 10\) \|\| 3000;/,
        `const PORT = parseInt(process.env.PORT, 10) || ${port};`
    );
    fs.writeFileSync(devServerPath, content);
}

function updateTitle(targetDir, projectName) {
    const htmlPath = path.join(targetDir, 'index.html');
    if (!fs.existsSync(htmlPath)) return;
    let html = fs.readFileSync(htmlPath, 'utf8');
    const pretty = projectName.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    html = html.replace(/<title>.*?<\/title>/, `<title>${pretty}</title>`);
    fs.writeFileSync(htmlPath, html);
}

function injectHead(html, snippet) {
    return html.replace('</head>', `${snippet}\n</head>`);
}

function injectBody(html, snippet) {
    return html.replace('</body>', `${snippet}\n</body>`);
}

function setupCSSFramework(targetDir, framework) {
    const htmlPath = path.join(targetDir, 'index.html');
    if (!fs.existsSync(htmlPath)) return;

    let html = fs.readFileSync(htmlPath, 'utf8');

    if (framework === 'bootstrap') {
        html = injectHead(html, `    <!-- Bootstrap 5 -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css">`);
        html = injectBody(html, `    <!-- Bootstrap 5 JS -->
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>`);
    } else if (framework === 'tailwind') {
        html = injectHead(html, `    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: { primary: '#61dafb', dark: '#282c34' }
                }
            }
        }
    </script>`);
    }
    // 'none' → keep globals.css only

    fs.writeFileSync(htmlPath, html);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));

    if (opts.help) {
        printHelp();
        rl.close();
        return;
    }

    console.log(`\n⚡ Welcome to Aziz.js!\n`);
    console.log(`🎨 A lightweight Next.js clone — file-based routing, React hooks, live reload\n`);

    let projectName = opts.projectName;
    if (!projectName) {
        projectName = (await question('📁 Project name (my-aziz-js-app): ')).trim() || 'my-aziz-js-app';
    }

    if (!/^[a-z0-9-_]+$/i.test(projectName)) {
        console.error(`❌ Invalid project name. Use only letters, numbers, hyphens, and underscores.`);
        rl.close();
        process.exit(1);
    }

    const targetDir = path.join(process.cwd(), projectName);

    if (fs.existsSync(targetDir)) {
        let overwrite = 'y';
        if (!opts.yes) {
            overwrite = await question(`⚠️  Folder "${projectName}" already exists. Overwrite? (y/N): `);
        }
        if (overwrite.toLowerCase() !== 'y' && overwrite.toLowerCase() !== 'yes') {
            console.log('❌ Cancelled.');
            rl.close();
            process.exit(0);
        }
        fs.rmSync(targetDir, { recursive: true, force: true });
    }

    // ── Port
    let port = opts.port;
    if (!port && !opts.yes) port = (await question('🌐 Dev server port (3000): ')).trim();
    port = port || '3000';
    if (!/^\d+$/.test(port)) {
        console.log('⚠️  Invalid port, using default 3000');
        port = '3000';
    }

    // ── Features
    let docs = opts.docs;

    if (!opts.yes && docs === null) {
        const a = await question('   Include documentation? (Y/n): ');
        docs = !['n', 'no'].includes(a.trim().toLowerCase());
    }
    if (docs === null) docs = true;

    // ── CSS framework
    let css = opts.css;
    if (!css && !opts.yes) {
        console.log('\n🎨 CSS Framework:');
        console.log('   1. None (custom CSS)');
        console.log('   2. Bootstrap 5');
        console.log('   3. Tailwind CSS');
        const choice = (await question('   Choose (1/2/3): ')).trim();
        css = choice === '2' ? 'bootstrap' : choice === '3' ? 'tailwind' : 'none';
    }
    if (!['none', 'bootstrap', 'tailwind'].includes(css)) css = 'none';

    const features = { docs, css };

    console.log(`\n⚡ Creating "${projectName}"...\n`);

    const templateDir = path.join(__dirname, '..', 'template');
    if (!fs.existsSync(templateDir)) {
        console.error('❌ Template folder not found. Reinstall create-aziz-app.');
        rl.close();
        process.exit(1);
    }

    // 1. Copy the template (excluding node_modules)
    copyDir(templateDir, targetDir, features);

    // 2. Personalize
    updatePackageJson(targetDir, projectName);
    updateDevServerPort(targetDir, port);
    updateTitle(targetDir, projectName);
    setupCSSFramework(targetDir, features.css);

    // 3. .gitignore
    fs.writeFileSync(path.join(targetDir, '.gitignore'), [
        'node_modules/',
        '.DS_Store',
        '*.log',
        '',
    ].join('\n'));

    console.log(`✅ Done! Your project is ready.\n`);
    console.log(`📁 Created project: ${projectName}`);
    console.log(`🎨 CSS framework:   ${features.css}`);
    console.log(`\n👉 Get started:\n`);
    console.log(`   cd ${projectName}`);
    console.log(`   npm install`);
    console.log(`   npm run dev\n`);
    console.log(`🌐 Dev server:  http://localhost:${port}/\n`);
    console.log(`📂 Project structure:\n`);
    console.log(`   index.html        ← HTML entry point`);
    console.log(`   app/              ← pages + layouts (file-based routing)`);
    console.log(`     layout.js       ← root layout`);
    console.log(`     page.js         ← route: /`);
    console.log(`   styles/           ← global CSS`);
    console.log(`   _framework/       ← runtime, hooks, router`);
    console.log(`   scripts/          ← dev server + live reload`);
    if (features.docs) console.log(`   docs/             ← full documentation`);
    console.log(`\n✨ Highlights:\n`);
    console.log(`   • File-based routing   app/about/page.js → /about`);
    console.log(`   • Dynamic routes       app/blog/[slug]/page.js → /blog/:slug`);
    console.log(`   • Nested layouts       app/**/layout.js`);
    console.log(`   • React hooks          useState, useEffect, useMemo, context…`);
    console.log(`   • Live reload          instant browser refresh on save`);
    console.log(`\n💡 Tips:\n`);
    console.log(`   • Create app/MyPage/page.js → route /MyPage`);
    if (features.docs) console.log(`   • Read docs/README.md for the full guide`);
    console.log(`\n🚀 Happy building!\n`);

    rl.close();
}

main().catch(err => {
    console.error('❌ Error:', err);
    rl.close();
    process.exit(1);
});
