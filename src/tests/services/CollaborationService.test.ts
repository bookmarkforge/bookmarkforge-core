
/**
 * Tests for CollaborationService
 * Mocks encryptionService, securityVault, useSecurityStore, syncService, logger
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockEncrypt = vi.hoisted(() => vi.fn());
const mockDecrypt = vi.hoisted(() => vi.fn());
const mockDecryptShare = vi.hoisted(() => vi.fn());
vi.mock("../../services/EncryptionService", () => ({
  encryptionService: {
    encrypt: mockEncrypt,
    decrypt: mockDecrypt,
  },
}));

const mockGetSessionToken = vi.hoisted(() => vi.fn());
const mockUnlock = vi.hoisted(() => vi.fn());
const mockUnlockFromShare = vi.hoisted(() => vi.fn());
const mockWithMasterPasswordBytes = vi.hoisted(() =>
  vi.fn((_caller: object, fn: (pw: Uint8Array | null) => unknown) =>
    fn(new TextEncoder().encode("master-password")),
  ),
);
vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    getSessionToken: mockGetSessionToken,
    unlock: mockUnlock,
    registerCaller: vi.fn(),
    withMasterPasswordBytes: mockWithMasterPasswordBytes,
    unlockFromShare: mockUnlockFromShare,
    decryptShareWithRateLimit: mockDecryptShare,
    lock: vi.fn(),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

const mockUnlockStore = vi.hoisted(() => vi.fn());
vi.mock("../../hooks/useSecurityStore", () => ({
  useSecurityStore: {
    getState: vi.fn(() => ({
      unlock: mockUnlockStore,
    })),
  },
}));

const mockStartP2PSync = vi.hoisted(() => vi.fn());
const mockStopAll = vi.hoisted(() => vi.fn());
vi.mock("../../services/SyncService", () => ({
  syncService: {
    startP2PSync: mockStartP2PSync,
    stopAll: mockStopAll,
  },
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { collaborationService } from "../../services/CollaborationService";

describe("CollaborationService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockWithMasterPasswordBytes.mockImplementation(
      (_caller: object, fn: (p: Uint8Array | null) => unknown) =>
        fn(new TextEncoder().encode("master-password")),
    );
    mockUnlockFromShare.mockResolvedValue(true);
  });

  describe("generateSharePayload", () => {
    it("should return null if master password is null", async () => {
      mockWithMasterPasswordBytes.mockImplementation(
        (_caller: object, fn: (p: Uint8Array | null) => unknown) => fn(null),
      );
      const payload =
        await collaborationService.generateSharePayload("password");
      expect(payload).toBeNull();
    });

    it("should abort before deriving if the request was already cancelled", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        collaborationService.generateSharePayload("password", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(mockEncrypt).not.toHaveBeenCalled();
    });

    it("should generate encrypted payload", async () => {
      mockEncrypt.mockResolvedValue("encrypted-key");

      const payload =
        await collaborationService.generateSharePayload("password");
      expect(payload).toBeTruthy();
      expect(typeof payload).toBe("string");

      const decoded = JSON.parse(atob(payload!)) as Record<string, unknown>;
      expect(decoded.version).toBe(2);
      expect(decoded.salt).toHaveLength(16);
      expect(mockEncrypt).toHaveBeenCalledTimes(1);
    });

    it("should zeroize the derived material after generating the payload", async () => {
      mockEncrypt.mockResolvedValue("encrypted-key");
      const derivedBytes = new Uint8Array(32).fill(0x42);
      const deriveBitsSpy = vi
        .spyOn(crypto.subtle, "deriveBits")
        .mockResolvedValue(derivedBytes.buffer);

      try {
        await collaborationService.generateSharePayload("password");

        expect(deriveBitsSpy).toHaveBeenCalledTimes(1);
        expect(Array.from(derivedBytes).every((byte) => byte === 0)).toBe(true);
      } finally {
        deriveBitsSpy.mockRestore();
      }
    });
  });

  describe("importSharedVault", () => {
    it("should import vault successfully", async () => {
      const salt = new Array(16).fill(1);
      const payload = btoa(
        JSON.stringify({
          version: 2,
          encryptedKey: "encrypted-key",
          salt,
        }),
      );
      mockDecryptShare.mockResolvedValue(
        JSON.stringify({ shareSecret: "a".repeat(64), salt }),
      );
      mockUnlockFromShare.mockResolvedValue(true);
      const emptyDb = {
        collections: {
          bookmarks: { count: () => ({ exec: async () => 0 }) },
        },
      };

      const result = await collaborationService.importSharedVault(
        payload,
        "password",
        emptyDb as any,
      );
      expect(result).toBe(true);
      expect(mockDecryptShare).toHaveBeenCalledWith("encrypted-key", "password");
      expect(mockUnlockFromShare).toHaveBeenCalledWith(
        "a".repeat(64),
        JSON.stringify(new Array(16).fill(1)),
        { allowFreshDevice: true, emptyLocalDatabase: true },
      );
      expect(mockUnlockStore).toHaveBeenCalled();
    });

    it("discards a cancelled import before unlocking", async () => {
      const salt = new Array(16).fill(1);
      const payload = btoa(
        JSON.stringify({ version: 2, encryptedKey: "encrypted-key", salt }),
      );
      let resolveDecrypt: ((value: string) => void) | undefined;
      mockDecryptShare.mockImplementation(
        () => new Promise<string>((resolve) => {
          resolveDecrypt = resolve;
        }),
      );
      const controller = new AbortController();
      const importPromise = collaborationService.importSharedVault(
        payload,
        "password",
        {
          collections: {
            bookmarks: { count: () => ({ exec: async () => 0 }) },
          },
        } as any,
        controller.signal,
      );

      await Promise.resolve();
      controller.abort();
      resolveDecrypt?.(JSON.stringify({ shareSecret: "a".repeat(64), salt }));

      await expect(importPromise).resolves.toBe(false);
      expect(mockUnlockFromShare).not.toHaveBeenCalled();
    });

    it("rejects a second import while the first is still in progress", async () => {
      const salt = new Array(16).fill(1);
      const payload = btoa(
        JSON.stringify({ version: 2, encryptedKey: "encrypted-key", salt }),
      );
      let resolveDecrypt: ((value: string) => void) | undefined;
      mockDecryptShare.mockImplementation(
        () => new Promise<string>((resolve) => {
          resolveDecrypt = resolve;
        }),
      );
      const emptyDb = {
        collections: {
          bookmarks: { count: () => ({ exec: async () => 0 }) },
        },
      };

      const firstImport = collaborationService.importSharedVault(
        payload,
        "password",
        emptyDb as any,
      );
      await expect(
        collaborationService.importSharedVault(payload, "password", emptyDb as any),
      ).resolves.toBe(false);

      resolveDecrypt?.(JSON.stringify({ shareSecret: "a".repeat(64), salt }));
      await expect(firstImport).resolves.toBe(true);
      expect(mockDecryptShare).toHaveBeenCalledTimes(1);
    });

    it("rejects if the authenticated salt does not match the envelope", async () => {
      const payload = btoa(
        JSON.stringify({
          version: 2,
          encryptedKey: "encrypted-key",
          salt: new Array(16).fill(1),
        }),
      );
      mockDecryptShare.mockResolvedValue(
        JSON.stringify({
          shareSecret: "a".repeat(64),
          salt: new Array(16).fill(2),
        }),
      );

      const result = await collaborationService.importSharedVault(
        payload,
        "password",
        {
          collections: {
            bookmarks: { count: () => ({ exec: async () => 0 }) },
          },
        } as any,
      );

      expect(result).toBe(false);
      expect(mockUnlockFromShare).not.toHaveBeenCalled();
      expect(mockUnlockStore).not.toHaveBeenCalled();
    });

    it("does not enable bootstrap if the local database already has data", async () => {
      const salt = new Array(16).fill(1);
      const payload = btoa(
        JSON.stringify({ version: 2, encryptedKey: "encrypted-key", salt }),
      );
      mockDecryptShare.mockResolvedValue(
        JSON.stringify({ shareSecret: "a".repeat(64), salt }),
      );
      mockUnlockFromShare.mockResolvedValue(false);

      const result = await collaborationService.importSharedVault(
        payload,
        "password",
        {
          collections: {
            bookmarks: { count: () => ({ exec: async () => 1 }) },
          },
        } as any,
      );

      expect(result).toBe(false);
      expect(mockUnlockFromShare).toHaveBeenCalledWith(
        "a".repeat(64),
        JSON.stringify(salt),
        { allowFreshDevice: true, emptyLocalDatabase: false },
      );
    });

    it("rejects a v1 payload without enabling bootstrap on a new device", async () => {
      const payload = btoa(
        JSON.stringify({
          version: 1,
          encryptedKey: "encrypted-key",
          salt: new Array(16).fill(1),
        }),
      );
      mockDecryptShare.mockResolvedValue("a".repeat(64));
      mockUnlockFromShare.mockResolvedValue(false);

      const result = await collaborationService.importSharedVault(
        payload,
        "password",
        {} as any,
      );

      expect(result).toBe(false);
      expect(mockUnlockFromShare).toHaveBeenCalledWith(
        "a".repeat(64),
        JSON.stringify(new Array(16).fill(1)),
        { allowFreshDevice: false, emptyLocalDatabase: false },
      );
      expect(mockUnlockStore).not.toHaveBeenCalled();
    });

    it("should return false if payload is malformed", async () => {
      const result = await collaborationService.importSharedVault(
        "invalid-base64!",
        "password",
        {} as any,
      );
      expect(result).toBe(false);
    });

    it("should return false if decrypt fails", async () => {
      const payload = btoa(
        JSON.stringify({
          version: 2,
          encryptedKey: "key",
          salt: new Array(16).fill(1),
        }),
      );
      mockDecryptShare.mockResolvedValue("");

      const result = await collaborationService.importSharedVault(
        payload,
        "password",
        {} as any,
      );
      expect(result).toBe(false);
    });

    it("should return false if decrypt throws", async () => {
      const payload = btoa(
        JSON.stringify({
          version: 2,
          encryptedKey: "key",
          salt: new Array(16).fill(1),
        }),
      );
      mockDecryptShare.mockRejectedValue(new Error("Decrypt error"));

      const result = await collaborationService.importSharedVault(
        payload,
        "password",
        {} as any,
      );
      expect(result).toBe(false);
    });
  });

  describe("start", () => {
    it("should start P2P sync", async () => {
      const db = {} as any;
      await collaborationService.start(db, "room-1");
      expect(mockStartP2PSync).toHaveBeenCalledWith(db, "room-1");
    });

    it("should propagate error if startP2PSync fails", async () => {
      mockStartP2PSync.mockRejectedValue(new Error("Sync failed"));
      await expect(
        collaborationService.start({} as any, "room-1"),
      ).rejects.toThrow("Sync failed");
    });

    it("should allow start → stop → start (full cycle)", async () => {
      const db = {} as any;
      await collaborationService.start(db, "room-1");
      expect(mockStartP2PSync).toHaveBeenCalledWith(db, "room-1");

      await collaborationService.stop();
      expect(mockStopAll).toHaveBeenCalledTimes(1);

      mockStartP2PSync.mockClear();
      mockStopAll.mockClear();

      await collaborationService.start(db, "room-2");
      expect(mockStartP2PSync).toHaveBeenCalledWith(db, "room-2");
    });

    it("should pass the correct db and roomId", async () => {
      const db = { name: "test-db" } as any;
      await collaborationService.start(db, "my-room");
      expect(mockStartP2PSync).toHaveBeenCalledWith(db, "my-room");
    });

    it("tears the session down immediately when the signal aborts mid-start", async () => {
      let resolveStart: (() => void) | undefined;
      mockStartP2PSync.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveStart = resolve;
          }),
      );
      const controller = new AbortController();
      const promise = collaborationService.start(
        {} as any,
        "room-1",
        undefined,
        controller.signal,
      );

      // Abort while the startup is still in flight: stopAll must run NOW, not
      // after the (possibly hanging) startup completes.
      controller.abort();
      expect(mockStopAll).toHaveBeenCalled();

      resolveStart!();
      await expect(promise).rejects.toThrow(
        "Collaboration operation cancelled",
      );
    });
  });

  describe("stop", () => {
    it("should stop P2P sync", async () => {
      await collaborationService.stop();
      expect(mockStopAll).toHaveBeenCalled();
    });

    it("should be safe (no throw) when calling stop without starting", async () => {
      await expect(collaborationService.stop()).resolves.toBeUndefined();
      expect(mockStopAll).toHaveBeenCalled();
    });

    it("should be safe calling stop multiple times", async () => {
      await collaborationService.stop();
      await collaborationService.stop();
      await collaborationService.stop();
      expect(mockStopAll).toHaveBeenCalledTimes(3);
    });
  });
});
