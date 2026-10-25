// ============================================================
//  Aziz.js — global type declarations
//
//  The framework exposes its hooks and router as globals, so a .tsx
//  page needs no imports at all:
//
//      export default function Page() {
//          const [count, setCount] = useState(0);
//          return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
//      }
//
//  These declarations give those globals a type. Enable checking with:
//
//      npm i -D typescript
//      npm run typecheck
//
//  Types are always stripped at build time; this file only makes
//  `tsc --noEmit` meaningful.
// ============================================================

// ─── Context ──────────────────────────────────────────────────

interface AzizContext<T> {
    Provider(props: { value: T; children?: unknown }): unknown;
    _defaultValue: T;
}

// ─── Hooks ────────────────────────────────────────────────────

declare function useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void];

declare function useReducer<S, A>(
    reducer: (state: S, action: A) => S,
    initialState: S,
    init?: (arg: S) => S
): [S, (action: A) => void];

declare function useEffect(callback: () => void | (() => void), deps?: readonly unknown[]): void;

declare function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;

declare function useCallback<T extends (...args: any[]) => any>(fn: T, deps?: readonly unknown[]): T;

declare function useRef<T>(initial: T): { current: T };

declare function createContext<T>(defaultValue: T): AzizContext<T>;

declare function useContext<T>(ctx: AzizContext<T>): T;

declare function useLocalStorage<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void];

interface AzizFetchState<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    status: number | null;
    refetch: () => void;
}

declare function useFetch<T = any>(
    url: string | null,
    options?: RequestInit & { force?: boolean }
): AzizFetchState<T>;

declare const useApi: typeof useFetch;

declare function clearFetchCache(): void;

declare function onLoadState(fn: (pending: number) => void): () => void;

declare function getPendingLoads(): number;

// ─── Data with Suspense ───────────────────────────────────────

interface AzizResource<T> {
    read(): T;
}

declare function createResource<T>(
    source: T | Promise<T> | (() => T | Promise<T>)
): AzizResource<T>;

declare function fetchResource<T = any>(url: string, options?: RequestInit): AzizResource<T>;

declare function use<T>(resource: AzizResource<T> | Promise<T> | T): T;

// ─── Navigation ───────────────────────────────────────────────

interface AzizNavigateOptions {
    replace?: boolean;
    scroll?: boolean;
}

interface AzizRouter {
    pathname: string;
    locale: string | null;
    params: Record<string, string>;
    push(path: string, options?: AzizNavigateOptions): void;
    replace(path: string, options?: AzizNavigateOptions): void;
    back(): void;
    forward(): void;
    refresh(): void;
    prefetch(path: string): void;
}

declare function navigate(path: string, options?: AzizNavigateOptions): void;
declare function replace(path: string, options?: AzizNavigateOptions): void;
declare function back(): void;
declare function forward(): void;
declare function refresh(): void;
declare function redirect(url: string, options?: { status?: number }): void;
declare function notFound(): void;
declare function prefetch(path: string): void;

declare function useRouter(): AzizRouter;

declare function useParams<T extends Record<string, string> = Record<string, string>>(): T;

declare function usePathname(): string;

declare function useLocale(): string | null;

declare function useNavigation(): AzizRouter & { isPending: boolean; state: string };

declare function useTransition(): [
    boolean,
    <T>(callback: () => T | Promise<T>) => T | Promise<T>
];

interface AzizSearchParams {
    get(key: string): string | null;
    getAll(key: string): string[];
    has(key: string): boolean;
    entries(): IterableIterator<[string, string]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    forEach(callback: (value: string, key: string) => void): void;
    toString(): string;
}

declare function useSearchParams(): AzizSearchParams;

// ─── Components ───────────────────────────────────────────────

declare const Fragment: unique symbol;

declare function h(
    tag: string | ((props: any) => unknown),
    props?: any,
    ...children: unknown[]
): any;

declare function Suspense(props: { children?: unknown; fallback?: unknown }): any;

interface AzizImageProps {
    src: string;
    alt?: string;
    width?: number | string;
    height?: number | string;
    sizes?: string;
    quality?: number;
    format?: 'auto' | 'avif' | 'webp' | 'png' | 'jpeg';
    priority?: boolean;
    fill?: boolean;
    className?: string;
    class?: string;
    style?: Record<string, string | number>;
    widths?: number[];
    [key: string]: any;
}

declare function Image(props: AzizImageProps): any;

interface AzizFontProps {
    family: string;
    href?: string;
    weight?: string | number;
    style?: string;
    display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
    preload?: boolean;
    sizeAdjust?: string;
}

declare function Font(props: AzizFontProps): any;

interface AzizScriptProps {
    src?: string;
    children?: string;
    strategy?: 'beforeInteractive' | 'afterInteractive' | 'lazy';
    [key: string]: any;
}

declare function Script(props: AzizScriptProps): any;

declare function Link(props: {
    href: string;
    children?: unknown;
    className?: string;
    class?: string;
    style?: Record<string, string | number>;
    onClick?: (event: any) => void;
    replace?: boolean;
    scroll?: boolean;
    prefetch?: boolean;
    [key: string]: any;
}): any;

// ─── API client ───────────────────────────────────────────────

interface AzizApiOptions extends RequestInit {
    raw?: boolean;
}

declare const api: {
    get<T = any>(path: string, options?: AzizApiOptions): Promise<T>;
    post<T = any>(path: string, body?: unknown, options?: AzizApiOptions): Promise<T>;
    put<T = any>(path: string, body?: unknown, options?: AzizApiOptions): Promise<T>;
    patch<T = any>(path: string, body?: unknown, options?: AzizApiOptions): Promise<T>;
    delete<T = any>(path: string, options?: AzizApiOptions): Promise<T>;
    del<T = any>(path: string, options?: AzizApiOptions): Promise<T>;
    head<T = any>(path: string, options?: AzizApiOptions): Promise<T>;
    form<T = any>(path: string, formData: FormData, options?: AzizApiOptions): Promise<T>;
    raw<T = any>(path: string, options?: AzizApiOptions): Promise<Response>;
    request<T = any>(path: string, options?: AzizApiOptions): Promise<T>;
    setBaseURL(baseURL: string): typeof api;
    setHeaders(headers: Record<string, string>): typeof api;
    configure(options: { baseURL?: string; timeout?: number; retries?: number; headers?: Record<string, string> }): typeof api;
};

// ─── JSX ──────────────────────────────────────────────────────
//
// The runtime compiles JSX to h() calls with the classic runtime,
// so elements are plain values and tags are strings.

declare namespace JSX {
    type Element = any;
    interface ElementChildrenAttribute {
        children: {};
    }
    interface IntrinsicElements {
        [tag: string]: any;
    }
}
