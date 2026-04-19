// ============================================================
//  Aziz.js Runtime
//  h() — JSX factory (like React.createElement)
//  render() — mount component tree to DOM
// ============================================================

export const Fragment = Symbol('Fragment');

// JSX factory — Babel compiles <div> → h("div", props, ...children)
export function h(tag, props, ...children) {
    // Fragment: just return children
    if (tag === Fragment) {
        return flatChildren(children);
    }

    // Component function
    if (typeof tag === 'function') {
        return tag({ ...(props || {}), children: flatChildren(children) });
    }

    const el = document.createElement(tag);

    if (props) {
        for (const key in props) {
            if (key === 'children') continue;

            if (key === 'ref' && props[key] && typeof props[key] === 'object') {
                // useRef support
                props[key].current = el;
            } else if (key.startsWith('on')) {
                // onClick → click
                el.addEventListener(key.slice(2).toLowerCase(), props[key]);
            } else if (key === 'className' || key === 'class') {
                el.className = props[key];
            } else if (key === 'htmlFor') {
                el.setAttribute('for', props[key]);
            } else if (key === 'style' && typeof props[key] === 'object') {
                Object.assign(el.style, props[key]);
            } else if (key === 'dangerouslySetInnerHTML') {
                el.innerHTML = props[key].__html;
            } else if (key === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
                el.value = props[key];
            } else if (key === 'checked' && tag === 'input') {
                el.checked = props[key];
            } else if (key === 'disabled') {
                if (props[key]) el.setAttribute('disabled', '');
            } else if (key === 'key') {
                // ignore reconciliation key for now
            } else {
                el.setAttribute(key, props[key]);
            }
        }
    }

    appendChildren(el, flatChildren(children));
    return el;
}

function flatChildren(children) {
    return children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false && c !== true);
}

function appendChildren(parent, children) {
    for (const child of children) {
        if (child instanceof Node) {
            parent.appendChild(child);
        } else if (Array.isArray(child)) {
            appendChildren(parent, child);
        } else {
            parent.appendChild(document.createTextNode(String(child)));
        }
    }
}

// Mount a component tree into a DOM element
export function render(component, container) {
    container.innerHTML = '';
    const result = typeof component === 'function' ? component() : component;
    if (Array.isArray(result)) {
        appendChildren(container, result);
    } else if (result instanceof Node) {
        container.appendChild(result);
    }
}

export default { h, render, Fragment };
