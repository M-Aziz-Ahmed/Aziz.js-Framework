const test = require('node:test');
const assert = require('node:assert');
const { installDOM } = require('./helpers/dom.js');
const { loadFramework } = require('./helpers/esm.js');

const { document } = installDOM();

let runtime, hooks;

test.before(async () => {
    ({ runtime, hooks } = await loadFramework(['runtime.js', 'hooks.js']));

    // Synchronous frame scheduler for tests
    globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
    globalThis.window = globalThis.window || {};
});

function mount(Component, base = 'page:/') {
    const container = document.createElement('div');
    runtime.mountPage(Component, [], container, base);
    return container;
}

test('basic render produces DOM', () => {
    const { h } = runtime;
    const container = mount(() => h('div', null, h('span', null, 'hi')));
    assert.equal(container.childNodes[0].tagName, 'div');
    assert.equal(container.textContent, 'hi');
});

test('useState persists state across re-renders', () => {
    const { h } = runtime;
    const { useState } = hooks;

    const container = document.createElement('div');
    function Counter() {
        const [count, setCount] = useState(0);
        return h('div', null,
            h('span', null, String(count)),
            h('button', { onClick: () => setCount(c => c + 1) }, '+')
        );
    }

    const render = () => runtime.mountPage(Counter, [], container, 'page:/counter');
    globalThis.window.__rerenderPage = render;

    render();
    assert.equal(container.childNodes[0].childNodes[0].textContent, '0');

    container.childNodes[0].childNodes[1].dispatch('click');
    assert.equal(container.childNodes[0].childNodes[0].textContent, '1');

    container.childNodes[0].childNodes[1].dispatch('click');
    assert.equal(container.childNodes[0].childNodes[0].textContent, '2');
});

test('BUGFIX: sibling components keep their own hook state (keyed list)', () => {
    const { h } = runtime;
    const { useState } = hooks;

    const container = document.createElement('div');
    let items = [1, 2];

    function Item({ id }) {
        const [n, setN] = useState(0);
        return h('div', { class: 'item', onClick: () => setN(x => x + 1) }, `${id}:${n}`);
    }
    function List({ items }) {
        return h('div', null, items.map(id => h(Item, { key: id, id })));
    }
    function App() {
        return h(List, { items });
    }

    const render = () => runtime.mountPage(App, [], container, 'page:/list');
    globalThis.window.__rerenderPage = render;

    render();
    // Click the SECOND item twice
    container.childNodes[0].childNodes[1].dispatch('click');
    container.childNodes[0].childNodes[1].dispatch('click');
    assert.equal(container.childNodes[0].childNodes[1].textContent, '2:2');

    // Remove the first item — the second item's state must survive
    items = [2];
    render();
    assert.equal(container.childNodes[0].childNodes[0].textContent, '2:2');
});

test('useContext reads provider value; falls back to default', () => {
    const { h } = runtime;
    const { createContext, useContext } = hooks;

    const Ctx = createContext('default');
    function Child() {
        return h('span', null, useContext(Ctx));
    }
    function WithProvider() {
        return h(Ctx.Provider, { value: 'hello' }, h(Child, {}));
    }

    const withProvider = mount(WithProvider, 'page:/ctx1');
    assert.equal(withProvider.textContent, 'hello');

    const withoutProvider = mount(Child, 'page:/ctx2');
    assert.equal(withoutProvider.textContent, 'default');
});

test('BUGFIX: nested providers give the innermost value', () => {
    const { h } = runtime;
    const { createContext, useContext } = hooks;

    const Ctx = createContext('default');
    function Child() { return h('span', null, useContext(Ctx)); }

    const container = mount(() =>
        h(Ctx.Provider, { value: 'outer' },
            h('div', null,
                h(Child, {}),
                h(Ctx.Provider, { value: 'inner' }, h(Child, {}))
            )
        ), 'page:/nested');

    assert.equal(container.textContent, 'outerinner');
});

test('useEffect runs after render and cleanup runs on dispose', async () => {
    const { h } = runtime;
    const { useEffect } = hooks;

    const events = [];
    function Eff() {
        useEffect(() => {
            events.push('effect');
            return () => events.push('cleanup');
        }, []);
        return h('div', null, 'x');
    }

    mount(Eff, 'page:/effect');
    await Promise.resolve(); // flush effect microtask
    assert.deepEqual(events, ['effect']);

    runtime.disposeFibers();
    assert.deepEqual(events, ['effect', 'cleanup']);
});

test('useMemo caches and recomputes on dep change', () => {
    const { h } = runtime;
    const { useState, useMemo } = hooks;

    let computations = 0;
    const container = document.createElement('div');
    function Comp() {
        const [n, setN] = useState(1);
        const doubled = useMemo(() => { computations++; return n * 2; }, [n]);
        return h('div', null,
            h('span', null, String(doubled)),
            h('button', { onClick: () => setN(n) }, 'nochange'),
            h('button', { onClick: () => setN(n + 1) }, 'change')
        );
    }
    const render = () => runtime.mountPage(Comp, [], container, 'page:/memo');
    globalThis.window.__rerenderPage = render;

    render();
    assert.equal(computations, 1);
    container.childNodes[0].childNodes[1].dispatch('click'); // same value
    assert.equal(computations, 1);
    container.childNodes[0].childNodes[2].dispatch('click'); // new value
    assert.equal(computations, 2);
    assert.equal(container.childNodes[0].childNodes[0].textContent, '4');
});

test('useRef holds a stable mutable object', () => {
    const { h } = runtime;
    const { useRef, useState } = hooks;

    const seen = [];
    function Comp() {
        const ref = useRef({ n: 0 });
        const [tick, setTick] = useState(0);
        ref.current.n = tick;
        seen.push(ref);
        return h('button', { onClick: () => setTick(t => t + 1) }, 'go');
    }
    const container = document.createElement('div');
    const render = () => runtime.mountPage(Comp, [], container, 'page:/ref');
    globalThis.window.__rerenderPage = render;
    render();
    container.childNodes[0].dispatch('click');
    assert.equal(seen[0], seen[1]); // same object across renders
    assert.equal(seen[1].current.n, 1);
});

test('function ref receives the DOM node', () => {
    const { h, materialize } = runtime;
    let captured = null;
    const el = materialize(h('input', { ref: node => { captured = node; }, type: 'text' }));
    assert.ok(captured);
    assert.equal(captured.tagName, 'input');
});

test('object ref receives the DOM node', () => {
    const { h, materialize } = runtime;
    const ref = { current: null };
    materialize(h('input', { ref }));
    assert.equal(ref.current.tagName, 'input');
});

test('BUGFIX: onDoubleClick maps to the dblclick event', () => {
    const { h, materialize } = runtime;
    let fired = false;
    const el = materialize(h('button', { onDoubleClick: () => { fired = true; } }, 'x'));
    assert.ok(el._listeners.dblclick);
    el.dispatch('dblclick');
    assert.ok(fired);
});

test('boolean attributes are applied/removed correctly', () => {
    const { h, materialize } = runtime;
    const disabled = materialize(h('button', { disabled: true }, 'x'));
    assert.equal(disabled.getAttribute('disabled'), '');
    const enabled = materialize(h('button', { disabled: false }, 'x'));
    assert.equal(enabled.getAttribute('disabled'), null);
});

test('Fragment renders children inline', () => {
    const { h, Fragment } = runtime;
    const container = mount(() => h(Fragment, null, h('a', null, '1'), h('a', null, '2')));
    assert.equal(container.childNodes.length, 2);
});

test('BUGFIX: mountPage passes children through layout chain', () => {
    const { h } = runtime;

    function Page() {
        return h('p', null, 'PAGE');
    }
    function Layout({ children }) {
        return h('section', null, h('h1', null, 'CHROME'), children);
    }

    const container = document.createElement('div');
    runtime.mountPage(Page, [Layout], container, 'page:/layout');

    const section = container.childNodes[0];
    assert.equal(section.tagName, 'section');
    assert.equal(section.childNodes[0].textContent, 'CHROME');
    assert.equal(section.childNodes[1].tagName, 'p');
    assert.equal(section.childNodes[1].textContent, 'PAGE');
});

test('BUGFIX: siblings under a DOM element get distinct fibers (no cross-talk)', () => {
    const { h } = runtime;
    const { useState } = hooks;

    const container = document.createElement('div');
    function A() {
        const [n, setN] = useState(10);
        return h('button', { id: 'a', onClick: () => setN(n + 1) }, 'A' + n);
    }
    function B() {
        const [n, setN] = useState(20);
        return h('button', { id: 'b', onClick: () => setN(n + 1) }, 'B' + n);
    }
    function App() {
        return h('div', null, h(A), h(B));
    }

    const render = () => runtime.mountPage(App, [], container, 'page:/sibs');
    globalThis.window.__rerenderPage = render;
    render();

    const btnA = container.childNodes[0].childNodes[0];
    const btnB = container.childNodes[0].childNodes[1];
    assert.equal(btnA.textContent, 'A10');
    assert.equal(btnB.textContent, 'B20');

    btnA.dispatch('click');
    assert.equal(container.childNodes[0].childNodes[0].textContent, 'A11');
    assert.equal(container.childNodes[0].childNodes[1].textContent, 'B20');
});
