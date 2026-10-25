#!/usr/bin/env node

// ============================================================
//  Aziz.js — optional type checking
//
//  The framework strips types at build time so a .tsx page runs.
//  It never verifies them: that is what this script is for.
//
//      npm i -D typescript
//      npm run typecheck
//
//  TypeScript is not a dependency of the framework — it is large,
//  and most Aziz.js apps are plain JavaScript. When it is not
//  installed this script says so and exits cleanly.
// ============================================================

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const PROJECT = path.join(ROOT, 'tsconfig.json');

function hasTypeScript() {
    return fs.existsSync(TSC);
}

function main() {
    if (!fs.existsSync(PROJECT)) {
        console.error('❌ tsconfig.json not found. Run this from the project root.');
        process.exit(1);
    }

    if (!hasTypeScript()) {
        console.log('⚠️  TypeScript is not installed — no types were checked.');
        console.log('   Enable it with:  npm i -D typescript');
        if (process.env.CI) {
            console.error('   CI=true, so this is treated as a failure.');
            process.exit(1);
        }
        return;
    }

    const args = [TSC, '--noEmit', '-p', PROJECT, ...process.argv.slice(2)];
    const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });

    if (result.error) {
        console.error('❌ Could not run tsc:', result.error.message);
        process.exit(1);
    }

    if (result.status === 0) {
        console.log('✅ No type errors.');
    } else {
        console.error('❌ Type errors found.');
    }
    process.exit(result.status === null ? 1 : result.status);
}

main();
