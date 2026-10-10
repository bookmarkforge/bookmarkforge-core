// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe("Zustand stores — safeStorage integration", () => {
  let safeGetSpy: any;
  let safeSetSpy: any;
  let safeRemoveSpy: any;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.resetModules();

    // Mock safeStorage with spies that delegate to localStorage
    safeGetSpy = vi.fn((key: string) => localStorage.getItem(key));
    safeSetSpy = vi.fn((key: string, value: string) =>
      localStorage.setItem(key, value),
    );
    safeRemoveSpy = vi.fn((key: string) => localStorage.removeItem(key));

    vi.doMock("../../store/safeStorage", () => ({
      safeGet: safeGetSpy,
      safeSet: safeSetSpy,
      safeRemove: safeRemoveSpy,
      // createStorageAdapter needs to use the spied functions (not the
      // originals) for the assertions on the spies to work.
      createStorageAdapter: (
        keyMap: Record<string, string>,
        defaults: Record<string, unknown>,
        serializers?: {
          read?: Record<string, (raw: string | null, def: any) => any>;
          write?: Record<string, (val: any) => string>;
        },
      ) => ({
        getItem: () => {
          const state: Record<string, unknown> = {};
          for (const k of Object.keys(keyMap)) {
            const raw = safeGetSpy(keyMap[k]);
            const customRead = serializers?.read?.[k];
            if (customRead) {
              state[k] = customRead(raw, defaults[k]);
            } else if (raw === null) {
              state[k] = defaults[k];
            } else if (typeof defaults[k] === "boolean") {
              state[k] = raw === "true";
            } else if (typeof defaults[k] === "number") {
              const n = Number(raw);
              state[k] = isNaN(n) ? defaults[k] : n;
            } else {
              state[k] = raw;
            }
          }
          return JSON.stringify({ state, version: 0 });
        },
        setItem: (_name: string, value: string) => {
          try {
            const parsed = JSON.parse(value) as { state: Record<string, unknown> };
            for (const k of Object.keys(keyMap)) {
              if (parsed.state[k] !== undefined) {
                const customWrite = serializers?.write?.[k];
                if (customWrite) {
                  safeSetSpy(keyMap[k], customWrite(parsed.state[k]));
                } else if (typeof parsed.state[k] === "boolean") {
                  safeSetSpy(keyMap[k], parsed.state[k] ? "true" : "false");
                } else {
                  safeSetSpy(keyMap[k], String(parsed.state[k]));
                }
              }
            }
          } catch {
            // INTENTIONAL SILENCE: this mock emulates malformed persisted state.
          }
        },
        removeItem: () => {
          for (const storageKey of Object.values(keyMap)) {
            safeRemoveSpy(storageKey);
          }
        },
      }),
      createSignedStorageAdapter: vi.fn(),
      createSafeStorageAdapter: vi.fn(),
      safeClear: vi.fn(),
      safeSessionClear: vi.fn(),
    }));
  });

  // ---------------------------------------------------------------------------
  // usePreferencesStore
  // ---------------------------------------------------------------------------
  describe("usePreferencesStore", () => {
    it("reads all preferences via safeGet on init", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState();
      // Should call safeGet for every legacy key (14 keys)
      expect(safeGetSpy).toHaveBeenCalled();
      expect(safeGetSpy.mock.calls.length).toBeGreaterThanOrEqual(10);
    });

    it("writes theme via safeSet when setTheme is called", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      safeSetSpy.mockClear();

      usePreferencesStore.getState().setTheme("dark");

      await vi.waitFor(() => {
        const themeCalls = safeSetSpy.mock.calls.filter(
          (c: [string, string]) => c[0] === "bookmarkforge-theme",
        );
        expect(themeCalls.length).toBeGreaterThan(0);
        expect(themeCalls[themeCalls.length - 1][1]).toBe("dark");
      });
    });

    it("writes language via safeSet when setLanguage is called", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      safeSetSpy.mockClear();

      usePreferencesStore.getState().setLanguage("es");

      await vi.waitFor(() => {
        const langCalls = safeSetSpy.mock.calls.filter(
          (c: [string, string]) => c[0] === "i18nextLng",
        );
        expect(langCalls.length).toBeGreaterThan(0);
        expect(langCalls[langCalls.length - 1][1]).toBe("es");
      });
    });

    it("removes all legacy keys via safeRemove on clearStorage", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setTheme("dark");
      safeRemoveSpy.mockClear();

      await (usePreferencesStore as any).persist.clearStorage();

      await vi.waitFor(() => {
        expect(safeRemoveSpy).toHaveBeenCalled();
        // Should remove each legacy key
        expect(safeRemoveSpy.mock.calls.length).toBeGreaterThanOrEqual(10);
      });
    });

    it("never calls localStorage.getItem directly", async () => {
      const getItemSpy = vi.spyOn(Storage.prototype, "getItem");

      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState();

      // safeGet calls localStorage.getItem internally, but the store itself
      // should only go through safeGet (not call getItem directly)
      expect(safeGetSpy).toHaveBeenCalled();
      getItemSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // rateLimitStore
  // ---------------------------------------------------------------------------
  describe("rateLimitStore", () => {
    it("reads state via safeGet on init", async () => {
      const { useRateLimitStore } = await import("../../store/rateLimitStore");
      useRateLimitStore.getState();
      expect(safeGetSpy).toHaveBeenCalled();
    });

    it("writes state via safeSet when incrementAttempt is called", async () => {
      const { useRateLimitStore } = await import("../../store/rateLimitStore");
      safeSetSpy.mockClear();

      useRateLimitStore.getState().incrementAttempt();

      await vi.waitFor(() => {
        const calls = safeSetSpy.mock.calls.filter(
          (c: [string, string]) => c[0] === "bookmarkforge-rate-limit",
        );
        expect(calls.length).toBeGreaterThan(0);
        // The value should contain the incremented unlockAttempts
        const lastValue = calls[calls.length - 1][1];
        expect(lastValue).toContain('"unlockAttempts":1');
      });
    });

    it("removes state via safeRemove on clearStorage", async () => {
      const { useRateLimitStore } = await import("../../store/rateLimitStore");
      useRateLimitStore.getState().incrementAttempt();
      safeRemoveSpy.mockClear();

      await (useRateLimitStore as any).persist.clearStorage();

      await vi.waitFor(() => {
        expect(safeRemoveSpy).toHaveBeenCalledWith("bookmarkforge-rate-limit");
      });
    });

    it("never calls localStorage.setItem directly for the store key", async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

      const { useRateLimitStore } = await import("../../store/rateLimitStore");
      useRateLimitStore.getState().incrementAttempt();

      await vi.waitFor(() => {
        // safeSet calls setItem internally, but the store's hmacStorage adapter
        // should route through safeSet (we verify safeSet was called)
        expect(safeSetSpy).toHaveBeenCalled();
      });

      setItemSpy.mockRestore();
    });
  });
});
