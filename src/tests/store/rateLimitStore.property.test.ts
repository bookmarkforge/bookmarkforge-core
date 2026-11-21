// @vitest-environment jsdom
//
// Property-based tests (fast-check) for rateLimitStorage — the HMAC-signed
// persist layer behind the unlock-attempt lockout. Contracts under test:
//  1. Round-trip: any state payload setItem->getItem returns it verbatim.
//  2. Tamper-evidence: mutating ANY single character of a signed payload
//     makes getItem reject it (and erase it) — except payloads that degrade
//     to the intentionally-unsigned `u:` dev prefix.
//  3. Write ordering: burst setItem calls land in call order (the writeQueue
//     exists so a slow HMAC cannot let an older write overwrite a newer one).
//  4. Production gating: `u:`-prefixed unsigned state is always rejected.
//  5. B-01 stash: when the device key is wrapped, unverifiable state is kept
//     ephemerally via sessionStorage instead of dropped.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";

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

const KEY = "bookmarkforge-rate-limit";
const RUNS = Math.max(10, Number(process.env.FUZZ_RUNS) || 30);

// Arbitrary rate-limit state payloads (the JSON the persist middleware writes).
const stateArb = fc.record({
  unlockAttempts: fc.integer({ min: 0, max: 1_000_000 }),
  lockoutUntil: fc.oneof(
    fc.integer({ min: 0, max: 4_000_000_000 }),
    fc.constant(0),
  ),
});
const stateJsonArb = stateArb.map((s) => JSON.stringify(s));

async function freshStorage() {
  vi.resetModules();
  const mod = await import("../../store/rateLimitStore");
  return mod.rateLimitStorage;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockSecureStorage.getSecret.mockResolvedValue(null);
  mockSecureStorage.setSecret.mockResolvedValue(undefined);
  mockSecureStorage.hasSecret.mockResolvedValue(false);
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("rateLimitStore properties", () => {
  it("round-trip: any state payload survives setItem -> getItem verbatim", async () => {
    const storage = await freshStorage();
    await fc.assert(
      fc.asyncProperty(stateJsonArb, async (value) => {
        localStorage.clear();
        await storage.setItem(KEY, value);
        const got = await storage.getItem(KEY);
        localStorage.clear();
        return got === value;
      }),
      { numRuns: RUNS },
    );
  });

  it("tamper-evidence: any single-char mutation of a signed payload is rejected", async () => {
    const storage = await freshStorage();
    await fc.assert(
      fc.asyncProperty(
        stateJsonArb,
        fc.nat({ max: 500 }),
        fc.constantFrom(..."abcdef0123456789{}\":,x".split("")),
        async (value, idxArb, char) => {
          localStorage.clear();
          await storage.setItem(KEY, value);
          const raw = localStorage.getItem(KEY);
          if (raw === null) return false;
          const idx = idxArb % raw.length;
          const mutated =
            raw.slice(0, idx) + char + raw.slice(idx + 1);
          // Skip no-op mutations and payloads degrading to the unsigned
          // `u:` dev prefix (accepted by design outside production).
          if (mutated === raw || mutated.startsWith("u:")) return true;
          localStorage.setItem(KEY, mutated);
          const got = await storage.getItem(KEY);
          const removed = localStorage.getItem(KEY) === null;
          localStorage.clear();
          return got === null && removed;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("write ordering: burst setItem calls persist in call order (last wins)", async () => {
    const storage = await freshStorage();
    const { flushRateLimitWrites } = await import(
      "../../store/rateLimitStore"
    );
    await fc.assert(
      fc.asyncProperty(
        fc.array(stateJsonArb, { minLength: 2, maxLength: 8 }),
        async (values) => {
          localStorage.clear();
          // Fire all writes without awaiting — the queue must serialize them
          // in call order so the LAST value is what lands in storage.
          const pending = values.map((v) => storage.setItem(KEY, v));
          await Promise.all(pending);
          await flushRateLimitWrites();
          const got = await storage.getItem(KEY);
          localStorage.clear();
          return got === values[values.length - 1];
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("getItem is idempotent and never mutates a valid signed payload", async () => {
    const storage = await freshStorage();
    await fc.assert(
      fc.asyncProperty(stateJsonArb, async (value) => {
        localStorage.clear();
        await storage.setItem(KEY, value);
        const rawBefore = localStorage.getItem(KEY);
        const first = await storage.getItem(KEY);
        const rawMiddle = localStorage.getItem(KEY);
        const second = await storage.getItem(KEY);
        const rawAfter = localStorage.getItem(KEY);
        localStorage.clear();
        return (
          first === value &&
          second === value &&
          rawBefore === rawMiddle &&
          rawMiddle === rawAfter
        );
      }),
      { numRuns: RUNS },
    );
  });

  it("production: unsigned u: state is always rejected and erased", async () => {
    const originalProd = process.env.PROD;
    process.env.PROD = "true";
    try {
      const storage = await freshStorage();
      await fc.assert(
        fc.asyncProperty(stateJsonArb, async (value) => {
          localStorage.clear();
          localStorage.setItem(KEY, `u:${value}`);
          const got = await storage.getItem(KEY);
          const removed = localStorage.getItem(KEY) === null;
          localStorage.clear();
          return got === null && removed;
        }),
        { numRuns: RUNS },
      );
    } finally {
      if (originalProd === undefined) delete process.env.PROD;
      else process.env.PROD = originalProd;
    }
  });

  it("B-01 stash: wrapped device key keeps state via sessionStorage, not localStorage trust", async () => {
    const storage = await freshStorage();
    // Device key wrapped -> getSecret rejects like SecureStorage does.
    mockSecureStorage.getSecret.mockRejectedValue(
      new Error("Device key is wrapped — unlock the vault first"),
    );
    await fc.assert(
      fc.asyncProperty(stateJsonArb, async (value) => {
        localStorage.clear();
        sessionStorage.clear();
        // Simulate a previously-signed payload whose signature can no longer
        // be verified: state:sig with an arbitrary (now unverifiable) sig.
        localStorage.setItem(KEY, `${value}:deadbeef`);
        const got = await storage.getItem(KEY);
        const stashed = sessionStorage.getItem(`bmf_rl_stash_${KEY}`);
        localStorage.clear();
        sessionStorage.clear();
        return got === value && stashed === value;
      }),
      { numRuns: RUNS },
    );
  });
});
