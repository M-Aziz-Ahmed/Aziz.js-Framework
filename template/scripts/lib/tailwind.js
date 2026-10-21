// ============================================================
//  Local Tailwind CSS build
//
//  The scaffold links /styles/tailwind.output.css. This module
//  compiles styles/tailwind.css with the local tailwindcss CLI.
//  No CDN, no network at runtime, and the output is safe to
//  serve in production.
// ============================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function paths(root) {
    return {
        input: path.join(root, 'styles', 'tailwind.css'),
        output: path.join(root, 'styles', 'tailwind.output.css'),
        config: path.join(root, 'tailwind.config.js'),
        index: path.join(root, 'index.html'),
    };
}

function hasFile(file) {
    try { return fs.statSync(file).isFile(); } catch { return false; }
}

function isEnabled(root) {
    const p = paths(root);
    if (!hasFile(p.input) || !hasFile(p.config) || !hasFile(p.index)) return false;
    const html = fs.readFileSync(p.index, 'utf8');
    return html.includes('/styles/tailwind.output.css');
}

function resolveCli(root) {
    const candidates = [
        'tailwindcss/lib/cli.js',
        'tailwindcss/lib/cli/index.js',
    ];
    for (const candidate of candidates) {
        try {
            return require.resolve(candidate, { paths: [root] });
        } catch { /* try the next layout */ }
    }
    return null;
}

function build(root, options = {}) {
    if (!isEnabled(root)) return { ok: true, skipped: true };

    const p = paths(root);
    const cli = resolveCli(root);
    if (!cli) {
        return {
            ok: false,
            reason: 'tailwindcss is not installed. Run: npm install',
        };
    }

    const args = [
        cli,
        '-i', p.input,
        '-o', p.output,
        '-c', p.config,
    ];
    if (options.minify !== false) args.push('--minify');

    const result = spawnSync(process.execPath, args, {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
    });

    if (result.error) {
        return { ok: false, reason: result.error.message };
    }
    if (result.status !== 0) {
        return {
            ok: false,
            reason: (result.stderr || result.stdout || `Tailwind exited ${result.status}`).trim(),
        };
    }
    return { ok: true, output: p.output };
}

module.exports = { isEnabled, build, paths };
