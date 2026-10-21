// ============================================================
//  Aziz.js Runtime
//
//  h()        — JSX factory (like React.createElement)
//  materialize — turn a node tree into real DOM
//  mountPage  — mount a page + its layout chain
//
//  Rendering model
//  ---------------
//  Function (component) tags are LAZY: h(Component) returns a
//  lightweight descriptor. Descriptors are executed top-down when
//  they are attached to the DOM, which gives every component
//  instance its own hook "fiber" (keyed by its position in the
//  tree) and makes context propagation work correctly.
// ============================================================

import { prepareHooks, finishHooks, setMaterializer } from './hooks.js';

export const Fragment = Symbol('Fragment');

const VNODE = Symbol('aziz.vnode');

// ─── Fibers ──────────────────────────────────────────────────
// One fiber per component instance, keyed by a stable tree path.

const fibers = new Map();

export function getFiber(id) {
    let fiber = fibers.get(id);
    if (!fiber) {
        fiber = { id, hooks: [], mounted: true };
        fibers.set(id, fiber);
    } else {
        fiber.mounted = true;
    }
    return fiber;
}

export function fiberCount() {
    return fibers.size;
}

// Unmount everything: run pending effect cleanups, drop state.
export function disposeFibers() {
    for (const fiber of fibers.values()) {
        fiber.mounted = false;
        for (const hook of fiber.hooks) {
            if (hook && typeof hook.cleanup === 'function') {
                try { hook.cleanup(); } catch (err) { console.error('Error in effect cleanup:', err); }
                hook.cleanup = null;
            }
        }
    }
    fibers.clear();
}

// ─── Render context ──────────────────────────────────────────

const pathStack = [];   // component segments, outermost first
const counters = [];    // per-component occurrence counters
let rootCounter = 0;
let baseId = '';

// Begin a fresh render pass rooted at `base` (e.g. "page:/about").
export function beginRender(base) {
    baseId = base || '';
    pathStack.length = 0;
    counters.length = 0;
    rootCounter = 0;
}

function nextKey(props) {
    if (props && props.key !== undefined && props.key !== null) return 'k:' + props.key;
    if (counters.length === 0) return 'i:' + (++rootCounter);
    const top = counters.length - 1;
    return 'i:' + (++counters[top]);
}

function componentName(fn) {
    return fn.displayName || fn.name || 'Anonymous';
}

// ─── JSX factory ─────────────────────────────────────────────

export function h(tag, props, ...children) {
    // Everything is a lazy descriptor. Elements are only turned into real
    // DOM during materialization, so nested components are always executed
    // top-down (giving correct context + hook scoping).
    let kids = flatChildren(children);
    if (kids.length === 0 && props && props.children !== undefined && props.children !== null) {
        kids = flatChildren(Array.isArray(props.children) ? props.children : [props.children]);
    }
    return { [VNODE]: true, type: tag, props: props || null, children: kids };
}

function flatChildren(children) {
    return children
        .flat(Infinity)
        .filter(c => c !== null && c !== undefined && c !== false && c !== true);
}

// ─── DOM element creation (eager) ────────────────────────────

function createElement(tag, props, kids) {
    const el = document.createElement(tag);
    applyProps(el, tag, props);
    appendNodes(el, materialize(kids));
    return el;
}

const EVENT_ALIASES = {
    doubleclick: 'dblclick',
};

function eventNameFromProp(key) {
    const name = key.slice(2).toLowerCase();
    return EVENT_ALIASES[name] || name;
}

function applyProps(el, tag, props) {
    if (!props) return;

    for (const key in props) {
        if (key === 'children' || key === 'key') continue;
        const value = props[key];

        if (key === 'ref') {
            if (typeof value === 'function') value(el);
            else if (value && typeof value === 'object') value.current = el;
        } else if (key === 'className' || key === 'class') {
            if (value != null) el.className = value;
        } else if (key === 'htmlFor') {
            if (value != null) el.setAttribute('for', value);
        } else if (key === 'style') {
            if (value && typeof value === 'object') Object.assign(el.style, value);
            else if (value != null) el.setAttribute('style', value);
        } else if (key === 'dangerouslySetInnerHTML') {
            if (value && value.__html != null) el.innerHTML = value.__html;
        } else if (key === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
            el.value = value == null ? '' : value;
        } else if (key === 'checked' && tag === 'input') {
            el.checked = !!value;
        } else if (key.startsWith('on') && typeof value === 'function') {
            el.addEventListener(eventNameFromProp(key), value);
        } else if (typeof value === 'boolean') {
            if (value) el.setAttribute(key, '');
            else el.removeAttribute(key);
        } else if (value != null) {
            el.setAttribute(key, value);
        }
    }
}

// ─── Materialization ─────────────────────────────────────────

// Turn any node value into real DOM node(s).
// Returns: Node | Node[] | null
export function materialize(node) {
    if (node === null || node === undefined || node === false || node === true) return null;

    if (Array.isArray(node)) {
        const out = [];
        for (const child of node) {
            const m = materialize(child);
            if (Array.isArray(m)) {
                for (const n of m) if (n !== null) out.push(n);
            } else if (m !== null) {
                out.push(m);
            }
        }
        return out;
    }

    if (typeof node === 'object' && node[VNODE]) {
        return materializeVNode(node);
    }

    if (typeof Node !== 'undefined' && node instanceof Node) return node;

    return document.createTextNode(String(node));
}

function materializeVNode(vnode) {
    const { type, props, children } = vnode;

    if (type === Fragment) return materialize(children);
    if (typeof type === 'function') return materializeComponent(type, props, children);

    return createElement(type, props, children);
}

function materializeComponent(type, props, children) {
    const segment = componentName(type) + '@' + nextKey(props);
    pathStack.push(segment);
    counters.push(0);

    const id = (baseId ? baseId + '>' : '') + pathStack.join('>');
    const fiber = getFiber(id);

    // Async components are cached per fiber: the first pass suspends the
    // router, and the retry uses the resolved vnode tree instead of calling
    // the component (and therefore its data source) a second time.
    if (fiber.asyncOutput) {
        if (fiber.asyncOutput.status === 'error') {
            counters.pop();
            pathStack.pop();
            throw fiber.asyncOutput.error;
        }
        if (fiber.asyncOutput.status === 'pending') {
            counters.pop();
            pathStack.pop();
            throw fiber.asyncOutput.promise;
        }
        const cachedNodes = materialize(fiber.asyncOutput.value);
        counters.pop();
        pathStack.pop();
        return cachedNodes;
    }

    prepareHooks(fiber);

    let output;
    try {
        output = type({ ...(props || {}), children });
        finishHooks();
    } catch (err) {
        finishHooks();
        counters.pop();
        pathStack.pop();
        throw err;
    }

    if (output && typeof output.then === 'function') {
        const entry = { status: 'pending' };
        entry.promise = output.then(
            (value) => { entry.status = 'success'; entry.value = value; return value; },
            (error) => { entry.status = 'error'; entry.error = error; throw error; }
        );
        entry.promise.catch(() => {});
        fiber.asyncOutput = entry;
        counters.pop();
        pathStack.pop();
        throw entry.promise;
    }

    // Materialize the component's output while its scope is still on the
    // stack so child fibers nest under this component (stable keys).
    const nodes = materialize(output);
    counters.pop();
    pathStack.pop();
    return nodes;
}

export function appendNodes(container, nodes) {
    if (nodes === null || nodes === undefined) return;
    if (Array.isArray(nodes)) {
        for (const n of nodes) {
            if (n !== null && n !== undefined) container.appendChild(n);
        }
    } else {
        container.appendChild(nodes);
    }
}

// ─── Mounting ────────────────────────────────────────────────

// Mount a page wrapped in its layout chain.
// `layouts` must be ordered outermost → innermost.
export function mountPage(PageComponent, layouts, container, base, props) {
    beginRender(base || 'page');

    let tree = h(PageComponent, props || {});
    for (let i = layouts.length - 1; i >= 0; i--) {
        tree = h(layouts[i], { children: tree });
    }

    const nodes = materialize(tree);
    container.innerHTML = '';
    appendNodes(container, nodes);

    return container;
}

// Simple mount helper (kept for backwards compatibility).
export function render(component, container) {
    beginRender('root');
    const tree = typeof component === 'function' ? h(component, {}) : component;
    const nodes = materialize(tree);
    container.innerHTML = '';
    appendNodes(container, nodes);
    return container;
}

// ─── Hydration ───────────────────────────────────────────────
//
// Attach event listeners and hook state to the markup emitted by the
// server renderer instead of throwing it away. The tree shape is the same
// one mountPage would create, so hydration is a depth-first walk over the
// existing DOM. If a component suspends, the error propagates and the
// caller keeps the server markup until the data lands.

function hydrateNode(node, parent, state) {
    if (node === null || node === undefined || node === false || node === true) return;

    if (Array.isArray(node)) {
        for (const child of node) hydrateNode(child, parent, state);
        return;
    }

    if (typeof node === 'object' && node[VNODE]) {
        hydrateVNode(node, parent, state);
        return;
    }

    const existing = takeNode(parent, state);
    const text = String(node);
    if (existing && existing.nodeType === 3 && existing.textContent === text) return;
    if (existing && existing.nodeType === 1 && existing.tagName.toLowerCase() === 'aziz-text') {
        existing.textContent = text;
        return;
    }
    const textNode = document.createTextNode(text);
    if (existing) parent.replaceChild(textNode, existing);
    else parent.appendChild(textNode);
}

function takeNode(parent, state) {
    const index = state.pointers.get(parent) || 0;
    state.pointers.set(parent, index + 1);
    return parent.childNodes[index] || null;
}

function hydrateVNode(vnode, parent, state) {
    const { type, props, children } = vnode;

    if (type === Fragment) {
        for (const child of children) hydrateNode(child, parent, state);
        return;
    }

    if (typeof type === 'function') {
        hydrateComponent(type, props, children, parent, state);
        return;
    }

    hydrateElement(type, props, children, parent, state);
}

function hydrateComponent(type, props, children, parent, state) {
    const segment = componentName(type) + '@' + nextKey(props);
    pathStack.push(segment);
    counters.push(0);

    const id = (baseId ? baseId + '>' : '') + pathStack.join('>');
    const fiber = getFiber(id);

    if (fiber.asyncOutput) {
        if (fiber.asyncOutput.status === 'error') {
            counters.pop();
            pathStack.pop();
            throw fiber.asyncOutput.error;
        }
        if (fiber.asyncOutput.status === 'pending') {
            counters.pop();
            pathStack.pop();
            throw fiber.asyncOutput.promise;
        }
        for (const child of normalizeChildren(fiber.asyncOutput.value)) {
            hydrateNode(child, parent, state);
        }
        counters.pop();
        pathStack.pop();
        return;
    }

    prepareHooks(fiber);
    let output;
    try {
        output = type({ ...(props || {}), children });
        finishHooks();
    } catch (err) {
        finishHooks();
        counters.pop();
        pathStack.pop();
        throw err;
    }

    if (output && typeof output.then === 'function') {
        const entry = { status: 'pending' };
        entry.promise = output.then(
            (value) => { entry.status = 'success'; entry.value = value; return value; },
            (error) => { entry.status = 'error'; entry.error = error; throw error; }
        );
        entry.promise.catch(() => {});
        fiber.asyncOutput = entry;
        counters.pop();
        pathStack.pop();
        throw entry.promise;
    }

    try {
        for (const child of normalizeChildren(output)) hydrateNode(child, parent, state);
    } finally {
        counters.pop();
        pathStack.pop();
    }
}

function normalizeChildren(output) {
    if (output === null || output === undefined || output === false || output === true) return [];
    if (Array.isArray(output)) return output.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false && c !== true);
    return [output];
}

function hydrateElement(tag, props, kids, parent, state) {
    const existing = takeNode(parent, state);
    let el = existing;

    if (!el || el.nodeType !== 1 || String(el.tagName).toLowerCase() !== String(tag).toLowerCase()) {
        el = document.createElement(tag);
        if (existing) parent.replaceChild(el, existing);
        else parent.appendChild(el);
    } else {
        applyProps(el, tag, props);
    }

    for (const child of kids) hydrateNode(child, el, state);

    // Drop server-only trailing nodes that the client tree did not claim.
    const used = state.pointers.get(el) || 0;
    for (let i = el.childNodes.length - 1; i >= used; i--) {
        const child = el.childNodes[i];
        if (child && child.nodeType === 1 && (child.hasAttribute && child.hasAttribute('data-aziz-server'))) continue;
        if (child && child.nodeType === 3 && !String(child.textContent || '').trim()) {
            el.removeChild(child);
            continue;
        }
        if (child) el.removeChild(child);
    }
}

// Hydrate server-rendered markup. Throws the same thenables the client
// renderer throws, so the caller can wait and retry.
export function hydratePage(PageComponent, layouts, container, base, props) {
    beginRender(base || 'page');

    let tree = h(PageComponent, props || {});
    for (let i = layouts.length - 1; i >= 0; i--) {
        tree = h(layouts[i], { children: tree });
    }

    const state = { pointers: new Map() };
    hydrateNode(tree, container, state);
    return container;
}

// Let hooks.js materialize context-provider children in scope.
setMaterializer(materialize);

export default { h, render, materialize, Fragment, mountPage, hydratePage, disposeFibers, getFiber };
