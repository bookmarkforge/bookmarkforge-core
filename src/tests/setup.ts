import { vi, beforeAll } from "vitest";
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import "vitest-canvas-mock";
import DOMPurify from "dompurify";

// ─── Mocking conventions ───────────────────────────────────────────
//
// SecurityVault mock MUST include onLock and onUnlock:
//
//   vi.mock("../../services/SecurityVault", () => ({
//     securityVault: {
//       onLock: vi.fn(() => () => {}),
//       onUnlock: vi.fn(() => () => {}),
//       ...other mocks,
//     },
//   }));
//
// Without these, ProviderManager, TTSService, SemanticCacheService,
// VaultIntegration, AgentService, and TaggingService crash at import
// time with `TypeError: X.onLock is not a function`.  The ESLint rule
// `bmf/no-securityvault-mock-without-lock` enforces this automatically
// on every PR (src/tests/**/*.{ts,tsx}).
//
// Crypto-core functions that accept a Uint8Array password CONSUME the
// buffer (zeroize it via zeroPasswordBytes).  Callers must pass a fresh
// copy if the bytes are needed after the call.  See src/utils/crypto-core.ts
// JSDoc for the full ownership contract.

// Wrap @testing-library/react render with MantineProvider.
// Mantine v9 requires `children` as an explicit prop of the props object
// (React.createElement does not auto-promote 3rd-arg children for it).
vi.mock("@testing-library/react", async () => {
  const actual: any = await vi.importActual("@testing-library/react");
  // PERF (2026-09-04): the @mantine/core barrel is ~400 ms of module
  // evaluation, and vitest re-evaluates setup.ts in a fresh registry for
  // EVERY test file. It is imported here — inside the mock factory, which
  // runs only when a test file actually imports @testing-library/react —
  // instead of at setup top level, where pure service/db/crypto files
  // (which never render) paid the barrel cost too.
  // vi.importActual, not bare import(): the factory runs inside the
  // module registry of whichever test file imported RTL, and that file
  // may have vi.mock("@mantine/core") in scope (MantineThemeProvider.test.tsx
  // does) — a bare import() would resolve the MOCK, nesting a fake
  // provider inside the real render wrapper. importActual bypasses mocks.
  const [{ default: React }, { MantineProvider }] = await Promise.all([
    vi.importActual<{ default: typeof import("react") }>("react"),
    vi.importActual<{
      MantineProvider: typeof import("@mantine/core").MantineProvider;
    }>("@mantine/core"),
  ]);
  return {
    ...actual,
    render: (ui: React.ReactElement, options?: any) => {
      return actual.render(
        React.createElement(MantineProvider, {
          defaultColorScheme: "auto",
          children: ui,
        }),
        options,
      );
    },
  };
});
// Disable network firewall globally in tests (individual test files re-enable as needed)
beforeAll(async () => {
  const { setFirewallDisabled } = await import("../utils/networkFirewall");
  setFirewallDisabled(true);
});

// Browser-only mocks are skipped when running under the Node environment (e.g. crypto tests).
if (typeof window !== "undefined") {
  // jsdom does not implement TextEncoder/TextDecoder, so vitest falls back to
  // Node's `util` implementations. Those return Uint8Arrays from Node's realm,
  // which fail `expect.any(Uint8Array)` and TypedArray `toEqual` deep equality
  // (vitest 4 compares against the jsdom-realm global constructor). Re-wrap
  // encode() so its output lives in the same realm as the test globals.
  const NodeTextEncoder = globalThis.TextEncoder;
  if (NodeTextEncoder) {
    class RealmSafeTextEncoder {
      // Node's TextEncoder exposes `encoding`; mirror it for parity.
      get encoding(): string {
        return "utf-8";
      }
      encode(input?: string): Uint8Array {
        const bytes = new NodeTextEncoder().encode(input ?? "");
        const out = new Uint8Array(bytes.byteLength);
        out.set(bytes);
        return out;
      }
      encodeInto(
        input: string,
        dest: Uint8Array,
      ): { read: number; written: number } {
        return new NodeTextEncoder().encodeInto(input, dest);
      }
    }
    globalThis.TextEncoder = RealmSafeTextEncoder as unknown as typeof TextEncoder;
  }

  // Mock IntersectionObserver
  const IntersectionObserverMock = vi.fn().mockImplementation(function () {
    return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
  });
  vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);

  // Mock localStorage
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: any) => {
        store[key] = value.toString();
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };
  })();

  Object.defineProperty(window, "localStorage", { value: localStorageMock });

  // Mock Worker
  class WorkerMock {
    onmessage: any = null;
    onerror: any = null;
    onmessageerror: any = null;
    postMessage(_message: any, _options?: any) {}
    terminate() {}
    addEventListener(_type: string, _listener: any, _options?: any) {}
    removeEventListener(_type: string, _listener: any, _options?: any) {}
    dispatchEvent(_event: Event): boolean {
      return true;
    }
  }
  window.Worker = WorkerMock as any;

  // Mock matchMedia (needed by responsive components and Mantine)
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  });

  // Mock ResizeObserver (needed by virtual lists and charts)
  class ResizeObserverMock {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  window.ResizeObserver = ResizeObserverMock as any;

  // Mock scrollTo
  window.scrollTo = vi.fn() as any;
  Element.prototype.scrollIntoView = vi.fn() as any;

  // ─── Blob object URLs (jsdom 30 × vitest 4.1) ───────────────────────
  // vitest's jsdom environment unwraps a jsdom Blob through the "impl"
  // symbol it captured from `new window.Blob()` when the environment was
  // created. jsdom 30 no longer stores blob bytes on an own symbol
  // property at all (a Blob has ZERO own symbols — verified with a probe),
  // so that captured symbol is `undefined` and the compat shim dereferences
  // `blob[undefined]._buffer`, throwing
  // `TypeError: Cannot read properties of undefined (reading '_buffer')`
  // on EVERY `URL.createObjectURL(new Blob(...))` call.
  //
  // Every download-by-blob flow calls createObjectURL before window.open, so
  // the crash landed ahead of the assertion those specs exist for: they
  // failed with "expected window.open to be called" and — worse — reported it
  // as an unhandled error, so the flow was not exercised at all. Owning both
  // functions here keeps specs independent of jsdom/vitest internals and
  // makes the contract observable: URLs are distinct per call, and the
  // registry lets a test read back the blob a URL points at
  // (`(globalThis as any).__bmfBlobUrls`).
  //
  // KNOWN REMAINING LANDMINE (same shim, other entry point): constructing
  // `new Request(url, { body: <Blob> })` in this environment throws the same
  // `_buffer` TypeError (`makeCompatFormData` hits it too for a Blob inside a
  // FormData). No spec reaches it today — production only builds a Request
  // inside `firewalledFetch`, and every test there mocks `fetch` — so it is
  // left alone rather than shimmed speculatively. If a spec ever needs a blob
  // upload body, patch `Request` here the same way `URL` is patched below.
  const blobUrls = new Map<string, Blob | MediaSource>();
  let blobUrlSeq = 0;
  // `writable`/`configurable` keep `vi.spyOn(URL, "createObjectURL")` workable
  // (specs that assert a specific sequence of URLs mock it themselves).
  Object.defineProperty(URL, "createObjectURL", {
    writable: true,
    configurable: true,
    // Mirrors the DOM signature (`Blob | MediaSource`) — ObjectUrlRegistry
    // accepts a MediaSource too, so the stub must not narrow it.
    value: (value: Blob | MediaSource): string => {
      const url = `blob:bmf-test-${++blobUrlSeq}`;
      blobUrls.set(url, value);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    writable: true,
    configurable: true,
    value: (url: string): void => {
      blobUrls.delete(url);
    },
  });
  (
    globalThis as { __bmfBlobUrls?: Map<string, Blob | MediaSource> }
  ).__bmfBlobUrls = blobUrls;

  // Mock requestAnimationFrame
  window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    return setTimeout(() => cb(performance.now()), 0) as unknown as number;
  });
  window.cancelAnimationFrame = vi.fn((id: number) => clearTimeout(id));

  // Polyfill PromiseRejectionEvent (not implemented in happy-dom)
  if (typeof PromiseRejectionEvent === 'undefined') {
    class PromiseRejectionEventMock extends Event {
      promise: Promise<any>;
      reason: any;
      constructor(type: string, opts: { promise: Promise<any>; reason?: any }) {
        super(type);
        this.promise = opts.promise;
        this.reason = opts.reason;
      }
    }
    (window as any).PromiseRejectionEvent = PromiseRejectionEventMock;
  }

  // Ensure navigator.clipboard is available
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  }

  // PERF: The DOMPurify wrapper below is used in Linux CI but has been
  // observed to cause test failures on Windows (happy-dom teardown races
  // with the regex-heavy wrapper). Since the wrapper only adds an
  // additional stripDisallowedTags/stripDisallowedAttrs pass on top of
  // DOMPurify's own sanitize, skipping it on Windows does not reduce
  // security coverage — DOMPurify still runs unchanged. We skip the
  // wrapper entirely on win32 so SanitizationService can be re-integrated
  // into the Windows test suite.
  if (typeof process !== "undefined" && process.platform !== "win32") {
    const origSanitize = DOMPurify.sanitize.bind(DOMPurify);
    const stripDisallowedTags = (html: string, allowed: Set<string>): string => {
      let result = html;
      // IMPORTANT: [^><]* stops at < or > so nested tags are not consumed as
      // attributes (e.g. <scr<script>  must NOT consume <script> as attribute).
      const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^><]*>/g;
      const disallowed = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(result)) !== null) {
        const tag = m[1]!.toLowerCase();
        if (!m[0]!.startsWith('</') && !allowed.has(tag)) {
          disallowed.add(tag);
        }
      }
      const hasBodyWrap = disallowed.has('body') && result.startsWith('<body>') && result.endsWith('</body>');
      if (hasBodyWrap) {
        disallowed.delete('body');
        result = result.slice(6, -7).trim();
      }
      for (const tag of disallowed) {
        const re = new RegExp(`<${tag}\\b[^>]*>(?:[\\s\\S]*?<\\/${tag}>)?|<${tag}\\b[^>]*\\/?>`, 'gi');
        result = result.replace(re, '');
      }
      // Nested bypass fix: banned tag fragments that recombine after stripping
      // e.g. "<scr<script>ipt>" → strip "<script>" → "<scr"+"ipt>" = "<script>"
      for (const tag of disallowed) {
        const recombined = tag.length > 1
          ? new RegExp(`<${tag.slice(0, 1)}\\s*${tag.slice(1)}>`, 'gi')
          : null;
        if (recombined) {
          result = result.replace(recombined, (match) => {
            if (allowed.has(tag)) return match;
            return `<${tag.slice(0, -1)}>`;
          });
        }
      }
      return result;
    };
    const stripDisallowedAttrs = (html: string, allowed: Set<string>): string => {
      const attrRe = /\s+([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g;
      return html.replace(attrRe, (match, attrName: string) => {
        if (!allowed.has(attrName.toLowerCase())) return '';
        return match;
      });
    };
    DOMPurify.sanitize = ((input: any, config?: any) => {
      const strInput = typeof input === 'string' ? input : String(input);
      const cfg = config || {};
      const allowedTags = cfg.ALLOWED_TAGS
        ? new Set((cfg.ALLOWED_TAGS as string[]).map((t: string) => t.toLowerCase()))
        : null;
      const allowedAttrs = cfg.ALLOWED_ATTR
        ? new Set((cfg.ALLOWED_ATTR as string[]).map((a: string) => a.toLowerCase()))
        : null;
      let result = strInput;
      if (allowedTags) result = stripDisallowedTags(result, allowedTags);
      if (allowedAttrs) result = stripDisallowedAttrs(result, allowedAttrs);
      return origSanitize(result, config);
    }) as typeof DOMPurify.sanitize;
  }
}
