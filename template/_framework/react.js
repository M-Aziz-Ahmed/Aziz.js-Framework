// ============================================================
//  Aziz.js — React-compatible import surface
//
//  Lets components written for Next.js keep familiar imports:
//
//      import React, { useState } from 'react';
//
//  The hooks are the same functions boot.js exposes globally, so
//  they operate on the framework's fiber state.
// ============================================================

import {
    useState,
    useReducer,
    useEffect,
    useMemo,
    useCallback,
    useRef,
    useContext,
    createContext,
    useLocalStorage,
    useFetch,
} from '/_framework/hooks.js';
import { h, Fragment } from '/_framework/runtime.js';

const createElement = h;

// React.memo is an optimization hint; rendering without it is correct.
const memo = component => component;

// The framework has no ref forwarding, but accepting the ref argument
// keeps component signatures compatible.
const forwardRef = render => {
    const Forwarded = props => render(props, null);
    Forwarded.displayName = 'Forwarded';
    return Forwarded;
};

function jsx(type, props, key) {
    if (key === undefined) return h(type, props);
    return h(type, { ...props, key });
}

const jsxs = jsx;
const jsxDEV = jsx;

const React = {
    createElement,
    Fragment,
    useState,
    useReducer,
    useEffect,
    useMemo,
    useCallback,
    useRef,
    useContext,
    createContext,
    useLocalStorage,
    useFetch,
    memo,
    forwardRef,
};

export {
    createElement,
    Fragment,
    useState,
    useReducer,
    useEffect,
    useMemo,
    useCallback,
    useRef,
    useContext,
    createContext,
    useLocalStorage,
    useFetch,
    memo,
    forwardRef,
    jsx,
    jsxs,
    jsxDEV,
};

export default React;
