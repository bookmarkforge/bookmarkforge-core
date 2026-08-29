import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../i18n", () => ({
  default: { t: (key: string) => key },
}));

import { EncryptionService, encryptionService } from "../../services/EncryptionService";

describe("EncryptionService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  describe("isEncrypted", () => {
    it("returns false for empty string", () => {
      expect(encryptionService.isEncrypted("")).toBe(false);
    });

    it("returns false for non-string", () => {
      expect(encryptionService.isEncrypted(null as any)).toBe(false);
      expect(encryptionService.isEncrypted(undefined as any)).toBe(false);
      expect(encryptionService.isEncrypted(123 as any)).toBe(false);
    });

    it("returns false for short strings", () => {
      expect(encryptionService.isEncrypted("v4:abc")).toBe(false);
    });

    it("returns true for valid v4 encrypted data", () => {
      const validBase64 = "A".repeat(40);
      expect(encryptionService.isEncrypted(`v4:${validBase64}`)).toBe(true);
    });

    it("returns false for valid base64 without a v4:/v5: prefix", () => {
      const validBase64 = "B".repeat(40);
      expect(encryptionService.isEncrypted(validBase64)).toBe(false);
    });

    it("returns false for invalid base64 characters", () => {
      expect(encryptionService.isEncrypted("v4:" + "!".repeat(20))).toBe(
        false,
      );
    });

    it("returns false for strings with exactly 12 base64 chars after v4:", () => {
      expect(encryptionService.isEncrypted("v4:" + "A".repeat(12))).toBe(
        false,
      );
    });

    it("returns false for strings below the 40-char minimum body", () => {
      // 16-byte salt + 12-byte IV + 1+ bytes ciphertext ≈ 40 base64 chars.
      expect(encryptionService.isEncrypted("v4:" + "A".repeat(39))).toBe(
        false,
      );
    });

    it("handles base64 padding characters", () => {
      expect(encryptionService.isEncrypted("v4:" + "A".repeat(38) + "==")).toBe(
        true,
      );
      // 20 chars + padding is below the 40-char minimum body.
      expect(encryptionService.isEncrypted("v4:" + "A".repeat(20) + "=")).toBe(
        false,
      );
    });
  });

  describe("encrypt/decrypt roundtrip", () => {
    it("encrypts and decrypts text", async () => {
      const plaintext = "Hello, World!";
      const password = "test-password-123";

      const encrypted = await encryptionService.encrypt(plaintext, password);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toMatch(/^v5:/);

      const decrypted = await encryptionService.decrypt(encrypted, password);
      expect(decrypted).toBe(plaintext);
    });

    it("fails to decrypt with wrong password", async () => {
      const plaintext = "Secret data";
      const encrypted = await encryptionService.encrypt(
        plaintext,
        "correct-password",
      );

      await expect(
        encryptionService.decrypt(encrypted, "wrong-password"),
      ).rejects.toThrow();
    });

    it("encrypts empty string", async () => {
      const encrypted = await encryptionService.encrypt("", "password");
      const decrypted = await encryptionService.decrypt(encrypted, "password");
      expect(decrypted).toBe("");
    });

    it("encrypts unicode text", async () => {
      const plaintext = "你好世界 🌍";
      const encrypted = await encryptionService.encrypt(plaintext, "password");
      const decrypted = await encryptionService.decrypt(encrypted, "password");
      expect(decrypted).toBe(plaintext);
    });

    it("encrypts long text", async () => {
      const plaintext = "A".repeat(10000);
      const encrypted = await encryptionService.encrypt(plaintext, "password");
      const decrypted = await encryptionService.decrypt(encrypted, "password");
      expect(decrypted).toBe(plaintext);
    });

    it("produces different ciphertext for same plaintext (random IV)", async () => {
      const plaintext = "Same text";
      const enc1 = await encryptionService.encrypt(plaintext, "password");
      const enc2 = await encryptionService.encrypt(plaintext, "password");
      expect(enc1).not.toBe(enc2);
    });
  });

  describe("encrypt/decrypt with bytes", () => {
    it("encrypts with Uint8Array password", async () => {
      const plaintext = "Binary password test";
      const passwordBytes = new TextEncoder().encode("byte-password");

      const encrypted = await encryptionService.encryptWithBytes(
        plaintext,
        passwordBytes,
      );
      expect(encrypted).not.toBe(plaintext);
      expect(typeof encrypted).toBe("string");
    });

    it("decrypts with Uint8Array password", async () => {
      const plaintext = "Decrypt with bytes";
      const passwordBytes = new TextEncoder().encode("byte-password");

      const encrypted = await encryptionService.encryptWithBytes(
        plaintext,
        passwordBytes,
      );
      // passwordBytes was zeroed by encryptWithBytes; pass a fresh copy
      const decrypted = await encryptionService.decryptWithBytes(
        encrypted,
        new TextEncoder().encode("byte-password"),
      );
      expect(decrypted).toBe(plaintext);
    });

    it("fails to decrypt with wrong byte password", async () => {
      const plaintext = "Wrong bytes test";
      const encrypted = await encryptionService.encryptWithBytes(
        plaintext,
        new TextEncoder().encode("correct"),
      );

      await expect(
        encryptionService.decryptWithBytes(
          encrypted,
          new TextEncoder().encode("wrong"),
        ),
      ).rejects.toThrow();
    });
  });

  describe("binary encrypt/decrypt", () => {
    it("encrypts and decrypts binary data", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const password = "binary-test";

      const encrypted = await encryptionService.encryptBinary(data, password);
      expect(encrypted).not.toEqual(data);

      const decrypted = await encryptionService.decryptBinary(
        encrypted,
        password,
      );
      expect(decrypted).toEqual(data);
    });

    it("encrypts empty binary data", async () => {
      const data = new Uint8Array(0);
      const encrypted = await encryptionService.encryptBinary(data, "password");
      const decrypted = await encryptionService.decryptBinary(
        encrypted,
        "password",
      );
      expect(decrypted).toEqual(data);
    });

    it("encrypts large binary data", async () => {
      const data = new Uint8Array(10000).fill(42);
      const encrypted = await encryptionService.encryptBinary(data, "password");
      const decrypted = await encryptionService.decryptBinary(
        encrypted,
        "password",
      );
      expect(decrypted).toEqual(data);
    });
  });

  describe("deriveDbKey", () => {
    it("derives a database key", async () => {
      const key = await encryptionService.deriveDbKey(
        "password",
        "salt12345",
      );
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    });

    it("produces consistent keys", async () => {
      const key1 = await encryptionService.deriveDbKey("password", "salt");
      const key2 = await encryptionService.deriveDbKey("password", "salt");
      expect(key1).toBe(key2);
    });

    it("produces different keys for different passwords", async () => {
      const key1 = await encryptionService.deriveDbKey("password1", "salt");
      const key2 = await encryptionService.deriveDbKey("password2", "salt");
      expect(key1).not.toBe(key2);
    });

    it("produces different keys for different salts", async () => {
      const key1 = await encryptionService.deriveDbKey("password", "salt1");
      const key2 = await encryptionService.deriveDbKey("password", "salt2");
      expect(key1).not.toBe(key2);
    });

    it("derives key with bytes", async () => {
      const passwordBytes = new TextEncoder().encode("password");
      const key = await encryptionService.deriveDbKeyWithBytes(
        passwordBytes,
        "salt",
      );
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    });

    it("derives consistent key with bytes", async () => {
      const key1 = await encryptionService.deriveDbKeyWithBytes(
        new TextEncoder().encode("password"),
        "salt",
      );
      const key2 = await encryptionService.deriveDbKeyWithBytes(
        new TextEncoder().encode("password"),
        "salt",
      );
      expect(key1).toBe(key2);
    });
  });

  describe("hash", () => {
    it("produces a hash", async () => {
      const hash = await encryptionService.hash("test-input");
      expect(typeof hash).toBe("string");
      expect(hash.length).toBeGreaterThan(0);
    });

    it("produces consistent hashes", async () => {
      const hash1 = await encryptionService.hash("same-input");
      const hash2 = await encryptionService.hash("same-input");
      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different inputs", async () => {
      const hash1 = await encryptionService.hash("input-1");
      const hash2 = await encryptionService.hash("input-2");
      expect(hash1).not.toBe(hash2);
    });

    it("hashes empty string", async () => {
      const hash = await encryptionService.hash("");
      expect(typeof hash).toBe("string");
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  describe("session key operations", () => {
    it("encrypts and decrypts with session key", async () => {
      const data = new Uint8Array([10, 20, 30, 40, 50]);
      const password = "session-test";

      const encrypted = await encryptionService.encryptWithSessionKey(
        data,
        password,
      );
      const decrypted = await encryptionService.decryptWithSessionKey(
        encrypted,
        password,
      );
      expect(decrypted).toEqual(data);
    });

    it("fails session decrypt with wrong password", async () => {
      const data = new Uint8Array([10, 20, 30]);
      const encrypted = await encryptionService.encryptWithSessionKey(
        data,
        "correct",
      );

      await expect(
        encryptionService.decryptWithSessionKey(encrypted, "wrong"),
      ).rejects.toThrow();
    });
  });

  describe("clearDatabase", () => {
    it("clears without error", async () => {
      await expect(
        encryptionService.clearDatabase("password"),
      ).resolves.not.toThrow();
    });
  });

  describe("error handling", () => {
    it("wraps encryption errors with i18n key", async () => {
      await expect(
        encryptionService.decrypt("not-valid-base64!@#", "password"),
      ).rejects.toThrow("decryptionError");
    });

    it("wraps decryption errors with i18n key", async () => {
      const encrypted = await encryptionService.encrypt("test-error", "password");
      const corrupted = encrypted.slice(0, -5) + "XXXXX";
      await expect(
        encryptionService.decrypt(corrupted, "password"),
      ).rejects.toThrow("decryptionError");
    });
  });

  describe("isEncrypted edge cases", () => {
    it("returns false for v4: with only spaces", () => {
      expect(encryptionService.isEncrypted("v4:            ")).toBe(false);
    });

    it("returns true for v4:/v5: with valid base64 and padding", () => {
      const valid = "A".repeat(38) + "=="; // 40 base64 chars incl. padding
      expect(encryptionService.isEncrypted(`v4:${valid}`)).toBe(true);
      expect(encryptionService.isEncrypted(`v5:${valid}`)).toBe(true);
    });

    it("handles strings that look like v4 but aren't", () => {
      expect(encryptionService.isEncrypted("v4:")).toBe(false);
      expect(encryptionService.isEncrypted("v4:abc")).toBe(false);
    });
  });

  describe("destroy and clear", () => {
    it("destroy is a function", () => {
      expect(typeof encryptionService.destroy).toBe("function");
    });

    it("clear is a function", () => {
      expect(typeof encryptionService.clear).toBe("function");
    });
  });

  describe("coverage gaps", () => {
    it("runOnMainThread throws for unknown operation", async () => {
      const service = new EncryptionService();
      await expect(
        (service as any).runOnMainThread("unknown-op", { text: "x", password: "p" }),
      ).rejects.toThrow("Unknown crypto operation: unknown-op");
    });

    it("runOnMainThread throws when password is missing", async () => {
      const service = new EncryptionService();
      await expect(
        (service as any).runOnMainThread("encrypt", { text: "x" }),
      ).rejects.toThrow("Missing password or passwordBytes in payload");
    });

    it("zeroBytes overwrites bytes", () => {
      const service = new EncryptionService();
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      (service as any).zeroBytes(bytes);
      expect(bytes.every((b) => b === 0)).toBe(true);
    });

    it("does not zeroize a byte password twice on the main-thread fallback", async () => {
      const service = new EncryptionService();
      const zeroSpy = vi.spyOn(service as any, "zeroBytes");
      const passwordBytes = new TextEncoder().encode("ownership-test");

      await (service as any).runOnMainThread(
        "encrypt",
        { text: "payload" },
        passwordBytes,
      );

      expect(zeroSpy).toHaveBeenCalledTimes(1);
      expect(passwordBytes.every((byte) => byte === 0)).toBe(true);
      zeroSpy.mockRestore();
    });

    it("clear resets state and terminates worker", () => {
      const service = new EncryptionService();
      (service as any).worker = { terminate: vi.fn() };
      const rejectPending = vi.fn();
      (service as any).pendingRequests.set("req-1", {
        resolve: vi.fn(),
        reject: rejectPending,
        resolved: false,
      });
      (service as any).fatalError = new Error("fatal");
      (service as any).clear();
      expect(rejectPending).toHaveBeenCalledWith(
        expect.objectContaining({ message: "EncryptionService cleared" }),
      );
      expect((service as any).pendingRequests.size).toBe(0);
      expect((service as any).fatalError).toBeNull();
      expect((service as any).initialized).toBe(false);
      expect((service as any).worker).toBeNull();
    });

    it("destroy calls clear", async () => {
      const service = new EncryptionService();
      const clearSpy = vi.spyOn(service as any, "clear");
      await service.destroy();
      expect(clearSpy).toHaveBeenCalled();
    });

    it("ensureInitialized throws when initPromise resolves but not initialized", async () => {
      const service = new EncryptionService();
      // Wait for the original initPromise so it cannot override our setup
      await (service as any).initPromise;
      (service as any).initialized = false;
      (service as any).initPromise = Promise.resolve();
      await expect((service as any).ensureInitialized()).rejects.toThrow(
        "EncryptionService initialization failed",
      );
    });

    it("ensureInitialized lazily re-initializes after destroy/clear (initPromise null)", async () => {
      const service = new EncryptionService();
      // Simulate a destroy()/clear() — the state the service is left in
      // after the security store calls destroy() on force-setup.
      await (service as any).initPromise;
      (service as any).initPromise = null;
      (service as any).initialized = false;
      await expect((service as any).ensureInitialized()).resolves.toBeUndefined();
      expect((service as any).initialized).toBe(true);
      // The service must be fully usable again after re-init (vault setup
      // calls encrypt() right after the force-setup destroy()).
      const encrypted = await service.encrypt("roundtrip", "pw");
      expect(await service.decrypt(encrypted, "pw")).toBe("roundtrip");
    });

    it("ensureInitialized still throws when fatalError is set (no auto-recovery)", async () => {
      const service = new EncryptionService();
      (service as any).initPromise = null;
      (service as any).initialized = false;
      (service as any).fatalError = new Error("fatal worker state");
      await expect((service as any).ensureInitialized()).rejects.toThrow(
        "EncryptionService not initialized",
      );
    });

    it("runInWorker settles and cleans up when postMessage throws", async () => {
      class ThrowingWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage() {
          throw new Error("post failed");
        }
        terminate = vi.fn();
      }
      vi.stubGlobal("Worker", ThrowingWorker);

      const service = new EncryptionService();
      (service as any).useWorker = true;
      (service as any).worker = null;

      await expect(
        (service as any).runInWorker("hash", { input: "test" }),
      ).rejects.toThrow("post failed");
      expect((service as any).pendingRequests.size).toBe(0);
    });

    it("runInWorker with mock worker returns result", async () => {
      class MockWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage(data: any) {
          setTimeout(() => {
            this.onmessage?.({ data: { id: data.id, result: "hashed-value" } } as MessageEvent);
          }, 0);
        }
        terminate = vi.fn();
      }
      vi.stubGlobal("Worker", MockWorker);

      const service = new EncryptionService();
      (service as any).useWorker = true;
      (service as any).worker = null;

      const result = await (service as any).runInWorker("hash", { input: "test" });
      expect(result).toBe("hashed-value");
    });

    it("runInWorker with mock worker rejects on error response", async () => {
      class MockWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage(data: any) {
          setTimeout(() => {
            this.onmessage?.({ data: { id: data.id, error: "worker error" } } as MessageEvent);
          }, 0);
        }
        terminate = vi.fn();
      }
      vi.stubGlobal("Worker", MockWorker);

      const service = new EncryptionService();
      (service as any).useWorker = true;
      (service as any).worker = null;

      await expect(
        (service as any).runInWorker("hash", { input: "test" }),
      ).rejects.toThrow("worker error");
    });

    it("runInWorker handles fatal worker error", async () => {
      class MockWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage(data: any) {
          setTimeout(() => {
            this.onmessage?.({
              data: { id: data.id, type: "FATAL_WORKER_ERROR", error: "fatal" },
            } as MessageEvent);
          }, 0);
        }
        terminate = vi.fn();
      }
      vi.stubGlobal("Worker", MockWorker);

      const service = new EncryptionService();
      (service as any).useWorker = true;
      (service as any).worker = null;

      const pending = {
        resolve: vi.fn(),
        reject: vi.fn(),
        resolved: false,
      };
      (service as any).pendingRequests.set("existing-req", pending);

      await expect(
        (service as any).runInWorker("hash", { input: "test" }),
      ).rejects.toThrow("fatal");
      expect(pending.resolved).toBe(true);
    });

    it("runInWorker handles worker.onerror", async () => {
      class MockWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage() {
          setTimeout(() => {
            this.onerror?.({ message: "worker error" } as ErrorEvent);
          }, 0);
        }
        terminate = vi.fn();
      }
      vi.stubGlobal("Worker", MockWorker);

      const service = new EncryptionService();
      (service as any).useWorker = true;
      (service as any).worker = null;

      await expect(
        (service as any).runInWorker("hash", { input: "test" }),
      ).rejects.toThrow("Crypto worker encountered an error");
    });

    it("runInWorker throws when worker API unavailable", async () => {
      vi.stubGlobal("Worker", undefined);
      const service = new EncryptionService();
      (service as any).useWorker = true;
      (service as any).worker = null;
      await expect(
        (service as any).runInWorker("hash", { input: "test" }),
      ).rejects.toThrow("Web Worker API is not available");
    });

    it("hash wraps worker errors", async () => {
      const service = new EncryptionService();
      vi.spyOn(service as any, "runInWorker").mockRejectedValue(new Error("fail"));
      await expect(service.hash("x")).rejects.toThrow("encryptionError");
    });

    it("clearDatabase wraps worker errors", async () => {
      const service = new EncryptionService();
      vi.spyOn(service as any, "runInWorker").mockRejectedValue(new Error("fail"));
      await expect(service.clearDatabase("pw")).rejects.toThrow("encryptionError");
    });
  });
});
