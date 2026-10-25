const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const TEMPLATE = path.join(REPO, 'template');

// TypeScript is deliberately not a dependency of the framework — it is
// large and most apps are plain JavaScript. When it is not installed the
// deep checks are skipped, but the wiring is still asserted.
function findTypeScript() {
    const candidates = [
        path.join(TEMPLATE, 'node_modules', 'typescript', 'bin', 'tsc'),
        path.join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'),
    ];
    return candidates.find(p => fs.existsSync(p)) || null;
}

test('the template ships a tsconfig.json, global declarations and a typecheck script', () => {
    assert.ok(fs.existsSync(path.join(TEMPLATE, 'tsconfig.json')), 'tsconfig.json must ship');
    assert.ok(fs.existsSync(path.join(TEMPLATE, 'types', 'aziz.d.ts')), 'types/aziz.d.ts must ship');
    assert.ok(fs.existsSync(path.join(TEMPLATE, 'scripts', 'typecheck.js')), 'scripts/typecheck.js must ship');

    const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.typecheck, 'node scripts/typecheck.js');

    const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    assert.equal(rootPkg.scripts.typecheck, 'cd template && node scripts/typecheck.js');
});

test('tsconfig.json keeps types separate from emit and does not check JS', () => {
    const tsconfig = JSON.parse(fs.readFileSync(path.join(TEMPLATE, 'tsconfig.json'), 'utf8'));
    assert.equal(tsconfig.compilerOptions.noEmit, true);
    assert.equal(tsconfig.compilerOptions.strict, true);
    assert.equal(tsconfig.compilerOptions.jsx, 'preserve');
    assert.equal(tsconfig.compilerOptions.checkJs, false);
    assert.ok(tsconfig.compilerOptions.paths['@/*'], 'the @/ alias must be typed');
});

test('the global declarations cover the framework API', () => {
    const dts = fs.readFileSync(path.join(TEMPLATE, 'types', 'aziz.d.ts'), 'utf8');
    for (const name of [
        'useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useContext',
        'useFetch', 'useLocalStorage', 'createResource', 'function use<',
        'navigate', 'redirect', 'notFound', 'Link',
        'useRouter', 'useParams', 'usePathname', 'useSearchParams',
        'Image', 'Font', 'Script', 'Suspense', 'declare namespace JSX',
    ]) {
        assert.ok(dts.includes(name), `types/aziz.d.ts omits ${name}`);
    }
});

test('a .tsx page type-checks and type errors are caught', { skip: !findTypeScript() && 'typescript is not installed' }, () => {
    const tsc = findTypeScript();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aziz-ts-'));
    try {
        fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'types'), { recursive: true });
        fs.copyFileSync(path.join(TEMPLATE, 'tsconfig.json'), path.join(dir, 'tsconfig.json'));
        fs.copyFileSync(path.join(TEMPLATE, 'types', 'aziz.d.ts'), path.join(dir, 'types', 'aziz.d.ts'));

        const page = path.join(dir, 'app', 'page.tsx');
        fs.writeFileSync(page, `
            export default function Page(): JSX.Element {
                const [count, setCount] = useState(0);
                const { data, loading } = useFetch<{ ok: boolean }>('/api/ping');
                const params = useParams<{ slug: string }>();
                return (
                    <main>
                        <button onClick={() => setCount(c => c + 1)}>{count}</button>
                        {loading ? <p>loading</p> : <p>{String(data?.ok)}</p>}
                        <Link href={'/posts/' + params.slug}>go</Link>
                    </main>
                );
            }
        `);

        const ok = spawnSync(process.execPath, [tsc, '--noEmit', '-p', path.join(dir, 'tsconfig.json')], {
            cwd: dir, encoding: 'utf8',
        });
        assert.equal(ok.status, 0, `a valid .tsx page must type-check:\n${ok.stdout}${ok.stderr}`);

        // And a real type error must fail the check.
        fs.writeFileSync(page, `
            export default function Page() {
                const [count, setCount] = useState(0);
                setCount('not a number');
                return <h1>{count}</h1>;
            }
        `);
        const bad = spawnSync(process.execPath, [tsc, '--noEmit', '-p', path.join(dir, 'tsconfig.json')], {
            cwd: dir, encoding: 'utf8',
        });
        assert.notEqual(bad.status, 0, 'a type error must fail the typecheck');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});
