import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "../../utils/logger";

const TELEMETRY_KEY = "bmf_local_error_storage";
const LEGACY_TELEMETRY_KEY = "bmf_telemetry_optin";

let errorReporter: any;
let setupGlobalErrorHandler: any;

beforeEach(async () => {
  localStorage.clear();
  vi.restoreAllMocks();
  const mod = await import("../../telemetry/errorReporter");
  errorReporter = mod.errorReporter;
  setupGlobalErrorHandler = mod.setupGlobalErrorHandler;
  await errorReporter.clearErrors();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sanitization", () => {
  it("redacts passwords in messages", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const err = new Error("password=supersecret123");
    await errorReporter.reportError(err);
    const stored = await errorReporter.getStoredErrors();
    expect(stored[0].message).toContain("[REDACTED]");
    expect(stored[0].message).not.toContain("supersecret123");
  });

  it("redacts secrets in messages", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const err = new Error("secret=my-secret-value");
    await errorReporter.reportError(err);
    const stored = await errorReporter.getStoredErrors();
    expect(stored[0].message).toContain("[REDACTED]");
  });

  it("redacts api keys in messages", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const err = new Error("api_key=sk-abc123def456");
    await errorReporter.reportError(err);
    const stored = await errorReporter.getStoredErrors();
    expect(stored[0].message).toContain("[REDACTED]");
    expect(stored[0].message).not.toContain("sk-abc123def456");
  });

  it("redacts tokens in messages", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const err = new Error("token=gho_xxx123");
    await errorReporter.reportError(err);
    const stored = await errorReporter.getStoredErrors();
    expect(stored[0].message).toContain("[REDACTED]");
    expect(stored[0].message).not.toContain("gho_xxx123");
  });

  it("redacts URL passwords in messages", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const err = new Error("https://user:pass@example.com/path");
    await errorReporter.reportError(err);
    const stored = await errorReporter.getStoredErrors();
    expect(stored[0].message).toContain("[REDACTED]");
  });
});

describe("telemetry opt-in", () => {
  it("does NOT store errors when telemetry is disabled", async () => {
    localStorage.setItem(TELEMETRY_KEY, "false");
    await errorReporter.reportError(new Error("should not appear"));
    const stored = await errorReporter.getStoredErrors();
    expect(stored).toHaveLength(0);
  });

  it("stores errors when telemetry is enabled", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const err = new Error("test storage");
    await errorReporter.reportError(err);
    const stored = await errorReporter.getStoredErrors();
    expect(stored.length).toBeGreaterThanOrEqual(1);
    expect(stored[0].message).toBe("test storage");
  });

  it("stores error with stack trace and fingerprint", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    try {
      throw new Error("with stack");
    } catch (e) {
      await errorReporter.reportError(e as Error);
    }
    const stored = await errorReporter.getStoredErrors();
    expect(stored[0].message).toBe("with stack");
    expect(stored[0].stack).toBeDefined();
    expect(stored[0].fingerprint).toBeDefined();
    expect(stored[0].type).toBe("Error");
  });

  it("handles falsy telemetry key gracefully", async () => {
    localStorage.removeItem(TELEMETRY_KEY);
    await errorReporter.reportError(new Error("no pref"));
    const stored = await errorReporter.getStoredErrors();
    expect(stored).toHaveLength(0);
  });
});

describe("global error handler", () => {
  it("registers window error and unhandledrejection listeners", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    setupGlobalErrorHandler();
    expect(addSpy).toHaveBeenCalledWith("error", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith(
      "unhandledrejection",
      expect.any(Function),
    );
  });

  it("captures errors from window error events", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    setupGlobalErrorHandler();
    const err = new Error("from event");
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: err,
        filename: "test.js",
        lineno: 10,
        colno: 5,
      }),
    );
    await vi.waitFor(async () => {
      const stored = await errorReporter.getStoredErrors();
      expect(stored.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("captures unhandledrejection with Error reason", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    setupGlobalErrorHandler();
    const p = new Promise(() => {});
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: p,
        reason: new Error("rejection error"),
      }),
    );
    await vi.waitFor(async () => {
      const stored = await errorReporter.getStoredErrors();
      const hasRejection = stored.some(
        (e: any) => e.message === "rejection error",
      );
      expect(hasRejection).toBe(true);
    });
  });

  it("captures unhandledrejection with non-Error reason", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    setupGlobalErrorHandler();
    const p = new Promise(() => {});
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: p,
        reason: "string reason",
      }),
    );
    await vi.waitFor(async () => {
      const stored = await errorReporter.getStoredErrors();
      const hasString = stored.some((e: any) => e.message === "string reason");
      expect(hasString).toBe(true);
    });
  });

  it("ignores window error events without error object", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    setupGlobalErrorHandler();
    window.dispatchEvent(new ErrorEvent("error", { message: "no error obj" }));
    const stored = await errorReporter.getStoredErrors();
    expect(stored).toHaveLength(0);
  });
});

describe("stored errors lifecycle", () => {
  it("returns empty array when no errors stored", async () => {
    const stored = await errorReporter.getStoredErrors();
    expect(stored).toEqual([]);
  });

  it("clearErrors removes all stored errors", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    await errorReporter.reportError(new Error("clear me"));
    let stored = await errorReporter.getStoredErrors();
    expect(stored.length).toBeGreaterThanOrEqual(1);

    await errorReporter.clearErrors();
    stored = await errorReporter.getStoredErrors();
    expect(stored).toEqual([]);
  });

  it("deduplicates errors by fingerprint", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const err = new Error("dedup test");
    await errorReporter.reportError(err);
    await errorReporter.reportError(err);
    const stored = await errorReporter.getStoredErrors();
    expect(stored).toHaveLength(1);
    expect(stored[0].count).toBe(2);
  });

  it("merges context during dedup", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const err = new Error("ctx merge");
    await errorReporter.reportError(err, { page: "home" });
    await errorReporter.reportError(err, { action: "login" });
    const stored = await errorReporter.getStoredErrors();
    expect(stored).toHaveLength(1);
    expect(stored[0].context).toMatchObject({ page: "home", action: "login" });
  });

  it("evicts oldest errors when exceeding max capacity", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    for (let i = 0; i < 105; i++) {
      await errorReporter.reportError(new Error(`error-${i}`));
    }
    const stored = await errorReporter.getStoredErrors();
    expect(stored.length).toBeLessThanOrEqual(100);
  });

  it("returns errors sorted by timestamp descending", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    await errorReporter.reportError(new Error("first"));
    await new Promise((r) => setTimeout(r, 10));
    await errorReporter.reportError(new Error("second"));
    const stored = await errorReporter.getStoredErrors();
    expect(stored[0].message).toBe("second");
  });
});

describe("init", () => {
  it("is idempotent (calling init twice works)", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    await errorReporter.init();
    await errorReporter.init();
    await errorReporter.reportError(new Error("after init"));
    const stored = await errorReporter.getStoredErrors();
    expect(stored.length).toBeGreaterThanOrEqual(1);
  });
});

describe("reportError error handling", () => {
  it("handles exceptions during store gracefully", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const orig = indexedDB.open;
    indexedDB.open = vi.fn(() => {
      throw new Error("db crash");
    }) as any;
    await expect(
      errorReporter.reportError(new Error("should not throw")),
    ).resolves.toBeUndefined();
    indexedDB.open = orig;
  });
});

describe("fingerprint generation", () => {
  it("generates consistent fingerprints for same error", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    await errorReporter.clearErrors();
    const err1 = new Error("consistent");
    const err2 = new Error("consistent");
    err2.stack = err1.stack;
    await errorReporter.reportError(err1);
    await errorReporter.reportError(err2);
    const stored = await errorReporter.getStoredErrors();
    expect(stored).toHaveLength(1);
    expect(stored[0].count).toBe(2);
  });
});

describe("stored error fields", () => {
  it("appVersion is set", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    await errorReporter.reportError(new Error("version test"));
    const stored = await errorReporter.getStoredErrors();
    expect(stored[0].appVersion).toBeDefined();
  });
});

describe("stored error fields", () => {
  it("thread field is set to main", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    await errorReporter.reportError(new Error("thread test"));
    const stored = await errorReporter.getStoredErrors();
    expect(stored[0].thread).toBe("main");
  });

  it("stores error with correct id format", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    await errorReporter.reportError(new Error("id test"));
    const stored = await errorReporter.getStoredErrors();
    expect(stored[0].id).toMatch(/^\d+-\w+$/);
  });

  it("thread field is set to worker in WorkerGlobalScope", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const origWorker = (globalThis as any).WorkerGlobalScope;
    (globalThis as any).WorkerGlobalScope = (self as any).constructor;
    await errorReporter.reportError(new Error("worker thread test"));
    const stored = await errorReporter.getStoredErrors();
    (globalThis as any).WorkerGlobalScope = origWorker;
    expect(stored.some((e: any) => e.thread === "worker")).toBe(true);
  });
});

describe("error handling edge cases", () => {
  it("getStoredErrors returns [] when database fails", async () => {
    const orig = indexedDB.open;
    indexedDB.open = vi.fn(() => {
      throw new Error("db crash");
    }) as any;
    const result = await errorReporter.getStoredErrors();
    expect(result).toEqual([]);
    indexedDB.open = orig;
  });

  it("clearErrors does not throw when database fails", async () => {
    const orig = indexedDB.open;
    indexedDB.open = vi.fn(() => {
      throw new Error("db crash");
    }) as any;
    await expect(errorReporter.clearErrors()).resolves.toBeUndefined();
    indexedDB.open = orig;
  });

  it("reportError does not throw when localStorage throws", async () => {
    const orig = localStorage.getItem;
    localStorage.getItem = vi.fn(() => {
      throw new Error("storage fail");
    }) as any;
    await expect(
      errorReporter.reportError(new Error("should not report")),
    ).resolves.toBeUndefined();
    localStorage.getItem = orig;
  });
});

describe("flush", () => {
  it("flush no-op no lanza error", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    await expect(errorReporter.flush()).resolves.toBeUndefined();
  });

  it("honors the legacy bmf_telemetry_optin as a migration", async () => {
    localStorage.removeItem(TELEMETRY_KEY);
    localStorage.setItem(LEGACY_TELEMETRY_KEY, "true");
    await errorReporter.clearErrors();
    await errorReporter.reportError(new Error("migration-legacy-key"));
    const stored = await errorReporter.getStoredErrors();
    expect(
      stored.some((e: { message: string }) =>
        e.message.includes("migration-legacy-key"),
      ),
    ).toBe(true);
    localStorage.removeItem(LEGACY_TELEMETRY_KEY);
  });

  it("does not report when the new key is false even if the legacy one is true", async () => {
    // The settings toggle clears the legacy key, so this combination only
    // happens transiently; the new key must win.
    localStorage.setItem(TELEMETRY_KEY, "false");
    localStorage.setItem(LEGACY_TELEMETRY_KEY, "true");
    await errorReporter.reportError(new Error("new-key-wins"));
    const stored = await errorReporter.getStoredErrors();
    expect(
      stored.some((e: { message: string }) => e.message.includes("new-key-wins")),
    ).toBe(false);
  });

  it("flush does not throw when DB fails", async () => {
    const orig = indexedDB.open;
    indexedDB.open = vi.fn(() => {
      throw new Error("db crash");
    }) as any;
    await expect(errorReporter.flush()).resolves.toBeUndefined();
    indexedDB.open = orig;
  });
});

describe("setupLoggerSink", () => {
  it("logger sink captures errors from logger.error", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    await errorReporter.init();
    await errorReporter.clearErrors();
    logger.error(new Error("sink-captured"));
    await vi.waitFor(async () => {
      const stored = await errorReporter.getStoredErrors();
      expect(stored.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("logger sink non-error message", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    await errorReporter.init();
    await errorReporter.clearErrors();
    logger.info("info message should not trigger sink");
    const stored = await errorReporter.getStoredErrors();
    expect(stored).toHaveLength(0);
  });

  it("logger sink catch when reportError fails", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    await errorReporter.init();
    const warnSpy = vi.spyOn(logger, "warn");
    vi.spyOn(errorReporter, "reportError").mockRejectedValue(
      new Error("sink-fail"),
    );
    logger.error(new Error("trigger-catch"));
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});

describe("getStoredErrors database failure", () => {
  it("returns [] when openDB rejects", async () => {
    const orig = indexedDB.open;
    indexedDB.open = vi.fn(() => {
      const req: any = {
        onsuccess: null,
        onerror: null,
        result: null,
        error: new Error("fail"),
      };
      setTimeout(() => req.onerror?.(), 0);
      return req;
    }) as any;
    const result = await errorReporter.getStoredErrors();
    expect(result).toEqual([]);
    indexedDB.open = orig;
  });
});

describe("getStoredErrors database failure", () => {
  it("returns [] when openDB rejects", async () => {
    const orig = indexedDB.open;
    indexedDB.open = vi.fn(() => {
      const req: any = {
        onsuccess: null,
        onerror: null,
        result: null,
        error: new Error("fail"),
      };
      setTimeout(() => req.onerror?.(), 0);
      return req;
    }) as any;
    const result = await errorReporter.getStoredErrors();
    expect(result).toEqual([]);
    indexedDB.open = orig;
  });
});

describe("telemetry lifecycle and bounds", () => {
  it("bounds stored messages, stacks, and context values", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const context = Object.fromEntries(
      Array.from({ length: 24 }, (_, index) => [
        `context-${index}`,
        "sensitive-value-".repeat(200),
      ]),
    );
    const error = new Error("message-".repeat(2000));
    error.stack = "stack-".repeat(10_000);

    await errorReporter.reportError(error, context);
    const stored = (await errorReporter.getStoredErrors())[0];

    expect(stored.message.length).toBeLessThanOrEqual(4096);
    expect(stored.stack?.length ?? 0).toBeLessThanOrEqual(12_000);
    expect(Object.keys(stored.context ?? {})).toHaveLength(16);
    expect(
      Object.values(stored.context ?? {}).every(
        (value) => String(value).length <= 512,
      ),
    ).toBe(true);
  });

  it("registers global handlers once and returns cleanup", () => {
    errorReporter.dispose();
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const cleanup = setupGlobalErrorHandler();
    setupGlobalErrorHandler();
    cleanup();

    expect(
      addSpy.mock.calls.filter(([type]) => type === "error"),
    ).toHaveLength(1);
    expect(
      removeSpy.mock.calls.filter(([type]) => type === "error"),
    ).toHaveLength(1);

    errorReporter.dispose();
  });
});

/*
 * Consent integration (audit 2026-08-30): the ConsentBanner writes to
 * STORAGE_KEYS.CONSENT_ERROR_REPORTING ("forge_consent_error_reporting").
 * Previously the reporter read bmf_local_error_storage instead — the
 * banner choice had no effect. These tests pin the correct contract.
 */
describe("consent banner integration", () => {
  const CONSENT_KEY = "forge_consent_error_reporting";

  beforeEach(async () => {
    localStorage.clear();
    vi.restoreAllMocks();
    const mod = await import("../../telemetry/errorReporter");
    errorReporter = mod.errorReporter;
    await errorReporter.clearErrors();
  });

  it("stores errors when ConsentBanner grants consent", async () => {
    localStorage.setItem(CONSENT_KEY, "true");
    await errorReporter.reportError(new Error("consent-on test"));
    const stored = await errorReporter.getStoredErrors();
    expect(stored).toHaveLength(1);
    expect(stored[0].message).toBe("consent-on test");
  });

  it("does NOT store errors when ConsentBanner denies consent", async () => {
    localStorage.setItem(CONSENT_KEY, "false");
    await errorReporter.reportError(new Error("consent-off test"));
    const stored = await errorReporter.getStoredErrors();
    expect(stored).toHaveLength(0);
  });

  it("falls back to legacy bmf_local_error_storage when consent key absent", async () => {
    localStorage.setItem("bmf_local_error_storage", "true");
    await errorReporter.reportError(new Error("legacy fallback"));
    const stored = await errorReporter.getStoredErrors();
    expect(stored).toHaveLength(1);
  });

  it("consent key false overrides legacy key true", async () => {
    localStorage.setItem("bmf_local_error_storage", "true");
    localStorage.setItem(CONSENT_KEY, "false");
    await errorReporter.reportError(new Error("override test"));
    const stored = await errorReporter.getStoredErrors();
    expect(stored).toHaveLength(0);
  });
});
