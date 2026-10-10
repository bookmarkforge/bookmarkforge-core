import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

describe("CryptoWorker", () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = 0x42;
        return arr;
      },
      subtle: {
        importKey: vi.fn().mockResolvedValue({} as CryptoKey),
        encrypt: vi.fn().mockResolvedValue(new ArrayBuffer(16)),
        decrypt: vi
          .fn()
          .mockResolvedValue(
            new TextEncoder().encode("decrypted content").buffer,
          ),
        digest: vi
          .fn()
          .mockResolvedValue(new TextEncoder().encode("hash-output").buffer),
        deriveKey: vi.fn().mockResolvedValue({} as CryptoKey),
        exportKey: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      },
    });

    postMessageSpy = vi.fn();
    self.postMessage = postMessageSpy as any;

    await import("../../workers/crypto.worker");
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  const fireMessage = async (data: Record<string, unknown>) => {
    const handler = self.onmessage as unknown as (
      e: MessageEvent,
    ) => Promise<void>;
    await handler({ data } as MessageEvent);
  };

  const clearAndFire = async (data: Record<string, unknown>) => {
    postMessageSpy.mockClear();
    await fireMessage(data);
  };

  describe("module loading", () => {
    it("sets self.onmessage handler after import", () => {
      expect(typeof self.onmessage).toBe("function");
    });
  });

  describe("message validation", () => {
    it("bounds queue bursts and zeroizes rejected password payloads", async () => {
      postMessageSpy.mockClear();
      const passwordBytes = new Uint8Array([21, 22, 23, 24]);
      const queuedPromises: Promise<void>[] = [];

      for (let index = 0; index < 120; index += 1) {
        const payload = index === 119
          ? { passwordBytes, text: "sensitive" }
          : { text: "queued" };
        queuedPromises.push(
          (self.onmessage as unknown as (e: MessageEvent) => Promise<void>)({
            data: { id: `burst-${index}`, type: "hash", payload },
          } as MessageEvent),
        );
      }
      await Promise.all(queuedPromises);

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "burst-119",
          error: "Crypto worker queue is full",
          code: "QUEUE_FULL",
        }),
      );
      expect(passwordBytes.every((byte) => byte === 0)).toBe(true);
    });

    it("returns error when id is missing", async () => {
      await fireMessage({ type: "encrypt" });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "unknown",
          error: "Missing required fields: id, type",
        }),
      );
    });

    it("returns error when type is missing", async () => {
      await fireMessage({ id: "t1" });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "t1",
          error: "Missing required fields: id, type",
        }),
      );
    });

    it("returns error for unknown message type", async () => {
      await fireMessage({ id: "t1", type: "UNKNOWN", payload: {} });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "t1",
          error: "Unknown crypto worker type: UNKNOWN",
        }),
      );
    });

    it("zeroizes password bytes on an early validation return", async () => {
      const passwordBytes = new Uint8Array([1, 2, 3, 4]);
      await fireMessage({
        id: "missing-type",
        payload: { passwordBytes },
      });

      expect(passwordBytes.every((byte) => byte === 0)).toBe(true);
    });

    it("zeroizes password bytes for unsupported operations", async () => {
      const passwordBytes = new Uint8Array([5, 6, 7, 8]);
      await fireMessage({
        id: "unknown-with-password",
        type: "UNKNOWN",
        payload: { passwordBytes },
      });

      expect(passwordBytes.every((byte) => byte === 0)).toBe(true);
    });
  });

  describe("encrypt operation", () => {
    it("encrypts text and returns result with matching id", async () => {
      await clearAndFire({
        id: "enc1",
        type: "encrypt",
        payload: { text: "hello", password: "secret" },
      });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "enc1", result: expect.any(String) }),
      );
    });

    it("releases original plaintext and password references after sanitizing", async () => {
      const payload = { text: "sensitive plaintext", password: "secret" };
      await clearAndFire({ id: "release-refs", type: "encrypt", payload });

      expect(payload.text).toBe("");
      expect(payload.password).toBe("");
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "release-refs", result: expect.any(String) }),
      );
    });
  });

  describe("decrypt operation", () => {
    it("decrypts v4: prefixed data and returns result with matching id", async () => {
      const combined = new Uint8Array(44);
      combined.fill(0x42);
      const encryptedBase64 = "v4:" + btoa(String.fromCharCode(...combined));
      await clearAndFire({
        id: "dec1",
        type: "decrypt",
        payload: { encryptedBase64, password: "secret" },
      });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "dec1", result: expect.any(String) }),
      );
    });
  });

  describe("hash operation", () => {
    it("returns a hex-encoded SHA-256 hash string", async () => {
      await clearAndFire({
        id: "h1",
        type: "hash",
        payload: { input: "test input" },
      });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "h1", result: expect.any(String) }),
      );
      const call = postMessageSpy.mock.calls[0]![0];
      expect(call.result.length).toBeGreaterThan(0);
    });
  });

  describe("generateSecureSalt operation", () => {
    it("returns a hex-encoded 32-byte salt string", async () => {
      await clearAndFire({
        id: "salt1",
        type: "generateSecureSalt",
        payload: {},
      });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "salt1", result: expect.any(String) }),
      );
      const call = postMessageSpy.mock.calls[0]![0];
      expect(call.result).toBe(
        "4242424242424242424242424242424242424242424242424242424242424242",
      );
    });
  });

  describe("decryptWithSessionKey operation", () => {
    it("decrypts session-encrypted data and returns result", async () => {
      const data = new Uint8Array(60);
      data.fill(0x42);
      await clearAndFire({
        id: "dsk1",
        type: "decryptWithSessionKey",
        payload: { data, password: "testpass" },
      });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "dsk1" }),
        expect.any(Array),
      );
    });
  });

  describe("clearDatabase operation", () => {
    it("clears session key cache and returns ok", async () => {
      await clearAndFire({
        id: "clr1",
        type: "clearDatabase",
        payload: {},
      });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "clr1", result: "ok" }),
      );
    });

    it("zeroizes an accidentally supplied password buffer", async () => {
      const passwordBytes = new Uint8Array([9, 10, 11, 12]);
      await clearAndFire({
        id: "clr-password",
        type: "clearDatabase",
        payload: { passwordBytes },
      });

      expect(passwordBytes.every((byte) => byte === 0)).toBe(true);
    });
  });

  describe("reset-session operation", () => {
    it("clears session key cache and returns ok", async () => {
      await clearAndFire({
        id: "rs1",
        type: "reset-session",
        payload: {},
      });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "rs1", result: "ok" }),
      );
    });
  });

  describe("error handling", () => {
    it("reports error when crypto operation fails", async () => {
      const subtle = crypto.subtle as any;
      const origEncrypt = subtle.encrypt;
      subtle.encrypt = vi
        .fn()
        .mockRejectedValue(new Error("encryption failed"));

      await clearAndFire({
        id: "err1",
        type: "encrypt",
        payload: { text: "hello", password: "secret" },
      });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "err1",
          error: "encryption failed",
          code: "OPERATION_FAILED",
        }),
      );

      subtle.encrypt = origEncrypt;
    });
  });

  describe("timeout cleanup", () => {
    it("releases sanitized plaintext references when encryption times out", async () => {
      vi.useFakeTimers();
      const subtle = crypto.subtle as any;
      const originalEncrypt = subtle.encrypt;
      subtle.encrypt = vi.fn().mockReturnValue(new Promise(() => {}));
      const payload = { text: "sensitive timeout plaintext", password: "secret" };

      const pending = fireMessage({
        id: "timeout-cleanup",
        type: "encrypt",
        payload,
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(30_000);
      await pending;

      expect(payload.text).toBe("");
      expect(payload.password).toBe("");
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "timeout-cleanup",
          code: "TIMEOUT",
        }),
      );

      subtle.encrypt = originalEncrypt;
      vi.useRealTimers();
    });
  });

  describe("payload sanitization", () => {
    it("truncates password longer than 512 characters", async () => {
      const subtle = crypto.subtle as any;
      subtle.importKey.mockClear();

      const longPassword = "x".repeat(600);
      // Drop the module-level master-key cache first: a previous test may
      // have cached a key for this same password, which would skip the
      // importKey call below and make the mock assertion vacuous.
      await clearAndFire({ id: "reset-pre", type: "reset-session" });
      await clearAndFire({
        id: "pw1",
        type: "encrypt",
        payload: { text: "data", password: longPassword },
      });

      // resolvePassword caps the encoded password at 512 bytes BEFORE any
      // derivation/import call, so the first importKey arg is at most 512B.
      const encodedKeyData = subtle.importKey.mock.calls[0][1];
      expect(encodedKeyData.byteLength).toBeLessThanOrEqual(512);
    });

    it("caps encryptedBase64 input at 50 MB before decoding", async () => {
      const subtle = crypto.subtle as any;
      subtle.decrypt.mockClear();

      // A 60 MB base64 body is above the 50 MB sanitizePayload cap. The
      // truncated prefix (50 MB - "v4:") is not a valid base64 length, so
      // atob rejects it with a clean OPERATION_FAILED — proving the worker
      // never allocates the full attacker-sized buffer (a corrupt/oversized
      // vault blob in IndexedDB can otherwise force a multi-hundred-MB
      // allocation inside the worker with no bound) and never reaches the
      // decrypt primitive with a giant ciphertext.
      await clearAndFire({
        id: "big-dec",
        type: "decrypt",
        payload: {
          encryptedBase64: "v4:" + "A".repeat(60 * 1024 * 1024),
          password: "secret",
        },
      });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "big-dec",
          code: "OPERATION_FAILED",
        }),
      );
      // The capped input was rejected at decode time; no decrypt work ran.
      expect(subtle.decrypt.mock.calls.length).toBe(0);
    });
  });
});
