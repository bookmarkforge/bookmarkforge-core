/**
 * src/tests/security-integration.test.ts
 *
 * Integration tests for post-audit security hardening:
 *   - V5 encryption round-trip and V4 backward compatibility
 *   - HKDF session-key batching (1× Argon2id → N× HKDF)
 *   - Web Locks device-key cross-tab serialization
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  encrypt,
  decrypt,
  encryptWithSessionKey,
  decryptWithSessionKey,
  resetSessionKeyCache,
  generateSecureSalt,
  u8aToBase64,
} from "../utils/crypto-core";
import { deriveArgon2idAesKey } from "../utils/argon2-kdf";

// ── V5 encryption round-trip & backward compatibility ──────────────────

describe("V5 encryption format", () => {
  const password = "correct-horse-battery-staple";

  it("encrypts with v5: prefix", async () => {
    const result = await encrypt("hello world", password);
    expect(result).toMatch(/^v5:[A-Za-z0-9+/=]+$/);
  });

  it("round-trips with the same password", async () => {
    const original = "The vault password is invalid.";
    const encrypted = await encrypt(original, password);
    const decrypted = await decrypt(encrypted, password);
    expect(decrypted).toBe(original);
  });

  it("fails to decrypt with a wrong password", async () => {
    const encrypted = await encrypt("sensitive data", password);
    await expect(decrypt(encrypted, "wrong-password")).rejects.toThrow();
  });

  it("produces different ciphertexts for the same plaintext", async () => {
    const c1 = await encrypt("hello", password);
    const c2 = await encrypt("hello", password);
    expect(c1).not.toBe(c2); // unique HKDF salt per operation
  });

  it("decrypts V4 format (backward compatibility)", async () => {
    // Manually construct a V4 payload using the V4 wire format that the
    // current decrypt() reads: v4:<base64(argon2_salt_16 || iv_12 || ct)>.
    // (V4 was Argon2id-per-operation from ADR-019; the legacy V2 format is
    // PBKDF2, not V4 — earlier versions of this fixture used PBKDF2 by
    // mistake, so it could never be decrypted by the Argon2id v4 path.)
    const text = "legacy V4 data";
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();

    // Derive the AES-GCM key via Argon2id — exactly what v4 encrypt/decrypt
    // do with the salt carried in the payload.
    const aesKey = await deriveArgon2idAesKey(encoder.encode(password), salt);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aesKey,
      encoder.encode(text),
    );

    const payload = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
    payload.set(salt, 0);
    payload.set(iv, salt.length);
    payload.set(new Uint8Array(ciphertext), salt.length + iv.length);

    const v4Payload = "v4:" + u8aToBase64(payload);
    const decrypted = await decrypt(v4Payload, password);
    expect(decrypted).toBe(text);
  });

  it("rejects unsupported format prefixes", async () => {
    await expect(decrypt("v1:AAAA", password)).rejects.toThrow(/format/);
    await expect(decrypt("v3:AAAA", password)).rejects.toThrow(/format/);
    await expect(decrypt("not-encrypted", password)).rejects.toThrow(/format/);
  });

  it("handles empty string", async () => {
    const encrypted = await encrypt("", password);
    const decrypted = await decrypt(encrypted, password);
    expect(decrypted).toBe("");
  });

  it("handles Unicode text", async () => {
    const text = "日本語テスト 🚀🔥 Café résumé العربية";
    const encrypted = await encrypt(text, password);
    const decrypted = await decrypt(encrypted, password);
    expect(decrypted).toBe(text);
  });

  it("handles long text (> 10 KB)", async () => {
    const text = "The quick brown fox. ".repeat(500); // ~14 KB
    const encrypted = await encrypt(text, password);
    const decrypted = await decrypt(encrypted, password);
    expect(decrypted).toBe(text);
  });
});

// ── HKDF session-key batching (S6 optimization) ────────────────────────

describe("HKDF session-key batching", () => {
  const password = "session-password";

  afterEach(() => {
    resetSessionKeyCache();
  });

  it("round-trips a single encrypt/decrypt", async () => {
    const data = new TextEncoder().encode("session data");
    const encrypted = await encryptWithSessionKey(data, password);
    const decrypted = await decryptWithSessionKey(encrypted, password);
    expect(decrypted).toEqual(data);
  });

  it("produces different ciphertexts for the same data", async () => {
    const data = new TextEncoder().encode("repeat");
    const c1 = await encryptWithSessionKey(data, password);
    const c2 = await encryptWithSessionKey(data, password);
    expect(c1).not.toEqual(c2); // unique HKDF salt per op
  });

  it("master key is cached across operations", async () => {
    // First call derives the master key (Argon2id)
    const d1 = new TextEncoder().encode("first");
    const e1 = await encryptWithSessionKey(d1, password);

    // Second call with same password reuses cached master key (HKDF only)
    const d2 = new TextEncoder().encode("second");
    const e2 = await encryptWithSessionKey(d2, password);

    // Both should decrypt correctly
    expect(await decryptWithSessionKey(e1, password)).toEqual(d1);
    expect(await decryptWithSessionKey(e2, password)).toEqual(d2);
  });

  it("different passwords produce incompatible ciphertexts", async () => {
    const data = new TextEncoder().encode("data");
    const encrypted = await encryptWithSessionKey(data, "password-A");
    await expect(
      decryptWithSessionKey(encrypted, "password-B"),
    ).rejects.toThrow();
  });

  it("resetSessionKeyCache clears the cached master key", async () => {
    const data = new TextEncoder().encode("pre-reset");
    const encrypted = await encryptWithSessionKey(data, password);
    resetSessionKeyCache();

    // Should still decrypt because the per-op key is deterministic
    // from the master key which gets re-derived on decrypt
    const decrypted = await decryptWithSessionKey(encrypted, password);
    expect(decrypted).toEqual(data);
  });
});

// ── Web Locks device-key serialization ─────────────────────────────────

describe("Web Locks API (cross-tab mutual exclusion)", () => {
  let lockQueue: Array<() => void> = [];
  let activeLock: string | null = null;
  let createdNavigator = false;

  beforeEach(() => {
    lockQueue = [];
    activeLock = null;

    // Mock navigator.locks with a real queue-based lock. The navigator
    // holder is ensured first because Node 20 (CI's pinned version) has no
    // navigator global at all — it arrived in Node 21, and this checkout's
    // Node 24 made the test pass locally while the Linux nightly died with
    // "ReferenceError: navigator is not defined" (run 35833219915). On Node
    // 24 `navigator` is a getter-only global, so the property must be defined
    // on it rather than reassigned (which throws "Cannot set property
    // navigator of #<Object> which has only a getter"); on Node 20 a plain
    // globalThis holder is created and deleted per test.
    const globalHolder = globalThis as { navigator?: unknown } & Record<string, unknown>;
    createdNavigator = !globalHolder.navigator;
    const nav = globalHolder.navigator ?? (globalHolder.navigator = {});
    Object.defineProperty(nav, "locks", {
      value: {
        request: vi.fn(
          (name: string, callback: (lock: unknown) => Promise<unknown>) => {
            return new Promise((resolve, reject) => {
              const executeWhenAvailable = async () => {
                activeLock = name;
                try {
                  const result = await callback({ name });
                  resolve(result);
                } catch (e) {
                  reject(e);
                } finally {
                  activeLock = null;
                  // Release next waiter
                  const next = lockQueue.shift();
                  if (next) next();
                }
              };

              if (activeLock === null) {
                executeWhenAvailable();
              } else {
                lockQueue.push(executeWhenAvailable);
              }
            });
          },
        ),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    const holder = (globalThis as { navigator?: unknown }).navigator as
      | Record<string, unknown>
      | undefined;
    if (holder) delete holder.locks;
    // Node 20: the holder itself was created by this suite — remove it so the
    // global surface is unchanged for other tests. Node 21+: navigator is a
    // real getter-only global, createdNavigator stays false and the global is
    // left alone.
    if (createdNavigator) delete (globalThis as Record<string, unknown>).navigator;
    vi.restoreAllMocks();
  });

  it("acquires a lock with the correct name", async () => {
    const locks = (globalThis as any).navigator.locks;
    let capturedName = "";

    await locks.request("test-lock", async (lock: any) => {
      capturedName = lock.name;
      return "done";
    });

    expect(capturedName).toBe("test-lock");
    expect(locks.request).toHaveBeenCalled();
  });

  it("serializes two concurrent callers", async () => {
    const locks = (globalThis as any).navigator.locks;
    const order: string[] = [];

    const p1 = locks.request("shared-lock", async () => {
      order.push("first-enter");
      await new Promise((r) => setTimeout(r, 10));
      order.push("first-exit");
      return "result-1";
    });

    const p2 = locks.request("shared-lock", async () => {
      order.push("second-enter");
      order.push("second-exit");
      return "result-2";
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("result-1");
    expect(r2).toBe("result-2");
    expect(order).toEqual([
      "first-enter",
      "first-exit",
      "second-enter",
      "second-exit",
    ]);
  });

  it("releases lock on error so next waiter proceeds", async () => {
    const locks = (globalThis as any).navigator.locks;
    let secondRan = false;

    const p1 = locks.request("error-lock", async () => {
      throw new Error("lock failure");
    });

    const p2 = locks.request("error-lock", async () => {
      secondRan = true;
      return "second-ok";
    });

    await expect(p1).rejects.toThrow("lock failure");
    const r2 = await p2;
    expect(r2).toBe("second-ok");
    expect(secondRan).toBe(true);
  });
});
