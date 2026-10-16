const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { rewriteImports, transformJSX, transformModule, invalidate, hasBabel } = require('../template/scripts/lib/js-transform.js');

test('rename: bare imports are rewritten to /_modules', () => {
    const out = rewriteImports("import mongoose from 'mongoose';");
    assert.match(out, /from '\/_modules\/mongoose'/);
});

test('BUGFIX: multi-line imports are rewritten', () => {
    const code = "import {\n  useState,\n  useEffect\n} from 'preact/hooks';\nconst x = 1;";
    const out = rewriteImports(code);
    assert.match(out, /from '\/_modules\/preact\/hooks'/);
});

test('@/ alias resolves to an absolute path', () => {
    const out = rewriteImports("import db from '@/lib/db';");
    assert.match(out, /from '\/lib\/db'/);
});

test('side-effect imports are rewritten', () => {
    const out = rewriteImports("import 'bootstrap';");
    assert.match(out, /import '\/_modules\/bootstrap'/);
});

test('dynamic imports are rewritten', () => {
    const out = rewriteImports("const m = await import('lodash');");
    assert.match(out, /import\('\/_modules\/lodash'\)/);
});

test('BUGFIX: prose containing "import … from" inside strings is left alone', () => {
    const code = 'h("p", null, "Use ", h("code", null, "import"), " statements. The server resolves bare imports from ", h("code", null, "node_modules"), " automatically.");';
    assert.equal(rewriteImports(code), code);
});

test('BUGFIX: real imports after a string literal are still rewritten', () => {
    const code = 'const s = "from nothing";\nimport x from "lodash";';
    assert.match(rewriteImports(code), /from "\/_modules\/lodash"/);
});

test('relative and absolute imports are left alone', () => {
    const code = "import a from './a.js';\nimport b from '../b.js';\nimport c from '/c.js';\nconst d = await import('/d.js');";
    assert.equal(rewriteImports(code), code);
});

test('node: builtins are left alone', () => {
    const code = "import fs from 'node:fs';";
    assert.equal(rewriteImports(code), code);
});

test('JSX is compiled to h() calls', (t) => {
    if (!hasBabel()) return t.skip('@babel/standalone not available');
    const out = transformJSX('const x = <div id="a">{n}</div>;', 'test.js');
    assert.match(out, /h\(/);
    assert.doesNotMatch(out, /<div/);
});

test('transformModule caches by mtime', (t) => {
    if (!hasBabel()) return t.skip('@babel/standalone not available');
    const file = path.join(__dirname, 'virtual', 'comp.js');
    const code = 'const x = <div/>;';
    const first = transformModule(code, file, 100);
    const second = transformModule(code, file, 100);
    assert.equal(first, second);

    invalidate(file);
    const third = transformModule(code, file, 100);
    assert.equal(third, first);
});

test('transform error becomes a thrown module error', (t) => {
    if (!hasBabel()) return t.skip('@babel/standalone not available');
    const out = transformModule('const x = <div>;', path.join(__dirname, 'virtual', 'bad.js'), 1);
    assert.match(out, /JSX transform error/);
    assert.match(out, /throw new Error/);
});
