// Minimal DOM implementation — just enough to exercise the Aziz.js
// runtime and hooks in Node (no jsdom dependency).

class Node {
    constructor(tagName) {
        this.tagName = tagName;
        this.childNodes = [];
        this.attributes = {};
        this.style = {};
        this._listeners = {};
        this.parentNode = null;
        this._className = '';
        this._html = '';
        this.value = '';
        this.checked = false;
    }

    appendChild(child) {
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }

    removeChild(child) {
        const i = this.childNodes.indexOf(child);
        if (i !== -1) this.childNodes.splice(i, 1);
        child.parentNode = null;
        return child;
    }

    replaceChild(newChild, oldChild) {
        const i = this.childNodes.indexOf(oldChild);
        if (i === -1) throw new Error('replaceChild: node is not a child');
        this.childNodes[i] = newChild;
        newChild.parentNode = this;
        oldChild.parentNode = null;
        return oldChild;
    }

    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
    hasAttribute(name) { return name in this.attributes; }
    removeAttribute(name) { delete this.attributes[name]; }

    addEventListener(type, fn) {
        (this._listeners[type] = this._listeners[type] || []).push(fn);
    }
    removeEventListener(type, fn) {
        const list = this._listeners[type];
        if (!list) return;
        const i = list.indexOf(fn);
        if (i !== -1) list.splice(i, 1);
    }
    dispatch(type, event = {}) {
        (this._listeners[type] || []).forEach(fn => fn({ ...event, target: this }));
    }

    querySelector() { return null; }
    focus() {}
    get nodeType() { return this.tagName === '#text' ? 3 : 1; }
    get firstChild() { return this.childNodes[0] || null; }
    get className() { return this._className; }
    set className(v) { this._className = v; }
    get innerHTML() { return this._html; }
    set innerHTML(v) { this._html = v; if (v === '') this.childNodes = []; }
    get textContent() {
        if (this.tagName === '#text') return this.text;
        return this.childNodes.map(c => c.textContent).join('');
    }
    set textContent(v) {
        if (this.tagName === '#text') {
            this.text = String(v);
        } else {
            this.childNodes = [new TextNode(String(v))];
        }
    }
}

class TextNode extends Node {
    constructor(text) {
        super('#text');
        this.text = text;
    }
}

function installDOM() {
    const elements = new Map();

    const document = {
        _elements: elements,
        createElement(tag) {
            const el = new Node(tag);
            elements.set(el, true);
            return el;
        },
        createTextNode(text) { return new TextNode(String(text)); },
        body: new Node('body'),
        head: new Node('head'),
        activeElement: null,
        title: '',
        querySelector() { return null },
        getElementById() { return null },
        addEventListener() {},
        removeEventListener() {},
    };

    globalThis.Node = Node;
    globalThis.document = document;

    if (!globalThis.window) globalThis.window = {};
    globalThis.window.document = document;

    return { document, Node, TextNode };
}

module.exports = { installDOM, Node, TextNode };
