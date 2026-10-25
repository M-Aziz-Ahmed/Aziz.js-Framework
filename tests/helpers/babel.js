const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const SOURCES = [
    path.join(REPO, 'template', 'node_modules', '@babel', 'standalone'),
    path.join(REPO, 'node_modules', '@babel', 'standalone'),
];

// Temp projects live outside the repo, so they cannot resolve the root
// devDependency by walking up. Link it into the scaffold; fall back to a copy
// when the platform does not allow symlinks.
function linkBabel(dir) {
    const source = SOURCES.find(candidate => fs.existsSync(candidate));
    if (!source) return false;

    const dest = path.join(dir, 'node_modules', '@babel', 'standalone');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
        fs.symlinkSync(source, dest, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(source, dest, { recursive: true });
    }
    return true;
}

module.exports = { linkBabel };
