import { vi } from 'vitest';

// Load the REAL shared capture-url module instead of a hand-rolled mock:
// extension tests must exercise the same buildCaptureUrl / isValidBaseUrl
// code that ships (previously the mock could drift from the implementation
// and the validation helpers did not exist in it at all).
import "../capture-url.js";

const storageStore = new Map<string, unknown>();
const testGlobal = globalThis as unknown as {
  BookmarkForgeCaptureUrl: {
    buildCaptureUrl: (baseUrl: string, values: { url?: string; title?: string; text?: string }) => string;
    createBookmarklet: (baseUrl: string) => string;
    normalizeBaseUrl: (baseUrl: string) => string;
    isValidBaseUrl: (value: string) => boolean;
  };
  importScripts: ReturnType<typeof vi.fn>;
  chrome: Record<string, unknown>;
};

testGlobal.importScripts = vi.fn();

testGlobal.chrome = {
  contextMenus: {
    create: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    create: vi.fn(),
    query: vi.fn(),
  },
  runtime: {
    onInstalled: {
      addListener: vi.fn(),
    },
    id: 'test-extension-id',
  },
  storage: {
    sync: {
      get: vi.fn(
        (keys: string | string[] | null) => {
          if (typeof keys === "string") {
            return Promise.resolve({
              [keys]: storageStore.get(keys) ?? undefined,
            });
          }
          if (Array.isArray(keys)) {
            const result: Record<string, unknown> = {};
            for (const k of keys) {
              result[k] = storageStore.get(k) ?? undefined;
            }
            return Promise.resolve(result);
          }
          // null/undefined → return all
          const result: Record<string, unknown> = {};
          for (const [k, v] of storageStore) {
            result[k] = v;
          }
          return Promise.resolve(result);
        },
      ),
      set: vi.fn((items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) {
          storageStore.set(k, v);
        }
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) storageStore.delete(k);
        return Promise.resolve();
      }),
      clear: vi.fn(() => {
        storageStore.clear();
        return Promise.resolve();
      }),
    },
  },
};
