// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockSecureStorage = {
  getSecret: vi.fn<(s: string) => Promise<string | null>>(),
  setSecret: vi.fn<(k: string, v: string) => Promise<void>>(),
  hasSecret: vi.fn<(k: string) => Promise<boolean>>(),
};
vi.mock("../../services/SecureStorage", () => ({
  secureStorage: mockSecureStorage,
}));

describe("rateLimitStore", () => {
  beforeEach(async () => {
    // Persist writes are async (Web Crypto HMAC signing). A write from the
    // PREVIOUS test can still be in flight here; if it lands after
    // localStorage.clear() below, this test reads stale state and the
    // assertions fail spuriously (reproducible under coverage instrumentation,
    // which slows the crypto). Drain the previous module's queue first.
    try {
      const prev = await import("../../store/rateLimitStore");
      await prev.flushRateLimitWrites();
    } catch {
      // First run: no previous module instance yet.
    }
    localStorage.clear();
    vi.clearAllMocks();
    // Tests that simulate HMAC failure spy on crypto.subtle.importKey with
    // mockRejectedValue; without restoreAllMocks the rejection leaks into
    // every later test (signature verification then silently succeeds via the
    // catch branch). Restore spies here so each test starts clean.
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    mockSecureStorage.getSecret.mockResolvedValue(null);
    mockSecureStorage.setSecret.mockResolvedValue(undefined);
    mockSecureStorage.hasSecret.mockResolvedValue(false);
  });

  it("estado inicial: unlockAttempts 0 y lockoutUntil 0", async () => {
    const { useRateLimitStore } = await import("../../store/rateLimitStore");
    const state = useRateLimitStore.getState();
    expect(state.unlockAttempts).toBe(0);
    expect(state.lockoutUntil).toBe(0);
  });

  it("incrementAttempt: increases unlockAttempts by 1", async () => {
    const { useRateLimitStore } = await import("../../store/rateLimitStore");
    useRateLimitStore.getState().incrementAttempt();
    expect(useRateLimitStore.getState().unlockAttempts).toBe(1);
  });

  it("incrementAttempt: acumula multiples intentos", async () => {
    const { useRateLimitStore } = await import("../../store/rateLimitStore");
    useRateLimitStore.getState().incrementAttempt();
    useRateLimitStore.getState().incrementAttempt();
    useRateLimitStore.getState().incrementAttempt();
    expect(useRateLimitStore.getState().unlockAttempts).toBe(3);
  });

  it("resetAttempts: resets unlockAttempts to 0", async () => {
    const { useRateLimitStore } = await import("../../store/rateLimitStore");
    useRateLimitStore.getState().incrementAttempt();
    useRateLimitStore.getState().incrementAttempt();
    useRateLimitStore.getState().resetAttempts();
    expect(useRateLimitStore.getState().unlockAttempts).toBe(0);
    expect(useRateLimitStore.getState().lockoutUntil).toBe(0);
  });

  it("setLockout: sets lockoutUntil and resets unlockAttempts", async () => {
    const { useRateLimitStore } = await import("../../store/rateLimitStore");
    useRateLimitStore.getState().incrementAttempt();
    useRateLimitStore.getState().setLockout(99999);
    const state = useRateLimitStore.getState();
    expect(state.lockoutUntil).toBe(99999);
    expect(state.unlockAttempts).toBe(0);
  });

  it("getRateLimitState: returns the current state", async () => {
    const { getRateLimitState, useRateLimitStore } =
      await import("../../store/rateLimitStore");
    useRateLimitStore.getState().incrementAttempt();
    expect(getRateLimitState().unlockAttempts).toBe(1);
  });

  it("persists unlockAttempts to localStorage", async () => {
    const { useRateLimitStore } = await import("../../store/rateLimitStore");
    useRateLimitStore.getState().incrementAttempt();
    useRateLimitStore.getState().incrementAttempt();

    // Wait for Zustand persist middleware to flush to localStorage with the right value
    await vi.waitFor(
      () => {
        const raw = localStorage.getItem("bookmarkforge-rate-limit");
        expect(raw).not.toBeNull();
        const colonIdx = raw!.lastIndexOf(":");
        const stateStr = colonIdx !== -1 ? raw!.slice(0, colonIdx) : raw;
        const parsed = JSON.parse(stateStr!);
        expect(parsed.state.unlockAttempts).toBe(2);
      },
      { timeout: 3000, interval: 50 },
    );
  });

  it("persists with an HMAC signature in localStorage", async () => {
    const { useRateLimitStore } = await import("../../store/rateLimitStore");
    useRateLimitStore.getState().incrementAttempt();

    await vi.waitFor(() => {
      const raw = localStorage.getItem("bookmarkforge-rate-limit");
      expect(raw).not.toBeNull();
      // State is JSON, then colon, then HMAC signature
      const colonIdx = raw!.lastIndexOf(":");
      expect(colonIdx).toBeGreaterThan(-1);
      const sigPart = raw!.slice(colonIdx + 1);
      expect(sigPart).toBeTruthy();
    });
  });

  it("ignores corrupted data in localStorage and starts clean", async () => {
    localStorage.setItem("bookmarkforge-rate-limit", "not-valid-json");

    vi.resetModules();
    const { useRateLimitStore } = await import("../../store/rateLimitStore");

    const state = useRateLimitStore.getState();
    expect(state.unlockAttempts).toBe(0);
    expect(state.lockoutUntil).toBe(0);
  });

  it("HMAC key ephemeral: does not preserve state across reloads (by design)", async () => {
    const { useRateLimitStore } = await import("../../store/rateLimitStore");

    useRateLimitStore.getState().incrementAttempt();
    useRateLimitStore.getState().incrementAttempt();
    useRateLimitStore.getState().incrementAttempt();

    // Wait for persist to write to localStorage
    await vi.waitFor(() => {
      const raw = localStorage.getItem("bookmarkforge-rate-limit");
      expect(raw).not.toBeNull();
    });

    // Reset and re-import to simulate page reload
    vi.resetModules();
    const { useRateLimitStore: reloaded } =
      await import("../../store/rateLimitStore");

    // Force rehydration — HMAC key is ephemeral (a new key per module),
    // so the previous signature is invalid and the state resets by design.
    await (reloaded as any).persist.rehydrate();

    await vi.waitFor(() => {
      expect(reloaded.getState().unlockAttempts).toBe(0);
    });
  });

  it("setItem: saves raw if JSON.parse fails", async () => {
    const { useRateLimitStore } = await import("../../store/rateLimitStore");
    useRateLimitStore.getState().incrementAttempt();

    await vi.waitFor(() => {
      expect(localStorage.getItem("bookmarkforge-rate-limit")).not.toBeNull();
    });
  });

  it("removeItem: removes from localStorage", async () => {
    const { useRateLimitStore } = await import("../../store/rateLimitStore");
    useRateLimitStore.getState().incrementAttempt();

    await vi.waitFor(() => {
      expect(localStorage.getItem("bookmarkforge-rate-limit")).not.toBeNull();
    });

    localStorage.removeItem("bookmarkforge-rate-limit");
    expect(localStorage.getItem("bookmarkforge-rate-limit")).toBeNull();
  });

  it("EPHEMERAL_HMAC_KEY ya no existe (HMAC almacenado bajo bmf_rl_hmac_key)", async () => {
    const { useRateLimitStore } = await import("../../store/rateLimitStore");

    useRateLimitStore.getState().incrementAttempt();
    expect(useRateLimitStore.getState().unlockAttempts).toBe(1);

    await vi.waitFor(() => {
      const raw = localStorage.getItem("bookmarkforge-rate-limit");
      expect(raw).not.toBeNull();
      // Format: {json_state}:{hmac_signature}
      const colonIdx = raw!.lastIndexOf(":");
      expect(colonIdx).toBeGreaterThan(-1);
      const stateStr = raw!.slice(0, colonIdx);
      const parsed = JSON.parse(stateStr);
      expect(parsed.state.unlockAttempts).toBe(1);
    });
  });

  it("setItem catch: localStorage.setItem throws, catch handles it", async () => {
    const origSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = function () {
      window.localStorage.setItem = origSetItem;
      throw new Error("QuotaExceeded");
    } as any;

    try {
      const { useRateLimitStore } = await import("../../store/rateLimitStore");
      useRateLimitStore.getState().incrementAttempt();
    } catch {
      // zustand may propagate the error, acceptable
    }

    window.localStorage.setItem = origSetItem;
  });

  it("removeItem via persist.clearStorage", async () => {
    const { useRateLimitStore } = await import("../../store/rateLimitStore");
    useRateLimitStore.getState().incrementAttempt();

    await vi.waitFor(() => {
      expect(localStorage.getItem("bookmarkforge-rate-limit")).not.toBeNull();
    });

    await (useRateLimitStore as any).persist.clearStorage();
    expect(localStorage.getItem("bookmarkforge-rate-limit")).toBeNull();
  });

  describe("production: rejection of unsigned state (isProduction gating)", () => {
    let originalProd: string | undefined;

    beforeEach(() => {
      originalProd = process.env.PROD;
      process.env.PROD = "true";
    });

    afterEach(() => {
      if (originalProd === undefined) delete process.env.PROD;
      else process.env.PROD = originalProd;
    });

    it("getItem removes state with u: prefix and returns null", async () => {
      const { rateLimitStorage } = await import("../../store/rateLimitStore");
      localStorage.setItem(
        "bookmarkforge-rate-limit",
        'u:{"unlockAttempts":5,"lockoutUntil":0}',
      );
      const result = await rateLimitStorage.getItem(
        "bookmarkforge-rate-limit",
      );
      expect(result).toBeNull();
      expect(localStorage.getItem("bookmarkforge-rate-limit")).toBeNull();
    });

    it("getItem removes state with u: prefix even if it contains another colon", async () => {
      const { rateLimitStorage } = await import("../../store/rateLimitStore");
      localStorage.setItem(
        "bookmarkforge-rate-limit",
        'u:{"unlockAttempts":5,"lockoutUntil":0}:extra',
      );
      const result = await rateLimitStorage.getItem(
        "bookmarkforge-rate-limit",
      );
      expect(result).toBeNull();
      expect(localStorage.getItem("bookmarkforge-rate-limit")).toBeNull();
    });

    it("setItem throws when HMAC fails and does not persist unsigned state", async () => {
      const { rateLimitStorage } = await import("../../store/rateLimitStore");
      // Force the HMAC path to fail: no seed secret + importKey rejected.
      mockSecureStorage.getSecret.mockResolvedValue(null);
      vi.spyOn(crypto.subtle, "importKey").mockRejectedValue(
        new Error("HMAC unavailable"),
      );

      await expect(
        rateLimitStorage.setItem(
          "bookmarkforge-rate-limit",
          '{"unlockAttempts":1}',
        ),
      ).rejects.toThrow("Refusing to persist unsigned state");

      expect(localStorage.getItem("bookmarkforge-rate-limit")).toBeNull();
      const { logger } = await import("../../utils/logger");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("HMAC signing failed in production"),
        expect.any(Error),
      );
    });

    it("setItem does not persist state with u: prefix in production", async () => {
      const { rateLimitStorage } = await import("../../store/rateLimitStore");
      mockSecureStorage.getSecret.mockResolvedValue(null);
      vi.spyOn(crypto.subtle, "importKey").mockRejectedValue(
        new Error("HMAC unavailable"),
      );

      await expect(
        rateLimitStorage.setItem(
          "bookmarkforge-rate-limit",
          '{"unlockAttempts":1}',
        ),
      ).rejects.toThrow();

      const raw = localStorage.getItem("bookmarkforge-rate-limit");
      expect(raw).toBeNull();
    });

    it("getItem accepts valid signed state in production", async () => {
      const { rateLimitStorage } = await import("../../store/rateLimitStore");
      await rateLimitStorage.setItem(
        "bookmarkforge-rate-limit",
        '{"unlockAttempts":1,"lockoutUntil":0}',
      );

      const stored = localStorage.getItem("bookmarkforge-rate-limit");
      expect(stored).toMatch(/^\{.*\}:[a-f0-9]+$/);

      const result = await rateLimitStorage.getItem(
        "bookmarkforge-rate-limit",
      );
      expect(result).toBe('{"unlockAttempts":1,"lockoutUntil":0}');
    });
  });

  describe("development/test: accepting unsigned state as fallback", () => {
    let originalProd: string | undefined;

    beforeEach(() => {
      originalProd = process.env.PROD;
      delete process.env.PROD;
    });

    afterEach(() => {
      if (originalProd === undefined) delete process.env.PROD;
      else process.env.PROD = originalProd;
    });

    it("getItem accepts state with u: prefix and returns the payload", async () => {
      const { rateLimitStorage } = await import("../../store/rateLimitStore");
      localStorage.setItem(
        "bookmarkforge-rate-limit",
        'u:{"unlockAttempts":3,"lockoutUntil":0}',
      );
      const result = await rateLimitStorage.getItem(
        "bookmarkforge-rate-limit",
      );
      expect(result).toBe('{"unlockAttempts":3,"lockoutUntil":0}');
    });

    it("handles a browser process shim without an env object", async () => {
      const { rateLimitStorage } = await import("../../store/rateLimitStore");
      vi.stubGlobal("process", { env: undefined });
      localStorage.setItem(
        "bookmarkforge-rate-limit",
        'u:{"unlockAttempts":3,"lockoutUntil":0}',
      );

      try {
        await expect(
          rateLimitStorage.getItem("bookmarkforge-rate-limit"),
        ).resolves.toBe('{"unlockAttempts":3,"lockoutUntil":0}');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("setItem persists state with u: prefix when HMAC fails", async () => {
      const { rateLimitStorage } = await import("../../store/rateLimitStore");
      mockSecureStorage.getSecret.mockResolvedValue(null);
      vi.spyOn(crypto.subtle, "importKey").mockRejectedValue(
        new Error("HMAC unavailable"),
      );
      await rateLimitStorage.setItem(
        "bookmarkforge-rate-limit",
        '{"unlockAttempts":2}',
      );
      expect(localStorage.getItem("bookmarkforge-rate-limit")).toBe(
        'u:{"unlockAttempts":2}',
      );
    });
  });

  it("discards persisted state quietly while the vault device key is locked", async () => {
    const { rateLimitStorage } = await import("../../store/rateLimitStore");
    const lockedError = new Error(
      "[SecureStorage] Device key is wrapped by the master password — unlock the vault first",
    );
    lockedError.name = "DEVICE_KEY_WRAPPED";
    mockSecureStorage.getSecret.mockRejectedValue(lockedError);
    localStorage.setItem(
      "bookmarkforge-rate-limit",
      '{"unlockAttempts":5,"lockoutUntil":9999999999999}:unverified',
    );

    const result = await rateLimitStorage.getItem("bookmarkforge-rate-limit");

    expect(result).toBeNull();
    expect(localStorage.getItem("bookmarkforge-rate-limit")).toBeNull();
    const { logger } = await import("../../utils/logger");
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Failed to create HMAC key"),
      expect.anything(),
    );
  });

  describe("invalid signature", () => {
    it("getItem rejects invalid signature and removes the state", async () => {
      const { rateLimitStorage } = await import("../../store/rateLimitStore");
      localStorage.setItem(
        "bookmarkforge-rate-limit",
        '{"unlockAttempts":1,"lockoutUntil":0}:deadbeef',
      );
      const result = await rateLimitStorage.getItem(
        "bookmarkforge-rate-limit",
      );
      expect(result).toBeNull();
      expect(localStorage.getItem("bookmarkforge-rate-limit")).toBeNull();
    });
  });
});
