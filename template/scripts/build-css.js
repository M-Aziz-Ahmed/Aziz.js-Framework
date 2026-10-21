#!/usr/bin/env node

const tailwind = require('./lib/tailwind');

const root = process.cwd();
const result = tailwind.build(root, { minify: true });

if (result.skipped) {
    console.log('Tailwind is not enabled (no /styles/tailwind.output.css link).');
} else if (!result.ok) {
    console.error(`Tailwind build failed: ${result.reason}`);
    process.exit(1);
} else {
    console.log('🎨 Tailwind CSS built → styles/tailwind.output.css');
}
