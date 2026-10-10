import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockArgon2id = vi.hoisted(() => vi.fn());

vi.mock("@noble/hashes/argon2.js", () => ({
  argon2id: (...args: unknown[]) => mockArgon2id(args[0], args[1], args[2]),
}));

import {
  deriveArgon2idKey,
  importAesKey,
  deriveArgon2idAesKey,
  isMobileDevice,
} from "../../utils/argon2-kdf";

function stubNavigator(nav: unknown): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: nav,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isMobileDevice", () => {
  afterEach(() => {
    // Restore a sane navigator for the remaining tests in this file
    stubNavigator({
      maxTouchPoints: 0,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });
  });

  it("returns false when navigator is unavailable", () => {
    stubNavigator(undefined);
    expect(isMobileDevice()).toBe(false);
  });

  it("returns false when device has no touch capability", () => {
    stubNavigator({ maxTouchPoints: 0, userAgent: "iPhone" });
    expect(isMobileDevice()).toBe(false);
  });

  it("returns true for a touch-capable phone UA", () => {
    stubNavigator({
      maxTouchPoints: 5,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
    });
    expect(isMobileDevice()).toBe(true);
  });

  it("returns true for a touch-capable tablet UA", () => {
    stubNavigator({
      maxTouchPoints: 5,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Tablet Safari/537.36",
    });
    expect(isMobileDevice()).toBe(true);
  });

  it("returns false for a touch-capable desktop UA", () => {
    stubNavigator({
      maxTouchPoints: 10,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    expect(isMobileDevice()).toBe(false);
  });

  it("treats a touch device with a non-string userAgent as desktop", () => {
    stubNavigator({ maxTouchPoints: 5, userAgent: undefined });
    expect(isMobileDevice()).toBe(false);
  });

  it("returns false when reading navigator throws", () => {
    stubNavigator(
      new Proxy(
        {},
        {
          get() {
            throw new Error("denied");
          },
        },
      ),
    );
    expect(isMobileDevice()).toBe(false);
  });

  it("returns false when reading navigator.userAgent throws", () => {
    stubNavigator({
      maxTouchPoints: 5,
      get userAgent() {
        throw new Error("Cannot access userAgent");
      },
    });
    expect(isMobileDevice()).toBe(false);
  });
});

describe("argon2-kdf", () => {
  beforeEach(() => {
    mockArgon2id.mockImplementation((pw: Uint8Array, salt: Uint8Array, opts: { dkLen: number }) => {
      const out = new Uint8Array(opts.dkLen);
      for (let i = 0; i < opts.dkLen; i++) {
        out[i] = (pw[i % pw.length] ?? 0) ^ (salt[i % salt.length] ?? 0) ^ i;
      }
      return out;
    });
    mockArgon2id.mockClear();
  });

  it("derives a 32-byte key from password and salt", async () => {
    const pw = new TextEncoder().encode("password");
    const salt = new TextEncoder().encode("salt");
    const key = await deriveArgon2idKey(pw, salt);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it("does not mutate the input password buffer", async () => {
    const pw = new TextEncoder().encode("password");
    const before = new Uint8Array(pw);
    const salt = new TextEncoder().encode("salt");
    await deriveArgon2idKey(pw, salt);
    // Compare element-wise via Array.from: the implementation zeroizes its
    // internal working copy, and vitest's toEqual on cross-realm TypedArrays
    // (Node TextEncoder vs jsdom global) is unreliable.
    expect(Array.from(pw)).toEqual(Array.from(before));
  });

  it("passes derived-key parameters to argon2id", async () => {
    const pw = new TextEncoder().encode("password");
    const salt = new TextEncoder().encode("salt");
    // Snapshot the args at call time: deriveArgon2idKey zeroizes its working
    // copy (pwCopy.fill(0)) after argon2id returns, so the reference captured
    // by mock.calls is already cleared by the time we assert.
    let capturedPw: number[] = [];
    let capturedSalt: number[] = [];
    let capturedOpts: { dkLen: number } | null = null;
    mockArgon2id.mockImplementation(
      (p: Uint8Array, s: Uint8Array, o: { dkLen: number }) => {
        capturedPw = Array.from(p);
        capturedSalt = Array.from(s);
        capturedOpts = o;
        return new Uint8Array(o.dkLen);
      },
    );
    await deriveArgon2idKey(pw, salt);
    expect(capturedPw).toEqual(Array.from(pw));
    expect(capturedSalt).toEqual(Array.from(salt));
    expect(capturedOpts).toEqual(expect.objectContaining({ dkLen: 32 }));
  });

  it("imports an AES-GCM key from raw bytes", async () => {
    const raw = new Uint8Array(32).fill(0xab);
    const key = await importAesKey(raw);
    expect(key).toBeDefined();
    expect(key.algorithm.name).toBe("AES-GCM");
    expect(key.usages).toEqual(["encrypt", "decrypt"]);
  });

  it("derives an AES key in one step", async () => {
    const pw = new TextEncoder().encode("password");
    const salt = new TextEncoder().encode("salt");
    const key = await deriveArgon2idAesKey(pw, salt);
    expect(key).toBeDefined();
    expect(key.algorithm.name).toBe("AES-GCM");
  });

  it("uses the fast test parameters in test mode", async () => {
    let capturedOpts: { t: number; m: number; p: number; dkLen: number } | null =
      null;
    mockArgon2id.mockImplementation(
      (_p: Uint8Array, _s: Uint8Array, o: { t: number; m: number; p: number; dkLen: number }) => {
        capturedOpts = o;
        return new Uint8Array(o.dkLen);
      },
    );
    await deriveArgon2idKey(new TextEncoder().encode("pw"), new TextEncoder().encode("salt"));
    expect(capturedOpts).toEqual({ t: 1, m: 8192, p: 1, dkLen: 32 });
  });

  it("caches the argon2 module across calls", async () => {
    await deriveArgon2idKey(new Uint8Array(16), new Uint8Array(16));
    await deriveArgon2idKey(new Uint8Array(16), new Uint8Array(16));
    expect(mockArgon2id).toHaveBeenCalledTimes(2);
  });

  it("propagates errors when argon2id is not a function", async () => {
    mockArgon2id.mockImplementationOnce(() => {
      throw new Error("@noble/hashes/argon2.argon2id is not a function");
    });
    await expect(
      deriveArgon2idKey(new Uint8Array(16), new Uint8Array(16)),
    ).rejects.toThrow("argon2id is not a function");
  });
});
