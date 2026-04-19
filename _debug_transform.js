const Babel = require('./template/node_modules/@babel/standalone');
const fs = require('fs');
const code = fs.readFileSync('./template/app/page.js', 'utf8');

function rewriteImports(code, filePath) {
    code = code.replace(
        /((?:import|export)[^'"]*from\s+)['"]@\/([^'"]+)['"]/g,
        (_, prefix, p) => `${prefix}'/${p}'`
    );
    code = code.replace(
        /((?:import|export)[^'"]*from\s+)['"]([^'"./][^'"]*)['"]/g,
        (_, prefix, specifier) => `${prefix}'/_modules/${specifier}'`
    );
    code = code.replace(
        /\bimport\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g,
        (_, specifier) => `import('/_modules/${specifier}')`
    );
    return code;
}

try {
    const result = Babel.transform(code, {
        filename: 'page.js',
        presets: [['react', { pragma: 'h', pragmaFrag: 'Fragment' }]],
        plugins: [],
        sourceType: 'module',
    });
    const rewritten = rewriteImports(result.code, 'page.js');
    console.log('=== TRANSFORM OK ===');
    // Check for the broken line specifically
    const lines = rewritten.split('\n');
    lines.forEach((line, i) => {
        if (line.includes('node_modules') || line.includes('/_modules/')) {
            console.log(`Line ${i+1}: ${line}`);
        }
    });
    console.log('\n=== FULL OUTPUT ===');
    console.log(rewritten);
} catch(err) {
    console.log('=== ERROR ===', err.message);
}
