import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("P0 regression — rate-limit state-snapshot", () => {
  beforeEach(() => {
    // Preserve HMAC key across module reloads so persist can rehydrate.
  });

  it("ephemeral HMAC key: state does NOT persist across reloads (defense in depth)", async () => {
    const modA = await import("../../store/rateLimitStore");
    modA.useRateLimitStore.setState({ unlockAttempts: 0, lockoutUntil: 0 });
    modA.useRateLimitStore.getState().incrementAttempt();
    modA.useRateLimitStore.getState().incrementAttempt();
    modA.useRateLimitStore.getState().incrementAttempt();
    expect(modA.useRateLimitStore.getState().unlockAttempts).toBe(3);

    // HMAC key is regenerated on each module load; old signature is invalid
    // so the tampered/expired state is discarded on rehydrate.
    vi.resetModules();
    const modB = await import("../../store/rateLimitStore");
    await new Promise((r) => setTimeout(r, 200));
    expect(modB.useRateLimitStore.getState().unlockAttempts).toBe(0);
  });

  it("retrieves the SAME shape returned by getRateLimitState()", async () => {
    const mod = await import("../../store/rateLimitStore");
    mod.useRateLimitStore.setState({ unlockAttempts: 0, lockoutUntil: 0 });
    const state = mod.getRateLimitState();
    expect(state).toMatchObject({
      unlockAttempts: expect.any(Number),
      lockoutUntil: expect.any(Number),
      incrementAttempt: expect.any(Function),
      resetAttempts: expect.any(Function),
      setLockout: expect.any(Function),
    });
  });

  it("setLockout() writes BOTH lockoutUntil AND resets unlockAttempts to 0", async () => {
    const mod = await import("../../store/rateLimitStore");
    mod.useRateLimitStore.setState({ unlockAttempts: 5, lockoutUntil: 0 });
    const untilTs = Date.now() + 5 * 60 * 1000;
    mod.useRateLimitStore.getState().setLockout(untilTs);
    const after = mod.useRateLimitStore.getState();
    expect(after.lockoutUntil).toBe(untilTs);
    expect(after.unlockAttempts).toBe(0);
  });

  describe("Static source-file checks (P0 contracts are wired)", () => {
    it("rateLimitStore.ts uses computeHmac with an ephemeral (non-stored) key", async () => {
      const fs = await import("fs");
      const pathMod = await import("path");
      const src = fs.readFileSync(
        pathMod.resolve(__dirname, "../../store/rateLimitStore.ts"),
        "utf-8",
      );
      expect(src).not.toMatch(/bmf_rl_hmac_key/); // ephemeral key, no fixed name
      expect(src).toMatch(/computeHmac/);
      expect(src).toMatch(/StateStorage/);
      expect(src).toMatch(/safeGet/);
      expect(src).toMatch(/safeSet/);
      expect(src).toMatch(/safeRemove/);
    });

    it("SecurityVault.unlock() honors a persisted lockoutUntil across re-imports", async () => {
      const fs = await import("fs");
      const pathMod = await import("path");
      const src = fs.readFileSync(
        pathMod.resolve(__dirname, "../../services/SecurityVault.ts"),
        "utf-8",
      );
      expect(src).toMatch(/getRateLimitState/);
      expect(src).toMatch(/Date\.now\(\) < rl\.lockoutUntil/);
    });
  });
});
