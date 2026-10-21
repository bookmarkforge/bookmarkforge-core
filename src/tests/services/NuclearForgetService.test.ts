import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { securityVault } from "../../services/SecurityVault";
import { NUCLEAR_AUDIT_STORE } from "../../services/NuclearForgetService";
import { clearWASMCache } from "../../utils/wasm-core";

const mockFns = vi.hoisted(() => ({
  lock: vi.fn(),
  isLocked: vi.fn(),
  verifyPasswordRateLimited: vi.fn(),
  // SemanticCacheService subscribes to vault transitions at module scope;
  // the mock must return unsubscribe functions or the dynamic import in
  // NuclearForgetService (step 5b) throws and the target lands in failed[].
  onLock: vi.fn(() => () => {}),
  onUnlock: vi.fn(() => () => {}),
  clearWASMCache: vi.fn(),
  destroyDB: vi.fn().mockResolvedValue(undefined),
  clearAll: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  suspendAudit: vi.fn(),
  getRateLimitState: vi.fn().mockReturnValue({
    unlockAttempts: 0,
    lockoutUntil: 0,
  }),
  auditRecord: vi.fn().mockResolvedValue(undefined),
  safeRemove: vi.fn(),
  unload: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    lock: mockFns.lock,
    isLocked: mockFns.isLocked,
    registerCaller: vi.fn(),
    verifyPasswordRateLimited: mockFns.verifyPasswordRateLimited,
    onLock: mockFns.onLock,
    onUnlock: mockFns.onUnlock,
  },
}));

vi.mock("../../utils/wasm-core", () => ({
  clearWASMCache: mockFns.clearWASMCache,
}));

vi.mock("../../db/database", () => ({
  destroyDB: mockFns.destroyDB,
}));

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: { clearAll: mockFns.clearAll, close: mockFns.close },
}));

vi.mock("../../services/AuditLogService", () => ({
  auditLog: { record: mockFns.auditRecord, suspend: mockFns.suspendAudit },
}));

vi.mock("../../store/safeStorage", () => ({
  safeGet: vi.fn(() => null),
  safeSet: vi.fn(),
  safeRemove: mockFns.safeRemove,
  safeSessionClear: vi.fn(),
  createStorageAdapter: vi.fn(() => ({
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })),
}));

vi.mock("../../store/rateLimitStore", () => ({
  getRateLimitState: mockFns.getRateLimitState,
}));

vi.mock("../../services/ai/RAGEngine", () => ({
  ragEngine: { unload: mockFns.unload },
}));

function createIDBRequest(
  type: "success" | "error" | "blocked",
  err?: Error,
): IDBRequest {
  let onsuccess: (() => void) | undefined;
  let onerror: ((evt: { target: { error?: Error } }) => void) | undefined;
  let onblocked: (() => void) | undefined;
  const req: any = {};
  req.error = err ?? undefined;
  Object.defineProperty(req, "onsuccess", {
    set(fn) {
      onsuccess = fn;
      if (type === "success") {
        queueMicrotask(() => onsuccess?.());
      }
    },
    get() {
      return onsuccess;
    },
  });
  Object.defineProperty(req, "onerror", {
    set(fn) {
      onerror = fn;
      if (type === "error") {
        queueMicrotask(() =>
          onerror?.({ target: { error: err ?? new Error("idb error") } }),
        );
      }
    },
    get() {
      return onerror;
    },
  });
  Object.defineProperty(req, "onblocked", {
    set(fn) {
      onblocked = fn;
      if (type === "blocked") {
        queueMicrotask(() => onblocked?.());
      }
    },
    get() {
      return onblocked;
    },
  });
  return req as IDBRequest;
}

function createMockDB(txType: "success" | "error" = "success"): IDBDatabase {
  const tx: any = {
    objectStore: () => ({
      put: vi.fn(),
    }),
  };
  Object.defineProperty(tx, "oncomplete", {
    set(fn: () => void) {
      if (txType === "success") {
        queueMicrotask(() => fn && fn());
      }
    },
    get() {
      return undefined;
    },
  });
  Object.defineProperty(tx, "onerror", {
    set(fn: () => void) {
      if (txType === "error") {
        queueMicrotask(() => fn && fn());
      }
    },
    get() {
      return undefined;
    },
  });
  const db: any = {
    objectStoreNames: {
      contains: (name: string) => name === NUCLEAR_AUDIT_STORE,
    },
    createObjectStore: vi.fn(() => ({ name: NUCLEAR_AUDIT_STORE })),
    transaction: () => tx,
    close: vi.fn(),
  };
  return db as IDBDatabase;
}

function createOpenDBRequest(
  db: IDBDatabase,
  type: "success" | "error" = "success",
): IDBOpenDBRequest {
  let onsuccess: (() => void) | undefined;
  let onerror: (() => void) | undefined;
  let onupgradeneeded: ((event: any) => void) | undefined;
  const req: any = { result: db };
  if (type === "error") {
    req.error = new Error("open failed");
  }
  Object.defineProperty(req, "onsuccess", {
    set(fn) {
      onsuccess = fn;
      if (type === "success") {
        queueMicrotask(() => onsuccess?.());
      }
    },
    get() {
      return onsuccess;
    },
  });
  Object.defineProperty(req, "onerror", {
    set(fn) {
      onerror = fn;
      if (type === "error") {
        queueMicrotask(() => onerror?.());
      }
    },
    get() {
      return onerror;
    },
  });
  Object.defineProperty(req, "onupgradeneeded", {
    set(fn) {
      onupgradeneeded = fn;
    },
    get() {
      return onupgradeneeded;
    },
  });
  return req as IDBOpenDBRequest;
}

describe("NuclearForgetService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFns.isLocked.mockResolvedValue(false);
    // vi.clearAllMocks() does NOT reset implementations, so restore the
    // default state after the RL-1 lockout test sets a future lockoutUntil.
    mockFns.getRateLimitState.mockReturnValue({
      unlockAttempts: 0,
      lockoutUntil: 0,
    });
    mockFns.verifyPasswordRateLimited.mockResolvedValue(true);
    const store: Record<string, string> = {};
    const mockStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: any) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    };
    Object.defineProperty(window, "localStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
  });

  it("throws when neither confirm nor password", async () => {
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");
    await expect(
      nuclearForgetService.nuclearForget({ confirm: false }),
    ).rejects.toThrow("NuclearForget requires explicit");
  });

  it("succeeds with confirm:true", async () => {
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");
    const report = await nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: true,
    });
    expect(report.wiped.length).toBeGreaterThan(0);
    expect(report.failed.length).toBe(0);
  });

  it("locks vault, destroys DB, clears storage in order", async () => {
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");
    await nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: true,
    });
    expect(mockFns.lock).toHaveBeenCalled();
    expect(mockFns.destroyDB).toHaveBeenCalled();
    expect(mockFns.clearAll).toHaveBeenCalled();
    expect(mockFns.unload).toHaveBeenCalled();
  });

  it("coalesces concurrent destructive requests into one operation", async () => {
    let release!: () => void;
    mockFns.destroyDB.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");

    const first = nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: true,
    });
    const second = nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: true,
    });

    expect(mockFns.lock).toHaveBeenCalledTimes(1);
    // The production lock now awaits its pre-lock audit flush. Let the
    // mocked lifecycle call yield before releasing the DB barrier.
    await Promise.resolve();
    release();
    const [firstReport, secondReport] = await Promise.all([first, second]);
    expect(firstReport).toEqual(secondReport);
    expect(mockFns.destroyDB).toHaveBeenCalledTimes(1);
  });

  it("continues on individual step failures", async () => {
    mockFns.destroyDB.mockRejectedValueOnce(new Error("destroy failed"));
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");
    const report = await nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: true,
    });
    expect(report.failed.length).toBeGreaterThanOrEqual(1);
    expect(report.failed[0]!.target).toBe("rxdb-instance-destroy");
    expect(report.wiped.length).toBeGreaterThan(1);
  });

  it("preserves only i18nextLng and forge_csp_profile in localStorage", async () => {
    window.localStorage.setItem("some-key", "value");
    window.localStorage.setItem("another-key", "data");
    window.localStorage.setItem("i18nextLng", "en");
    window.localStorage.setItem("forge_csp_profile", "STRICT");
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");
    const report = await nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: true,
    });
    expect(mockFns.safeRemove).toHaveBeenCalledWith("some-key");
    expect(mockFns.safeRemove).toHaveBeenCalledWith("another-key");
    expect(mockFns.safeRemove).not.toHaveBeenCalledWith("i18nextLng");
    expect(mockFns.safeRemove).not.toHaveBeenCalledWith("forge_csp_profile");
    expect(report.wiped.some((w) => w.startsWith("localStorage"))).toBe(true);
  });

  it("preserves extra keys from preserveKeys option", async () => {
    window.localStorage.setItem("my-key", "keep");
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");
    await nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: true,
      preserveKeys: ["my-key"],
    });
    expect(window.localStorage.getItem("my-key")).toBe("keep");
  });

  it("suspends the audit log before locking the vault", async () => {
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");
    await nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: true,
    });
    expect(mockFns.suspendAudit).toHaveBeenCalled();
    // Suspend must precede lock(): the vault_lock entry lock() queues must
    // never survive to flush and recreate the wiped secure vault DB.
    const suspendOrder = mockFns.suspendAudit.mock.invocationCallOrder[0];
    const lockOrder = mockFns.lock.mock.invocationCallOrder[0];
    expect(suspendOrder).toBeLessThan(lockOrder!);
  });

  it("routes the post-wipe audit entry ONLY to the forensic IDB", async () => {
    const puts: Array<Record<string, unknown>> = [];
    const tx: any = {
      objectStore: () => ({
        put: (value: Record<string, unknown>) => {
          puts.push(value);
        },
      }),
    };
    Object.defineProperty(tx, "oncomplete", {
      set(fn: () => void) {
        queueMicrotask(() => fn && fn());
      },
      get() {
        return undefined;
      },
    });
    Object.defineProperty(tx, "onerror", {
      set() {},
      get() {
        return undefined;
      },
    });
    Object.defineProperty(tx, "onabort", {
      set() {},
      get() {
        return undefined;
      },
    });
    const db: any = {
      objectStoreNames: {
        contains: (name: string) => name === NUCLEAR_AUDIT_STORE,
      },
      createObjectStore: vi.fn(() => ({ name: NUCLEAR_AUDIT_STORE })),
      transaction: () => tx,
      close: vi.fn(),
    };
    vi.stubGlobal("indexedDB", {
      deleteDatabase: () => createIDBRequest("success"),
      open: () => createOpenDBRequest(db, "success"),
    });
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");
    const report = await nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: false,
    });
    // The executed record reached the forensic IDB...
    expect(
      puts.some(
        (p) => p.action === "nuclear_forget_executed" && p.result === "success",
      ),
    ).toBe(true);
    // ...and NEVER the regular audit log, which would recreate the vault.
    expect(mockFns.auditRecord).not.toHaveBeenCalled();
    expect(report.failed.length).toBe(0);
  });

  it("never falls back to auditLog.record when the forensic write fails", async () => {
    vi.stubGlobal("indexedDB", {
      deleteDatabase: () => createIDBRequest("success"),
      open: () => createOpenDBRequest(createMockDB(), "error"),
    });
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");
    const report = await nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: false,
    });
    expect(report.wiped.length).toBeGreaterThan(0);
    expect(mockFns.auditRecord).not.toHaveBeenCalled();
  });

  it("wipes SecureStorage in clear → close → drop order", async () => {
    const order: string[] = [];
    mockFns.clearAll.mockImplementationOnce(async () => {
      order.push("clearAll");
    });
    mockFns.close.mockImplementationOnce(async () => {
      order.push("close");
    });
    vi.stubGlobal("indexedDB", {
      deleteDatabase: (name: string) => {
        order.push(`delete:${name}`);
        return createIDBRequest("success");
      },
      open: () => createOpenDBRequest(createMockDB(), "success"),
    });
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");
    const report = await nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: true,
    });
    // clearAll() must run against the LIVE connection before close() and
    // the drop — running it after the drop would recreate the vault DB.
    const clearIdx = order.indexOf("clearAll");
    const closeIdx = order.indexOf("close");
    const deleteIdx = order.indexOf("delete:bookmarkforge_secure_vault");
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(clearIdx);
    expect(deleteIdx).toBeGreaterThan(closeIdx);
    expect(report.wiped).toContain("secure-storage-clearAll");
    expect(report.wiped).toContain("secure-storage-close");
    expect(report.wiped).toContain("idb:bookmarkforge_secure_vault");
  });

  it("skips audit when skipAudit is true", async () => {
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");
    await nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: true,
    });
    expect(mockFns.auditRecord).not.toHaveBeenCalled();
  });

  it("calls registered onComplete listeners with report", async () => {
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");
    const listener = vi.fn();
    nuclearForgetService.onComplete(listener);
    const report = await nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: true,
    });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        wiped: expect.any(Array),
        failed: expect.any(Array),
        durationMs: expect.any(Number),
      }),
    );
    expect(listener.mock.calls[0]![0].wiped).toEqual(report.wiped);
  });

  it("reports durationMs", async () => {
    const { nuclearForgetService } =
      await import("../../services/NuclearForgetService");
    const report = await nuclearForgetService.nuclearForget({
      confirm: true,
      skipAudit: true,
    });
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("coverage gaps", () => {
    it("verifies password when vault is unlocked", async () => {
      vi.mocked(securityVault.isLocked).mockResolvedValueOnce(false);
      vi.mocked(securityVault.verifyPasswordRateLimited).mockResolvedValueOnce(true);
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        password: "secret",
        skipAudit: true,
      });
      expect(securityVault.verifyPasswordRateLimited).toHaveBeenCalledWith("secret");
      expect(report.failed).toEqual([]);
    });


    it("throws when password verification fails", async () => {
      vi.mocked(securityVault.isLocked).mockResolvedValueOnce(false);
      vi.mocked(securityVault.verifyPasswordRateLimited).mockResolvedValueOnce(false);
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      await expect(
        nuclearForgetService.nuclearForget({
          confirm: true,
          password: "wrong",
          skipAudit: true,
        }),
      ).rejects.toThrow("incorrect master password");
    });

    it("calls verifyPasswordRateLimited when password is provided (regardless of vault lock state)", async () => {
      // NOTE: The source does NOT check isLocked — it always calls
      // securityVault.verifyPasswordRateLimited() when opts.password is present.
      // If a vault-locked guard is ever added, this test should be
      // updated to expect verifyPasswordRateLimited NOT to have been called.
      vi.mocked(securityVault.verifyPasswordRateLimited).mockResolvedValue(true);
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        password: "secret",
        skipAudit: true,
      });
      expect(securityVault.verifyPasswordRateLimited).toHaveBeenCalledWith("secret");
      expect(report.failed).toEqual([]);
    });

    it("distinguishes lockout from wrong password (RL-1)", async () => {
      mockFns.getRateLimitState.mockReturnValue({
        unlockAttempts: 5,
        lockoutUntil: Date.now() + 60000,
      });
      vi.mocked(securityVault.verifyPasswordRateLimited).mockResolvedValue(false);
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      await expect(
        nuclearForgetService.nuclearForget({
          confirm: true,
          password: "correct_password",
          skipAudit: true,
        }),
      ).rejects.toThrow("rate limited");
    });

    it("handles failure in vault lock", async () => {
      mockFns.lock.mockImplementationOnce(() => {
        throw new Error("lock failed");
      });
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: true,
      });
      expect(report.failed.some((f) => f.target === "vault-lock")).toBe(true);
    });

    it("handles failure in secureStorage.clearAll", async () => {
      mockFns.clearAll.mockRejectedValueOnce(new Error("clear failed"));
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: true,
      });
      expect(
        report.failed.some((f) => f.target === "secure-storage-clearAll"),
      ).toBe(true);
    });

    it("handles failure in ragEngine.unload", async () => {
      mockFns.unload.mockRejectedValueOnce(new Error("unload failed"));
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: true,
      });
      expect(report.failed.some((f) => f.target === "ai-cache")).toBe(true);
    });

    it("handles listener error gracefully", async () => {
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const unsubscribe = nuclearForgetService.onComplete(() => {
        throw new Error("listener boom");
      });
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: true,
      });
      unsubscribe();
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("completes the wipe without auditLog when skipAudit is false", async () => {
      mockFns.auditRecord.mockRejectedValueOnce(new Error("audit failed"));
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: false,
      });
      expect(report.wiped.length).toBeGreaterThan(0);
      // auditLog.record is never invoked by the wipe, even when skipAudit
      // is false — the forensic IDB is the only post-wipe audit surface.
      expect(mockFns.auditRecord).not.toHaveBeenCalled();
    });

    it("deletes IndexedDB databases when indexedDB is available", async () => {
      const mockIDB = {
        deleteDatabase: () => createIDBRequest("success"),
        open: () => createOpenDBRequest(createMockDB(), "success"),
      };
      vi.stubGlobal("indexedDB", mockIDB);
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: true,
      });
      expect(report.wiped.some((w) => w.startsWith("idb:"))).toBe(true);
    });

    it("records failed IndexedDB deletion", async () => {
      const mockIDB = {
        deleteDatabase: () => createIDBRequest("error", new Error("delete failed")),
      };
      vi.stubGlobal("indexedDB", mockIDB);
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: true,
      });
      expect(report.failed.some((f) => f.target.startsWith("idb:"))).toBe(true);
    });

    it("reports blocked IndexedDB deletion as a failed wipe", async () => {
      const mockIDB = {
        deleteDatabase: () => createIDBRequest("blocked"),
      };
      vi.stubGlobal("indexedDB", mockIDB);
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: true,
      });
      expect(report.failed.some((f) => f.target.startsWith("idb:"))).toBe(true);
      expect(report.wiped.some((w) => w.startsWith("idb:"))).toBe(false);
    });

    it("skips localStorage wipe when localStorage is undefined", async () => {
      Object.defineProperty(window, "localStorage", {
        value: undefined,
        writable: true,
        configurable: true,
      });
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: true,
      });
      expect(
        report.wiped.some((w) => w === "localStorage(0-removed/0-kept)"),
      ).toBe(true);
    });

    it("clears caches and unregisters service workers", async () => {
      const deleteCache = vi.fn().mockResolvedValue(true);
      const unregister = vi.fn().mockResolvedValue(true);
      vi.stubGlobal("caches", {
        keys: vi.fn().mockResolvedValue(["cache1"]),
        delete: deleteCache,
      });
      vi.stubGlobal("navigator", {
        ...globalThis.navigator,
        serviceWorker: { getRegistrations: vi.fn().mockResolvedValue([{ unregister }]) },
      });
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: true,
      });
      expect(report.wiped.some((w) => w.startsWith("caches:"))).toBe(true);
      expect(report.wiped.some((w) => w.startsWith("sw:"))).toBe(true);
      expect(deleteCache).toHaveBeenCalledWith("cache1");
      expect(unregister).toHaveBeenCalled();
    });

    it("handles cache API failure", async () => {
      vi.stubGlobal("caches", {
        keys: vi.fn().mockRejectedValue(new Error("caches failed")),
      });
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: true,
      });
      expect(report.failed.some((f) => f.target === "cache-api")).toBe(true);
    });

    it("handles service worker unregistration failure", async () => {
      vi.stubGlobal("navigator", {
        serviceWorker: {
          getRegistrations: vi.fn().mockRejectedValue(new Error("sw failed")),
        },
      });
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: true,
      });
      expect(report.failed.some((f) => f.target === "service-worker")).toBe(
        true,
      );
    });

    it("clears WASM cache successfully", async () => {
      vi.mocked(clearWASMCache).mockResolvedValueOnce(undefined);
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: true,
      });
      expect(report.wiped.some((w) => w === "wasm-cache")).toBe(true);
    });

    it("handles WASM cache failure", async () => {
      vi.mocked(clearWASMCache).mockImplementationOnce(() => {
        throw new Error("wasm failed");
      });
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: true,
      });
      expect(report.failed.some((f) => f.target === "wasm-cache")).toBe(true);
    });

    it("records pre-wipe audit successfully", async () => {
      const mockIDB = {
        deleteDatabase: () => createIDBRequest("success"),
        open: () => createOpenDBRequest(createMockDB("success"), "success"),
      };
      vi.stubGlobal("indexedDB", mockIDB);
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: false,
      });
      expect(mockFns.auditRecord).not.toHaveBeenCalled();
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("handles pre-wipe audit open error", async () => {
      const mockIDB = {
        deleteDatabase: () => createIDBRequest("success"),
        open: () => createOpenDBRequest(createMockDB(), "error"),
      };
      vi.stubGlobal("indexedDB", mockIDB);
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: false,
      });
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("handles pre-wipe audit transaction error", async () => {
      const mockIDB = {
        deleteDatabase: () => createIDBRequest("success"),
        open: () =>
          createOpenDBRequest(createMockDB("error"), "success"),
      };
      vi.stubGlobal("indexedDB", mockIDB);
      const { nuclearForgetService } =
        await import("../../services/NuclearForgetService");
      const report = await nuclearForgetService.nuclearForget({
        confirm: true,
        skipAudit: false,
      });
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
