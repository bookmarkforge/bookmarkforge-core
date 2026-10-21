import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useFocusTrap } from "../../hooks/useFocusTrap";

// Keep the real implementation available for the full-chain degradation
// section; runtime doMock() calls below still override it per test.
vi.unmock("../../store/safeStorage");

// Mock react-router for useTabManager
vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/editor" }),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Part 1: safeStorage-level — verify safeGet/safeSet/safeRemove never propagate
//          errors thrown by the underlying localStorage
// ---------------------------------------------------------------------------
describe("safeStorage — never throws to callers", () => {
  let originalGetItem: typeof Storage.prototype.getItem;
  let originalSetItem: typeof Storage.prototype.setItem;
  let originalRemoveItem: typeof Storage.prototype.removeItem;

  beforeEach(() => {
    originalGetItem = Storage.prototype.getItem;
    originalSetItem = Storage.prototype.setItem;
    originalRemoveItem = Storage.prototype.removeItem;
    vi.resetModules();
  });

  afterEach(() => {
    Storage.prototype.getItem = originalGetItem;
    Storage.prototype.setItem = originalSetItem;
    Storage.prototype.removeItem = originalRemoveItem;
  });

  it("safeGet returns null when localStorage.getItem throws QuotaExceededError", async () => {
    Storage.prototype.getItem = () => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    };
    const { safeGet } = await import("../../store/safeStorage");
    expect(() => safeGet("any-key")).not.toThrow();
    expect(safeGet("any-key")).toBeNull();
  });

  it("safeGet returns null when localStorage.getItem throws SecurityError", async () => {
    Storage.prototype.getItem = () => {
      throw new DOMException("SecurityError", "SecurityError");
    };
    const { safeGet } = await import("../../store/safeStorage");
    expect(() => safeGet("any-key")).not.toThrow();
    expect(safeGet("any-key")).toBeNull();
  });

  it("safeSet does not throw when localStorage.setItem throws QuotaExceededError", async () => {
    Storage.prototype.setItem = () => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    };
    const { safeSet } = await import("../../store/safeStorage");
    expect(() => safeSet("k", "v")).not.toThrow();
  });

  it("safeSet does not throw when localStorage.setItem throws SecurityError", async () => {
    Storage.prototype.setItem = () => {
      throw new DOMException("SecurityError", "SecurityError");
    };
    const { safeSet } = await import("../../store/safeStorage");
    expect(() => safeSet("k", "v")).not.toThrow();
  });

  it("safeSet does not throw when localStorage.setItem throws Error (generic)", async () => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage is full");
    };
    const { safeSet } = await import("../../store/safeStorage");
    expect(() => safeSet("k", "v")).not.toThrow();
  });

  it("safeRemove does not throw when localStorage.removeItem throws SecurityError", async () => {
    Storage.prototype.removeItem = () => {
      throw new DOMException("SecurityError", "SecurityError");
    };
    const { safeRemove } = await import("../../store/safeStorage");
    expect(() => safeRemove("any-key")).not.toThrow();
  });

  it("safeRemove does not throw when localStorage.removeItem throws Error (generic)", async () => {
    Storage.prototype.removeItem = () => {
      throw new Error("Cannot remove");
    };
    const { safeRemove } = await import("../../store/safeStorage");
    expect(() => safeRemove("any-key")).not.toThrow();
  });

  it("safeGet works normally when localStorage is available", async () => {
    Storage.prototype.getItem = originalGetItem;
    localStorage.setItem("normal-key", "normal-value");
    const { safeGet } = await import("../../store/safeStorage");
    expect(safeGet("normal-key")).toBe("normal-value");
  });

  it("safeSet works normally when localStorage is available", async () => {
    const { safeSet } = await import("../../store/safeStorage");
    safeSet("set-key", "set-value");
    expect(localStorage.getItem("set-key")).toBe("set-value");
  });

  it("safeRemove works normally when localStorage is available", async () => {
    localStorage.setItem("rm-key", "rm-value");
    const { safeRemove } = await import("../../store/safeStorage");
    safeRemove("rm-key");
    expect(localStorage.getItem("rm-key")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Part 2: Hook-level — when safeGet returns null (storage unavailable),
//          hooks use initial/fallback values and all operations work in-memory
// ---------------------------------------------------------------------------
describe("hooks — graceful degradation when storage returns null", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.resetModules();
    // Mock safeGet to return null (simulating private browsing / storage blocked)
    // safeSet and safeRemove are no-ops (they silently succeed)
    vi.doMock("../../store/safeStorage", () => ({
      safeGet: () => null,
      safeGetJSON: () => null,
      safeSet: vi.fn(),
      safeRemove: vi.fn(),
    }));
  });

  // --- useTabManager ---
  describe("useTabManager", () => {
    it("returns default doc ID when safeGet returns null", async () => {
      const { useTabManager } = await import("../../hooks/useTabManager");
      const { result } = renderHook(() => useTabManager());
      expect(result.current.currentDocId).toBe("doc-1");
    });

    it("updates doc ID in memory when storage is unavailable", async () => {
      const { useTabManager } = await import("../../hooks/useTabManager");
      const { result } = renderHook(() => useTabManager());

      act(() => {
        result.current.setCurrentDocId("new-doc-42");
      });

      expect(result.current.currentDocId).toBe("new-doc-42");
    });
  });

  // --- useDatabaseInit ---
  describe("useDatabaseInit", () => {
    it("reports hasPwd as false when safeGet returns null", async () => {
      // Mock dependencies that useDatabaseInit needs
      vi.doMock("../../db/database", () => ({
        initDB: vi.fn().mockResolvedValue({}),
        getDB: vi.fn().mockResolvedValue(null),
      }));
      vi.doMock("../../services/SecurityVault", () => ({
        securityVault: {
          hasMasterPassword: vi.fn().mockResolvedValue(false),
        },
      }));
      vi.doMock("../../hooks/useSecurityStore", () => ({
        useSecurityStore: vi.fn().mockReturnValue({
          isLocked: true,
          forceSetup: false,
        }),
      }));

      const { useDatabaseInit } = await import("../../hooks/useDatabaseInit");
      const { result } = renderHook(() => useDatabaseInit());

      // hasPwd should be false when safeGet('forge_has_master_password') returns null
      expect(result.current.hasPwd).toBe(false);
    });

    it("does not initialize db when locked without password", async () => {
      vi.doMock("../../db/database", () => ({
        initDB: vi.fn().mockResolvedValue({ id: "mock-db" }),
        getDB: vi.fn().mockResolvedValue(null),
      }));
      vi.doMock("../../services/SecurityVault", () => ({
        securityVault: {
          hasMasterPassword: vi.fn().mockResolvedValue(false),
        },
      }));
      vi.doMock("../../hooks/useSecurityStore", () => ({
        useSecurityStore: vi.fn().mockReturnValue({
          isLocked: true,
          forceSetup: false,
        }),
      }));

      const { useDatabaseInit } = await import("../../hooks/useDatabaseInit");
      const { result } = renderHook(() => useDatabaseInit());

      expect(result.current.hasPwd).toBe(false);
      expect(result.current.db).toBeNull();
      expect(result.current.dbError).toBeNull();
      expect((await import("../../db/database")).initDB).not.toHaveBeenCalled();
    });

    it("setMasterPassword works when storage is unavailable", async () => {
      vi.doMock("../../db/database", () => ({
        initDB: vi.fn().mockResolvedValue({ id: "mock-db" }),
        getDB: vi.fn().mockResolvedValue(null),
      }));
      vi.doMock("../../services/SecurityVault", () => ({
        securityVault: {
          hasMasterPassword: vi.fn().mockResolvedValue(false),
        },
      }));
      vi.doMock("../../hooks/useSecurityStore", () => ({
        useSecurityStore: vi.fn().mockReturnValue({
          isLocked: true,
          forceSetup: false,
        }),
      }));

      const { useDatabaseInit } = await import("../../hooks/useDatabaseInit");
      const { result } = renderHook(() => useDatabaseInit());

      act(() => {
        result.current.setMasterPassword("my-secret");
      });
      expect(result.current.masterPassword).toBe("my-secret");
    });
  });
});

// ---------------------------------------------------------------------------
// Part 3: Hook-level — when localStorage is fully blocked (throws on every
//          operation), the entire chain (localStorage → safeStorage → hook)
//          degrades gracefully
// ---------------------------------------------------------------------------
describe("hooks — full chain degradation (localStorage throws)", () => {
  let origGetItem: typeof Storage.prototype.getItem;
  let origSetItem: typeof Storage.prototype.setItem;
  let origRemoveItem: typeof Storage.prototype.removeItem;

  beforeEach(() => {
    origGetItem = Storage.prototype.getItem;
    origSetItem = Storage.prototype.setItem;
    origRemoveItem = Storage.prototype.removeItem;

    const throwQuota = () => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    };

    Storage.prototype.getItem = throwQuota;
    Storage.prototype.setItem = throwQuota;
    Storage.prototype.removeItem = throwQuota;

    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    Storage.prototype.getItem = origGetItem;
    Storage.prototype.setItem = origSetItem;
    Storage.prototype.removeItem = origRemoveItem;
  });

  it("useTabManager initializes and operates when localStorage throws", async () => {
    const { useTabManager } = await import("../../hooks/useTabManager");
    const { result } = renderHook(() => useTabManager());

    expect(result.current.currentDocId).toBe("doc-1");

    act(() => {
      result.current.setCurrentDocId("new-doc");
    });
    expect(result.current.currentDocId).toBe("new-doc");
  });

  it("useDatabaseInit hasPwd is false when localStorage throws", async () => {
    vi.doMock("../../db/database", () => ({
      initDB: vi.fn().mockResolvedValue({}),
      getDB: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("../../services/SecurityVault", () => ({
      securityVault: {
        hasMasterPassword: vi.fn().mockResolvedValue(false),
      },
    }));
    vi.doMock("../../hooks/useSecurityStore", () => ({
      useSecurityStore: vi.fn().mockReturnValue({
        isLocked: true,
        forceSetup: false,
      }),
    }));

    const { useDatabaseInit } = await import("../../hooks/useDatabaseInit");
    const { result } = renderHook(() => useDatabaseInit());

    expect(result.current.hasPwd).toBe(false);
    expect(result.current.dbError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Part 4: Non-storage hooks — robustness & edge-case tests
//          These hooks don't use safeStorage, but we verify they degrade
//          gracefully when called with edge-case inputs, handle cleanup, and
//          don't crash when DOM APIs return unexpected values.
// ---------------------------------------------------------------------------
describe("non-storage hooks — robustness", () => {
  // --- useKeyboardShortcuts ---
  describe("useKeyboardShortcuts", () => {
    it("registers and fires shortcut callbacks on keydown", () => {
      const setShowOmnibar = vi.fn();
      const toggleTheme = vi.fn();
      const setShowSettings = vi.fn();
      const setActiveTab = vi.fn();

      renderHook(() => {
        useKeyboardShortcuts(
          setShowOmnibar,
          toggleTheme,
          setShowSettings,
          setActiveTab,
        );
      });

      // Ctrl+K → toggle omnibar
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
        );
      });
      expect(setShowOmnibar).toHaveBeenCalled();

      // Ctrl+D → toggle theme
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "d", ctrlKey: true }),
        );
      });
      expect(toggleTheme).toHaveBeenCalled();

      // Ctrl+, → toggle settings
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: ",", ctrlKey: true }),
        );
      });
      expect(setShowSettings).toHaveBeenCalled();
    });

    it("cleans up listener on unmount", () => {
      const toggleTheme = vi.fn();
      const { unmount } = renderHook(() => {
        useKeyboardShortcuts(vi.fn(), toggleTheme, vi.fn(), vi.fn());
      });

      unmount();

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "d", ctrlKey: true }),
        );
      });
      expect(toggleTheme).not.toHaveBeenCalled();
    });

    it("maps Ctrl+1-6 to correct tab names", () => {
      const setActiveTab = vi.fn();

      renderHook(() => {
        useKeyboardShortcuts(vi.fn(), vi.fn(), vi.fn(), setActiveTab);
      });

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "3", ctrlKey: true }),
        );
      });
      expect(setActiveTab).toHaveBeenCalledWith("documents");
    });

    it("ignores non-modifier key presses", () => {
      const toggleTheme = vi.fn();

      renderHook(() => {
        useKeyboardShortcuts(vi.fn(), toggleTheme, vi.fn(), vi.fn());
      });

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      });
      expect(toggleTheme).not.toHaveBeenCalled();
    });

    it("handles Cmd key (metaKey) the same as Ctrl", () => {
      const toggleTheme = vi.fn();

      renderHook(() => {
        useKeyboardShortcuts(vi.fn(), toggleTheme, vi.fn(), vi.fn());
      });

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "d", metaKey: true }),
        );
      });
      expect(toggleTheme).toHaveBeenCalled();
    });
  });

  // --- useFocusTrap ---
  describe("useFocusTrap", () => {
    it("returns a ref object", () => {
      const { result } = renderHook(() => useFocusTrap(false));
      expect(result.current).toHaveProperty("current");
    });

    it("does not crash when containerRef.current is null and isActive is true", () => {
      // Container ref is null because no DOM element is attached
      expect(() => {
        renderHook(() => useFocusTrap(true));
      }).not.toThrow();
    });

    it("cleans up keydown listener when deactivated", () => {
      const { rerender } = renderHook(({ active }) => useFocusTrap(active), {
        initialProps: { active: true },
      });

      // Deactivate — the cleanup function should run
      rerender({ active: false });

      // No crash expected
    });

    it("does nothing when inactive (isActive=false)", () => {
      const addSpy = vi.spyOn(document, "addEventListener");
      const countBefore = addSpy.mock.calls.length;

      renderHook(() => useFocusTrap(false));

      // Should not have added any keydown listener for the trap
      const newCalls = addSpy.mock.calls.slice(countBefore);
      const keydownCalls = newCalls.filter((c) => c[0] === "keydown");
      expect(keydownCalls).toHaveLength(0);

      addSpy.mockRestore();
    });
  });

});
