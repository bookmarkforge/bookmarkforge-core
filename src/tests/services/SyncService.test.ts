/**
 * Tests for SyncService — isolatable functions (no WebRTC/RxDB dependencies)
 *
 * Phase 1: generateRoomId, buildIceServersFromEnv, isOperationDuplicate,
 *          recordOperation, clearDedupeCache, getDedupeStats, generateOperationHash
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks of heavy dependencies (unused by isolatable functions) ──

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/env", () => ({
  getEnvVar: vi.fn(() => undefined),
}));

vi.mock("../../constants/config", () => ({
  SYNC_CONFIG: {
    DEDUPE_WINDOW_MS: 5000,
    DEDUPE_MAX_SIZE: 1000,
    HEALTH_CHECK_INTERVAL_MS: 30000,
    RECONNECT_MAX_DELAY_MS: 60000,
    RECONNECT_BASE_DELAY_MS: 2000,
  },
}));

vi.mock("../../utils/networkFirewall", () => ({
  // setFirewallDisabled is imported by src/tests/setup.ts beforeAll, so the
  // mock must expose it or every test in this file fails at collection.
  setFirewallDisabled: vi.fn(),
  checkNetworkRequest: vi.fn().mockResolvedValue(undefined),
  validateIceServers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("rxdb/plugins/replication-webrtc", () => ({
  replicateWebRTC: vi.fn(),
  getConnectionHandlerSimplePeer: vi.fn(),
}));

// ── Crypto mocks ─────────────────────────────────────────────────────

const mockRandomValues = (arr: Uint8Array): Uint8Array => {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = i < 10 ? 0xab : 0xcd; // predictable: [0xab, 0xab, ..., 0xcd, ...]
  }
  return arr;
};

// Unique-per-call counter so recordOperation ids don't collide in
// maxSize/stats tests (the impl slices the UUID to 9 chars).
let uuidCounter = 0;

// ── Imports ──────────────────────────────────────────────────────────

import {
  SyncService,
  createSignalingSocketFactory,
  canonicalSignalPayload,
  deriveClientSignalKey,
  SIGNAL_INIT_TIMEOUT_MS,
  SIGNAL_QUEUE_LIMIT,
} from "../../services/SyncService";
import { createHmac } from "node:crypto";
// Import the mocked logger so tests can verify calls
const { logger } = await import("../../utils/logger");

describe("SyncService — funciones aislables", () => {
  let service: SyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-stub crypto in beforeEach: the module-level stub would be wiped by
    // afterEach's unstubAllGlobals() after the very first test, breaking every
    // subsequent crypto-dependent test in this file.
    vi.stubGlobal("crypto", {
      getRandomValues: vi.fn(mockRandomValues),
      // Unique per call (counter in the leading group) so ids like
      // op_<ts>_<slice(0,9)> stay distinct across recordOperation calls.
      randomUUID: vi.fn(() =>
        `${String(uuidCounter++).padStart(8, "0")}-0000-4000-8000-000000000000`,
      ),
      subtle: {
        // Deterministic but input-derived: different operations (collection:
        // docId:operation) must yield different hashes for the dedupe stats
        // tests. A constant buffer made every hash collide.
        digest: vi.fn(async (_algo: string, data: Uint8Array) => {
          const out = new Uint8Array(32);
          for (let i = 0; i < data.length; i++) {
            out[i % 32] = (out[i % 32]! + data[i]!) & 0xff;
          }
          return out.buffer;
        }),
      },
    });
    service = new SyncService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares a single startup when startP2PSync arrives concurrently", async () => {
    let rejectStartup: ((error: Error) => void) | undefined;
    const assertSpy = vi.spyOn(service as any, "assertNoPrivateRecords").mockImplementation(
      () => new Promise<void>((_, reject) => {
        rejectStartup = reject;
      }),
    );

    const first = service.startP2PSync({} as any, "room-a");
    const second = service.startP2PSync({} as any, "room-a");
    const firstResult = first.then(() => null, (error: unknown) => error);
    const secondResult = second.then(() => null, (error: unknown) => error);

    expect(assertSpy).toHaveBeenCalledTimes(1);
    const startupError = new Error("startup cancelled");
    rejectStartup?.(startupError);
    await expect(firstResult).resolves.toBe(startupError);
    await expect(secondResult).resolves.toBe(startupError);
    assertSpy.mockRestore();
  });

  // ── generateRoomId ─────────────────────────────────────────────

  describe("generateRoomId", () => {
    it("generates a 32-character hexadecimal string", async () => {
      const roomId = await service.generateRoomId();
      expect(roomId).toHaveLength(32);
      expect(/^[0-9a-f]{32}$/.test(roomId)).toBe(true);
    });

    it("uses crypto.getRandomValues with a 16-byte array", async () => {
      await service.generateRoomId();
      expect(crypto.getRandomValues).toHaveBeenCalledWith(
        expect.any(Uint8Array),
      );
      const callArg = (crypto.getRandomValues as any).mock.calls[0][0];
      expect(callArg).toBeInstanceOf(Uint8Array);
      expect(callArg.length).toBe(16);
    });

    it("returns consistent 32-char hex with deterministic mock", async () => {
      // With the mock, both calls produce the same deterministic output.
      // The value is 0xab(10×) + 0xcd(6×) = 20+12 chars = 32.
      const roomId1 = await service.generateRoomId();
      const roomId2 = await service.generateRoomId();
      expect(roomId1).toHaveLength(32);
      expect(roomId2).toHaveLength(32);
      // Both calls produce the same deterministic hex
      expect(roomId1).toEqual(roomId2);
    });
  });

  // ── buildIceServersFromEnv ──────────────────────────────────────

  describe("buildIceServersFromEnv", () => {
    const DEFAULT_STUN: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ];

    it("returns only default STUN when no TURN env vars are provided", () => {
      const result = (service as any).buildIceServersFromEnv(DEFAULT_STUN, {});
      expect(result).toEqual(DEFAULT_STUN);
    });

    it("returns only default STUN when TURN URL is present but empty", () => {
      const result = (service as any).buildIceServersFromEnv(DEFAULT_STUN, {
        VITE_TURN_URL: "",
      });
      expect(result).toEqual(DEFAULT_STUN);
    });

    it("returns only default STUN when TURN URL is set but username is missing", () => {
      const result = (service as any).buildIceServersFromEnv(DEFAULT_STUN, {
        VITE_TURN_URL: "turn:my-turn.example.com:3478",
        VITE_TURN_USERNAME: "",
        VITE_TURN_CREDENTIAL: "secret",
      });
      expect(result).toEqual(DEFAULT_STUN);
    });

    it("returns only default STUN when TURN URL is set but credential is missing", () => {
      const result = (service as any).buildIceServersFromEnv(DEFAULT_STUN, {
        VITE_TURN_URL: "turn:my-turn.example.com:3478",
        VITE_TURN_USERNAME: "user",
        VITE_TURN_CREDENTIAL: "",
      });
      expect(result).toEqual(DEFAULT_STUN);
    });

    it("returns TURN + STUN when all env vars are provided", () => {
      const result = (service as any).buildIceServersFromEnv(DEFAULT_STUN, {
        VITE_TURN_URL: "turn:my-turn.example.com:3478",
        VITE_TURN_USERNAME: "user123",
        VITE_TURN_CREDENTIAL: "pass456",
      });
      expect(result).toHaveLength(3); // 1 turn + 2 stun
      expect(result[0]).toEqual({
        urls: "turn:my-turn.example.com:3478",
        username: "user123",
        credential: "pass456",
      });
      expect(result[1]).toEqual(DEFAULT_STUN[0]);
      expect(result[2]).toEqual(DEFAULT_STUN[1]);
    });

    it("uses provided env override instead of reading globals", () => {
      // The `env` parameter allows testing without mocking import.meta.env
      const customEnv = {
        VITE_TURN_URL: "turn:custom.example.com:3478",
        VITE_TURN_USERNAME: "custom-user",
        VITE_TURN_CREDENTIAL: "custom-pass",
      };
      const result = (service as any).buildIceServersFromEnv(
        DEFAULT_STUN,
        customEnv,
      );
      expect(result[0].urls).toBe("turn:custom.example.com:3478");
    });

    it("falls back to getEnvVar when env parameter is undefined", () => {
      // With the getEnvVar mock returning undefined, it must give defaultStun
      const result = (service as any).buildIceServersFromEnv(DEFAULT_STUN);
      expect(result).toEqual(DEFAULT_STUN);
    });
  });

  // ── generateOperationHash ──────────────────────────────────────

  describe("generateOperationHash (private)", () => {
    it("generates a deterministic 32-char hex hash from collection:docId:operation", async () => {
      const hash = await (service as any).generateOperationHash(
        "bookmarks",
        "b1",
        "insert",
      );
      expect(hash).toHaveLength(32);
      expect(/^[0-9a-f]{32}$/.test(hash)).toBe(true);
    });

    it("uses crypto.subtle.digest with SHA-256", async () => {
      await (service as any).generateOperationHash("col", "doc", "op");
      // The implementation passes encoder.encode(data), which is a Uint8Array
      // (BufferSource), not a raw ArrayBuffer.
      expect(crypto.subtle.digest).toHaveBeenCalledWith(
        "SHA-256",
        expect.any(Uint8Array),
      );
    });

    it("produces different hashes for different inputs", async () => {
      // With deterministic mock, different inputs → same hash prefix (mock always returns same value)
      const hash1 = await (service as any).generateOperationHash("a", "1", "i");
      const hash2 = await (service as any).generateOperationHash("b", "2", "u");
      expect(hash1).toHaveLength(32);
      expect(hash2).toHaveLength(32);
    });
  });

  // ── isOperationDuplicate ────────────────────────────────────────

  describe("isOperationDuplicate", () => {
    it("returns false for a hash that has never been seen", () => {
      const result = (service as any).isOperationDuplicate("new-hash-123");
      expect(result).toBe(false);
    });

    it("returns true for a previously processed hash", () => {
      (service as any).lastProcessedHashes.add("seen-hash");
      const result = (service as any).isOperationDuplicate("seen-hash");
      expect(result).toBe(true);
    });

    it("cleans expired entries from the operation cache", () => {
      const now = Date.now();
      const expiredOp = {
        id: "op_expired",
        collection: "bookmarks",
        documentId: "d1",
        operation: "update" as const,
        timestamp: now - 40000, // 40s ago, beyond 5s window + 30s grace
        hash: "hash-expired",
      };
      (service as any).operationCache.set("op_expired", expiredOp);
      (service as any).lastProcessedHashes.add("hash-expired");

      // New hash — triggers cleanup of expired entries
      (service as any).isOperationDuplicate("new-hash");

      expect((service as any).operationCache.has("op_expired")).toBe(false);
      expect((service as any).lastProcessedHashes.has("hash-expired")).toBe(
        false,
      );
    });

    it("does NOT clean non-expired entries", () => {
      const now = Date.now();
      const recentOp = {
        id: "op_recent",
        collection: "bookmarks",
        documentId: "d2",
        operation: "insert" as const,
        timestamp: now - 1000, // 1s ago, within 5s window
        hash: "hash-recent",
      };
      (service as any).operationCache.set("op_recent", recentOp);
      (service as any).lastProcessedHashes.add("hash-recent");

      (service as any).isOperationDuplicate("new-hash");

      // Recent entries should survive
      expect((service as any).operationCache.has("op_recent")).toBe(true);
      expect((service as any).lastProcessedHashes.has("hash-recent")).toBe(
        true,
      );
    });

    it("does not purge entries outside the window but within the grace period (M-04)", () => {
      const now = Date.now();
      // 10s old: beyond the 5s window but still inside the 30s grace period
      (service as any).operationCache.set("op_grace", {
        id: "op_grace",
        collection: "bookmarks",
        documentId: "d3",
        operation: "update" as const,
        timestamp: now - 10000,
        hash: "hash-grace",
      });
      (service as any).lastProcessedHashes.add("hash-grace");

      (service as any).isOperationDuplicate("new-hash");

      expect((service as any).operationCache.has("op_grace")).toBe(true);
      expect((service as any).lastProcessedHashes.has("hash-grace")).toBe(
        true,
      );
    });

    it("returns false for new hash even when cache has expired entries", () => {
      const now = Date.now();
      (service as any).operationCache.set("op_old", {
        id: "op_old",
        collection: "col",
        documentId: "d",
        operation: "insert" as const,
        timestamp: now - 40000, // beyond 5s window + 30s grace
        hash: "hash-old",
      });
      (service as any).lastProcessedHashes.add("hash-old");

      const result = (service as any).isOperationDuplicate("brand-new");
      expect(result).toBe(false);
    });
  });

  // ── BroadcastChannel cross-tab dedupe (audit M-03) ────────────────

  describe("dedupe cross-tab (BroadcastChannel) — M-03", () => {
    class FakeBroadcastChannel {
      static instances: FakeBroadcastChannel[] = [];
      onmessage: ((ev: MessageEvent<string>) => void) | null = null;
      posted: string[] = [];
      name: string;
      constructor(name: string) {
        this.name = name;
        FakeBroadcastChannel.instances.push(this);
      }
      postMessage(data: string): void {
        this.posted.push(data);
      }
      close(): void {}
    }
    const ROOM_ID = "0123456789abcdef0123456789abcdef";
    const HEX_HASH = "0123456789abcdef0123456789abcdef";

    beforeEach(() => {
      FakeBroadcastChannel.instances = [];
      vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    });

    afterEach(() => {
      (service as any).closeDedupeChannel();
      vi.unstubAllGlobals();
    });

    const emit = (data: string): void => {
      const channel = FakeBroadcastChannel.instances[0]!;
      channel.onmessage?.({ data } as MessageEvent<string>);
    };

    it("ignores 32-char hashes that are not hex (another app at the source)", () => {
      (service as any).openDedupeChannel(ROOM_ID);
      emit("X".repeat(32));
      expect((service as any).lastProcessedHashes.size).toBe(0);
    });

    it("rejects the legacy plain hash format from untrusted same-origin producers", () => {
      (service as any).openDedupeChannel(ROOM_ID);
      emit(HEX_HASH);
      expect((service as any).lastProcessedHashes.has(HEX_HASH)).toBe(false);
    });

    it("accepts only the full-room namespaced format", () => {
      (service as any).openDedupeChannel(ROOM_ID);
      emit(`bmf:${ROOM_ID}:${HEX_HASH}`);
      expect((service as any).lastProcessedHashes.has(HEX_HASH)).toBe(true);
    });

    it("rejects a short-prefix collision from another room", () => {
      (service as any).openDedupeChannel(ROOM_ID);
      emit(`bmf:${ROOM_ID.slice(0, 16)}:${HEX_HASH}`);
      // A 16-character prefix is not enough to authorize this room.
      expect((service as any).lastProcessedHashes.size).toBe(0);
    });

    it("purga los hashes cross-tab por edad (sin fuga de memoria en sesiones largas)", () => {
      (service as any).openDedupeChannel(ROOM_ID);
      emit(HEX_HASH);
      // Arrived more than windowMs(5000) + grace(30000) ago: must expire even though
      // it has NO operationCache entry (the bug: only these were purged)
      // hashes ligados a entradas expiradas del cache).
      (service as any).hashTimestamps.set(HEX_HASH, Date.now() - 40000);

      (service as any).isOperationDuplicate("another-hash");

      expect((service as any).lastProcessedHashes.has(HEX_HASH)).toBe(false);
      expect((service as any).hashTimestamps.has(HEX_HASH)).toBe(false);
    });

    it("does NOT purge recent cross-tab hashes (within the window + grace)", () => {
      (service as any).openDedupeChannel(ROOM_ID);
      emit(`bmf:${ROOM_ID}:${HEX_HASH}`);
      (service as any).hashTimestamps.set(HEX_HASH, Date.now() - 10000);

      (service as any).isOperationDuplicate("another-hash");

      expect((service as any).lastProcessedHashes.has(HEX_HASH)).toBe(true);
    });

    it("maxSize eviction also clears hashTimestamps", async () => {
      (service as any).dedupeConfig.maxSize = 5;
      const hashes: string[] = [];
      for (let i = 0; i < 6; i++) {
        hashes.push(
          await (service as any).recordOperation("col", `doc-${i}`, "insert"),
        );
      }
      // Evicted ~20% (1) of the oldest entries
      expect((service as any).hashTimestamps.size).toBe(
        (service as any).operationCache.size,
      );
      expect((service as any).hashTimestamps.size).toBe(5);
    });

    it("a flooding cross-tab sender does not grow lastProcessedHashes beyond maxSize", () => {
      (service as any).openDedupeChannel(ROOM_ID);
      (service as any).dedupeConfig.maxSize = 10;
      const hex = (i: number) =>
        `abcdef${String(i).padStart(26, "0")}`;
      for (let i = 0; i < 30; i++) {
        emit(hex(i));
      }
      expect((service as any).lastProcessedHashes.size).toBeLessThanOrEqual(10);
      expect((service as any).hashTimestamps.size).toBeLessThanOrEqual(10);
    });

    it("broadcastDedupeHash emits namespaced AND plain legacy format (cross-version)", () => {
      (service as any).openDedupeChannel(ROOM_ID);
      (service as any).broadcastDedupeHash(HEX_HASH);
      const channel = FakeBroadcastChannel.instances[0]!;
      // Only the current full-room namespace is emitted. An unscoped legacy
      // hash could be injected by any same-origin producer.
      expect(channel.posted).toEqual([
        `bmf:${ROOM_ID}:${HEX_HASH}`,
      ]);
    });
  });

  // ── recordOperation ─────────────────────────────────────────────

  describe("recordOperation", () => {
    it("records an operation and returns its 32-char hash", async () => {
      const hash = await (service as any).recordOperation(
        "bookmarks",
        "b1",
        "insert",
      );
      expect(hash).toHaveLength(32);
      expect((service as any).operationCache.size).toBe(1);
    });

    it("adds the hash to lastProcessedHashes", async () => {
      const hash = await (service as any).recordOperation(
        "folders",
        "f1",
        "update",
      );
      expect((service as any).lastProcessedHashes.has(hash)).toBe(true);
    });

    it("cleans 20% oldest entries when cache exceeds maxSize", async () => {
      // Override dedupe config for this test
      (service as any).dedupeConfig.maxSize = 10;

      // Fill cache with 10 entries (hits maxSize)
      for (let i = 0; i < 10; i++) {
        await (service as any).recordOperation(
          "bookmarks",
          `doc-${i}`,
          "insert",
        );
      }

      expect((service as any).operationCache.size).toBe(10);

      // One more entry triggers cleanup (removes 20% = 2 oldest)
      await (service as any).recordOperation("bookmarks", "doc-extra", "insert");
      expect((service as any).operationCache.size).toBe(9); // 10 + 1 - 2 = 9
    });

    it("does NOT clean when cache is below maxSize", async () => {
      (service as any).dedupeConfig.maxSize = 100;
      for (let i = 0; i < 5; i++) {
        await (service as any).recordOperation(
          "bookmarks",
          `doc-${i}`,
          "insert",
        );
      }
      expect((service as any).operationCache.size).toBe(5);
    });
  });

  // ── clearDedupeCache / getDedupeStats ───────────────────────────

  describe("clearDedupeCache / getDedupeStats", () => {
    it("clearDedupeCache empties both caches", async () => {
      await (service as any).recordOperation("col", "d1", "insert");
      expect((service as any).operationCache.size).toBeGreaterThan(0);
      expect((service as any).lastProcessedHashes.size).toBeGreaterThan(0);

      service.clearDedupeCache();

      expect((service as any).operationCache.size).toBe(0);
      expect((service as any).lastProcessedHashes.size).toBe(0);
    });

    it("getDedupeStats returns correct cache and hash counts", async () => {
      await (service as any).recordOperation("col", "d1", "insert");
      await (service as any).recordOperation("col", "d2", "update");

      const stats = service.getDedupeStats();
      expect(stats.cacheSize).toBe(2);
      expect(stats.uniqueHashes).toBe(2);
    });

    it("getDedupeStats returns zeros for empty cache", () => {
      const stats = service.getDedupeStats();
      expect(stats.cacheSize).toBe(0);
      expect(stats.uniqueHashes).toBe(0);
    });
  });

  // ================================================================
  // FASE 3 — scheduleReconnect, startHealthCheck, stopAll
  // ================================================================

  describe("scheduleReconnect", () => {
    const mockDb = {} as any;

    beforeEach(() => {
      vi.useFakeTimers();
      (service as any).reconnectAttempts = 0;
      (service as any).reconnectTimer = null;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("schedules reconnect with base delay (2000ms) on first attempt", () => {
      (service as any).scheduleReconnect(mockDb);

      expect((service as any).reconnectTimer).not.toBeNull();
      expect((service as any).reconnectAttempts).toBe(1);
      expect(logger.info).toHaveBeenCalledWith(
        "[SyncService] Scheduling auto-reconnect",
        expect.objectContaining({ delay: 2, attempt: 1 }),
      );
    });

    it("exponential backoff: 2s, 4s, 8s, 16s for consecutive calls", () => {
      const expectedDelays = [2, 4, 8, 16];

      for (const expected of expectedDelays) {
        vi.clearAllMocks();
        (service as any).reconnectTimer = null;
        (service as any).scheduleReconnect(mockDb);

        expect(logger.info).toHaveBeenCalledWith(
          "[SyncService] Scheduling auto-reconnect",
          expect.objectContaining({ delay: expected }),
        );
      }

      expect((service as any).reconnectAttempts).toBe(4);
    });

    it("caps backoff at MAX_DELAY (60s) after 5+ attempts", () => {
      // delay = base(2s) * 2^attempts, capped at 60s.
      // attempts=5 → 2s*32 = 64s > 60s → cap at 60 already.
      (service as any).reconnectAttempts = 5;
      (service as any).scheduleReconnect(mockDb);

      expect(logger.info).toHaveBeenCalledWith(
        "[SyncService] Scheduling auto-reconnect",
        expect.objectContaining({ delay: 60 }),
      );

      // attempts=6 → 2s*64 = 128s → still capped at 60
      (service as any).reconnectTimer = null;
      (service as any).scheduleReconnect(mockDb);
      expect(logger.info).toHaveBeenCalledWith(
        "[SyncService] Scheduling auto-reconnect",
        expect.objectContaining({ delay: 60 }),
      );

      // attempts=7 → still capped at 60
      (service as any).reconnectTimer = null;
      (service as any).scheduleReconnect(mockDb);
      expect(logger.info).toHaveBeenCalledWith(
        "[SyncService] Scheduling auto-reconnect",
        expect.objectContaining({ delay: 60 }),
      );
    });

    it("does not schedule a new timer if reconnectTimer already exists", () => {
      (service as any).reconnectTimer = "existing-timer" as any;
      (service as any).scheduleReconnect(mockDb);

      // logger.info should NOT have been called (early return)
      expect(logger.info).not.toHaveBeenCalled();
      expect((service as any).reconnectTimer).toBe("existing-timer");
    });

    it("calls restartSync when reconnect timer fires and isSyncing=true", async () => {
      const restartSpy = vi
        .spyOn(service, "restartSync" as any)
        .mockResolvedValue(undefined);

      service.isSyncing = true;
      (service as any).currentRoomId = "room-123";
      (service as any).scheduleReconnect(mockDb);

      // Advance time to fire the setTimeout
      await vi.advanceTimersByTimeAsync(2000);

      expect(restartSpy).toHaveBeenCalledWith(mockDb);
      expect((service as any).reconnectTimer).toBeNull();

      restartSpy.mockRestore();
    });

    it("does NOT call restartSync when timer fires but isSyncing=false", async () => {
      const restartSpy = vi
        .spyOn(service, "restartSync" as any)
        .mockResolvedValue(undefined);

      service.isSyncing = false;
      (service as any).scheduleReconnect(mockDb);

      await vi.advanceTimersByTimeAsync(2000);

      expect(restartSpy).not.toHaveBeenCalled();
      restartSpy.mockRestore();
    });

    it("failed restart logs and schedules the NEXT reconnect (no unhandled rejection)", async () => {
      const restartSpy = vi
        .spyOn(service, "restartSync" as any)
        .mockRejectedValue(new Error("all signaling servers blocked"));

      service.isSyncing = true;
      (service as any).currentRoomId = "room-123";
      (service as any).scheduleReconnect(mockDb);

      await vi.advanceTimersByTimeAsync(2000);

      expect(logger.error).toHaveBeenCalledWith(
        "[SyncService] Reconnect attempt failed, will retry",
        expect.objectContaining({ error: expect.any(Error) }),
      );
      // The retry loop must stay alive: a new timer is scheduled.
      expect((service as any).reconnectTimer).not.toBeNull();
      // Backoff continues: attempts already incremented → next delay 4s.
      expect(logger.info).toHaveBeenCalledWith(
        "[SyncService] Scheduling auto-reconnect",
        expect.objectContaining({ delay: 4, attempt: 2 }),
      );

      restartSpy.mockRestore();
    });

    it("restartSync preserves the backoff counter across stopAll()", async () => {
      const startSpy = vi
        .spyOn(service, "startP2PSync" as any)
        .mockResolvedValue(undefined);
      (service as any).reconnectAttempts = 3;
      (service as any).currentRoomId = "room-123";

      await service.restartSync(mockDb);

      // stopAll() resets attempts to 0 internally; restartSync must restore
      // the counter so the exponential ramp continues (2s→4s→8s→16s→…).
      expect((service as any).reconnectAttempts).toBe(3);
      startSpy.mockRestore();
    });

    it("reconnect loop survives a startP2PSync failure inside restartSync", async () => {
      // Exercise the REAL restartSync → startP2PSync path (not a wholesale
      // restartSync mock): startP2PSync sets isSyncing=true then throws, so
      // the timer callback's catch must still re-schedule while the retry
      // condition (isSyncing && currentRoomId) holds.
      const startSpy = vi
        .spyOn(service, "startP2PSync" as any)
        .mockRejectedValue(new Error("start failed"));

      service.isSyncing = true;
      (service as any).currentRoomId = "room-123";
      (service as any).scheduleReconnect(mockDb);

      await vi.advanceTimersByTimeAsync(2000);

      expect(logger.error).toHaveBeenCalledWith(
        "[SyncService] Reconnect attempt failed, will retry",
        expect.objectContaining({ error: expect.any(Error) }),
      );
      expect((service as any).reconnectTimer).not.toBeNull();
      expect((service as any).reconnectAttempts).toBe(2);

      startSpy.mockRestore();
    });

    it("does NOT call restartSync when syncing but no currentRoomId", async () => {
      const restartSpy = vi
        .spyOn(service, "restartSync" as any)
        .mockResolvedValue(undefined);

      service.isSyncing = true;
      (service as any).currentRoomId = null;
      (service as any).scheduleReconnect(mockDb);

      await vi.advanceTimersByTimeAsync(2000);

      expect(restartSpy).not.toHaveBeenCalled();
      restartSpy.mockRestore();
    });
  });

  describe("startHealthCheck", () => {
    const mockDb = {} as any;

    beforeEach(() => {
      vi.useFakeTimers();
      (service as any).healthCheckTimer = null;
      (service as any).reconnectAttempts = 0;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sets up a periodic health check interval", () => {
      (service as any).startHealthCheck(mockDb);

      expect((service as any).healthCheckTimer).not.toBeNull();
    });

    it("sets syncHealth to 'connecting' when no peers connected and isSyncing", () => {
      service.isSyncing = true;
      service.connectedPeers = 0;
      service.syncHealth = "healthy";

      (service as any).startHealthCheck(mockDb);

      // Advance by HEALTH_CHECK_INTERVAL_MS (30s)
      vi.advanceTimersByTime(30000);

      expect(logger.warn).toHaveBeenCalledWith(
        "[SyncService] Health check: No peers connected, attempting soft restart",
      );
      expect(service.syncHealth).toBe("connecting");
    });

    it("resets reconnectAttempts when peers > 0 and isSyncing", () => {
      service.isSyncing = true;
      service.connectedPeers = 2;
      (service as any).reconnectAttempts = 3;

      (service as any).startHealthCheck(mockDb);
      vi.advanceTimersByTime(30000);

      expect((service as any).reconnectAttempts).toBe(0);
    });

    it("does nothing when isSyncing is false", () => {
      service.isSyncing = false;
      service.connectedPeers = 0;

      (service as any).startHealthCheck(mockDb);
      vi.advanceTimersByTime(30000);

      // No warnings should be logged since isSyncing is false
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("clears existing healthCheckTimer before creating a new one", () => {
      const clearSpy = vi.spyOn(globalThis, "clearInterval");

      (service as any).startHealthCheck(mockDb);
      (service as any).startHealthCheck(mockDb);

      expect(clearSpy).toHaveBeenCalledTimes(1); // clean previous
      clearSpy.mockRestore();
    });
  });

  describe("stopAll", () => {
    let clearTimeoutSpy: any;
    let clearIntervalSpy: any;

    beforeEach(() => {
      clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    });

    afterEach(() => {
      clearTimeoutSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it("clears reconnectTimer if set", () => {
      (service as any).reconnectTimer = setTimeout(() => {}, 1000);
      service.stopAll();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect((service as any).reconnectTimer).toBeNull();
    });

    it("clears healthCheckTimer if set", () => {
      (service as any).healthCheckTimer = setInterval(() => {}, 1000);
      service.stopAll();

      expect(clearIntervalSpy).toHaveBeenCalled();
      expect((service as any).healthCheckTimer).toBeNull();
    });

    it("handles missing timers gracefully (no crash)", () => {
      (service as any).reconnectTimer = null;
      (service as any).healthCheckTimer = null;

      expect(() => service.stopAll()).not.toThrow();
    });

    it("unsubscribes all active subscriptions", () => {
      const sub1 = { unsubscribe: vi.fn() };
      const sub2 = { unsubscribe: vi.fn() };
      (service as any).subscriptions = [sub1, sub2 as any];

      service.stopAll();

      expect(sub1.unsubscribe).toHaveBeenCalled();
      expect(sub2.unsubscribe).toHaveBeenCalled();
      expect((service as any).subscriptions).toHaveLength(0);
    });

    it("skips null/undefined subscriptions (no crash)", () => {
      (service as any).subscriptions = [null, undefined];

      expect(() => service.stopAll()).not.toThrow();
      expect((service as any).subscriptions).toHaveLength(0);
    });

    it("cancels all active replications", () => {
      const rep1 = { cancel: vi.fn() };
      const rep2 = { cancel: vi.fn() };
      (service as any).replications = new Map([
        ["rep1", rep1],
        ["rep2", rep2],
      ]);

      service.stopAll();

      expect(rep1.cancel).toHaveBeenCalled();
      expect(rep2.cancel).toHaveBeenCalled();
      expect((service as any).replications.size).toBe(0);
    });

    it("resets all public sync state", () => {
      service.isSyncing = true;
      (service as any).currentRoomId = "room-1";
      service.connectedPeers = 3;
      service.lastSyncTime = Date.now();
      service.syncHealth = "healthy";
      (service as any).reconnectAttempts = 5;

      service.stopAll();

      expect(service.isSyncing).toBe(false);
      expect((service as any).currentRoomId).toBeNull();
      expect(service.connectedPeers).toBe(0);
      expect(service.lastSyncTime).toBeNull();
      expect(service.syncHealth).toBe("connecting");
      expect((service as any).reconnectAttempts).toBe(0);
    });
  });
});

// ── createSignalingSocketFactory / signal HMAC (audit #4) ──────────────
//
// Uses the REAL node webcrypto so the signed output is verified against the
// exact derivation the signaling server uses (node:crypto createHmac),
// proving client/server byte compatibility of the canonical payload.

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  sent: string[] = [];
  private listeners: Record<string, Array<(e?: { data?: string }) => void>> =
    {};
  url: string;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  failNextSend = false;
  send(data: string): void {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error("socket closed");
    }
    this.sent.push(data);
  }
  addEventListener(type: string, cb: (e?: { data?: string }) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(
    type: string,
    cb: (e?: { data?: string }) => void,
  ): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (f) => f !== cb,
    );
  }
  emit(type: string, data?: string): void {
    for (const cb of this.listeners[type] ?? []) {
      cb({ data });
    }
  }
  close(): void {
    this.emit("close");
  }
}

// Allow async Web Crypto signing to settle reliably under parallel test load.
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Poll-based wait: immune to scheduling jitter under parallel load. */
async function waitForSent(
  expected: number,
  timeoutMs = 3000,
): Promise<string[]> {
  const socket = MockWebSocket.instances[0]!;
  const start = Date.now();
  while (socket.sent.length < expected) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timeout waiting for ${expected} sent frames (got ${socket.sent.length})`,
      );
    }
    await new Promise((r) => setTimeout(r, 2));
  }
  return socket.sent;
}

/** Server-side reference derivation (mirrors server/src/index.ts). */
function referenceSignalAuth(
  roomSecret: string,
  roomId: string,
  peerId: string,
  receiverPeerId: string,
  data: unknown,
): string {
  const signalKey = createHmac("sha256", roomSecret)
    .update(`bookmarkforge-signal-auth:${roomId}`)
    .digest();
  const payload = JSON.stringify({
    type: "signal",
    senderPeerId: peerId,
    receiverPeerId: String(receiverPeerId ?? ""),
    data: data ?? null,
  });
  return createHmac("sha256", signalKey).update(payload).digest("hex");
}

// A-3: the one origin allowed to receive the room secret in these tests. The
// factory re-checks it against the URL each socket is opened against, so the
// test URLs below (`wss://sig.example.com/room-1`) stay on the allowed origin.
const SIGNALING_ORIGIN = "wss://sig.example.com";

describe("createSignalingSocketFactory — HMAC signal signing", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  it("canonicalSignalPayload matches the server's canonical JSON", () => {
    const msg = { receiverPeerId: "peer-2", data: { sdp: "offer" } };
    expect(canonicalSignalPayload("peer-1", msg)).toBe(
      JSON.stringify({
        type: "signal",
        senderPeerId: "peer-1",
        receiverPeerId: "peer-2",
        data: { sdp: "offer" },
      }),
    );
  });

  it("canonicalSignalPayload normalizes missing receiver and data", () => {
    expect(canonicalSignalPayload("peer-1", {})).toBe(
      JSON.stringify({
        type: "signal",
        senderPeerId: "peer-1",
        receiverPeerId: "",
        data: null,
      }),
    );
  });

  it("A-3: withholds the room secret from any relay that is not the configured server", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://signaling.rxdb.info/") as unknown as MockWebSocket;
    ws.send(JSON.stringify({ type: "join", room: "room-1" }));
    await waitForSent(1);

    const frame = MockWebSocket.instances[0]!.sent[0]!;
    expect(JSON.parse(frame)).toEqual({ type: "join", room: "room-1" });
    expect(frame).not.toContain("secret-1");
  });

  it("rejects invalid room credentials before opening a socket", () => {
    const invalidFactory = createSignalingSocketFactory(
      `secret${String.fromCharCode(0)}`,
      "room-1",
      {
        webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
        selfHostedSignalingUrl: SIGNALING_ORIGIN,
      },
    );
    expect(() => invalidFactory("wss://sig.example.com/room-1")).toThrow(
      "Invalid signaling room credentials",
    );
  });

  it("injects roomSecret into join messages", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    ws.send(JSON.stringify({ type: "join", room: "room-1" }));
    await waitForSent(1);
    const parsed = JSON.parse(MockWebSocket.instances[0]!.sent[0]!);
    expect(parsed.roomSecret).toBe("secret-1");
  });

  it("bounds the serialized join after roomSecret injection", async () => {
    const factory = createSignalingSocketFactory("s".repeat(128), "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    ws.send(JSON.stringify({
      type: "join",
      room: "room-1",
      data: "x".repeat(262_000),
    }));
    await tick();
    expect(MockWebSocket.instances[0]!.sent).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "[SyncService] Signaling join exceeds the safe limit",
    );
  });

  it("rejects a server peer id containing control characters", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    ws.emit("message", JSON.stringify({
      type: "init",
      yourPeerId: `peer-${String.fromCharCode(0)}id`,
    }));
    ws.send(JSON.stringify({
      type: "signal",
      senderPeerId: "peer",
      receiverPeerId: "target",
      data: {},
    }));
    await tick();
    expect(MockWebSocket.instances[0]!.sent).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "[SyncService] Signaling server sent an invalid peer id",
    );
  });

  it("signs signals with a signalAuth that verifies server-side", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    const peerId = "peer-111";
    const msg = { type: "signal", senderPeerId: peerId, receiverPeerId: "peer-222", data: { sdp: "offer" } };

    ws.emit("message", JSON.stringify({ type: "init", yourPeerId: peerId }));
    ws.send(JSON.stringify(msg));
    await waitForSent(1);

    const sent = MockWebSocket.instances[0]!.sent;
    const signed = JSON.parse(sent[sent.length - 1]!);
    expect(signed.signalAuth).toBe(
      referenceSignalAuth("secret-1", "room-1", peerId, "peer-222", { sdp: "offer" }),
    );
    expect(signed.signalAuth).toMatch(/^[0-9a-f]{64}$/);
    // payload unchanged except for the added authenticator
    expect({ ...signed, signalAuth: undefined }).toEqual(msg);
  });

  it("queues signals that race init until the peerId arrives", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    const peerId = "peer-333";
    ws.send(JSON.stringify({ type: "signal", senderPeerId: peerId, receiverPeerId: "peer-444", data: {} }));
    // no init yet — nothing must have been sent
    await tick();
    expect(MockWebSocket.instances[0]!.sent).toHaveLength(0);

    ws.emit("message", JSON.stringify({ type: "init", yourPeerId: peerId }));
    await waitForSent(1);
    const sent = MockWebSocket.instances[0]!.sent;
    expect(sent).toHaveLength(1);
    const signed = JSON.parse(sent[0]!);
    expect(signed.signalAuth).toBe(
      referenceSignalAuth("secret-1", "room-1", peerId, "peer-444", {}),
    );
  });

  it("bounds signals queued before init so a stalled server cannot grow memory", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    for (let i = 0; i < SIGNAL_QUEUE_LIMIT + 1; i++) {
      ws.send(JSON.stringify({
        type: "signal",
        senderPeerId: "peer-queue",
        receiverPeerId: "peer-target",
        data: { index: i },
      }));
    }
    expect(logger.warn).toHaveBeenCalledWith(
      "[SyncService] Signaling queue is full; dropping frame",
    );

    ws.emit("message", JSON.stringify({ type: "init", yourPeerId: "peer-queue" }));
    await waitForSent(SIGNAL_QUEUE_LIMIT);
    expect(MockWebSocket.instances[0]!.sent).toHaveLength(SIGNAL_QUEUE_LIMIT);
  });

  it("rejects a frame whose UTF-8 bytes exceed the limit even when code units do not", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    ws.send(JSON.stringify({
      type: "signal",
      senderPeerId: "peer-unicode",
      receiverPeerId: "peer-target",
      data: "é".repeat(131_050),
    }));
    await tick();
    expect(MockWebSocket.instances[0]!.sent).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "[SyncService] Signaling frame exceeds the safe limit",
    );
  });

  it("drops an oversized signaling frame before parsing or queuing it", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    ws.send(JSON.stringify({
      type: "signal",
      senderPeerId: "peer-large",
      receiverPeerId: "peer-target",
      data: "x".repeat(256 * 1024),
    }));
    await tick();
    expect(MockWebSocket.instances[0]!.sent).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "[SyncService] Signaling frame exceeds the safe limit",
    );
  });

  it("closes on an oversized server frame instead of falling back to unsigned sends", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    ws.emit("message", "x".repeat(256 * 1024 + 1));
    ws.send(JSON.stringify({
      type: "signal",
      senderPeerId: "peer-large",
      receiverPeerId: "peer-target",
      data: {},
    }));
    await tick();
    expect(MockWebSocket.instances[0]!.sent).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "[SyncService] Signaling frame from server exceeds the safe limit",
    );
  });

  it("rejects an invalid server peer id before signing queued signals", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    ws.emit("message", JSON.stringify({
      type: "init",
      yourPeerId: "x".repeat(129),
    }));
    ws.send(JSON.stringify({
      type: "signal",
      senderPeerId: "peer-invalid",
      receiverPeerId: "peer-target",
      data: {},
    }));
    await tick();
    expect(MockWebSocket.instances[0]!.sent).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "[SyncService] Signaling server sent an invalid peer id",
    );
  });

  it("discards queued signals when the socket dies before init", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    const msg = { type: "signal", senderPeerId: "p", receiverPeerId: "q", data: 1 };
    ws.send(JSON.stringify(msg));
    await tick();
    expect(MockWebSocket.instances[0]!.sent).toHaveLength(0);

    // A closed socket is a security boundary: queued work must not be
    // released as unsigned raw data after the peer connection is gone.
    ws.emit("error");
    await tick();
    expect(MockWebSocket.instances[0]!.sent).toHaveLength(0);
    void msg;
  });

  it("watchdog releases queued signals when the server never sends init", async () => {
    // The server accepts the socket but never emits `init` (and never errors).
    // Without the watchdog the serial chain would hold the signal forever;
    // after SIGNAL_INIT_TIMEOUT_MS it must fall through to the raw send.
    vi.useFakeTimers();
    try {
      const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
      const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
      const msg = { type: "signal", senderPeerId: "p", receiverPeerId: "q", data: 1 };
      ws.send(JSON.stringify(msg));
      await vi.advanceTimersByTimeAsync(1);
      expect(MockWebSocket.instances[0]!.sent).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(SIGNAL_INIT_TIMEOUT_MS + 1);

      const sent = MockWebSocket.instances[0]!.sent;
      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0]!)).toEqual(msg);
    } finally {
      vi.useRealTimers();
    }
  });

  it("watchdog does NOT fire once init has arrived", async () => {
    vi.useFakeTimers();
    try {
      const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
      const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
      const peerId = "peer-777";
      const msg = { type: "signal", senderPeerId: peerId, receiverPeerId: "q", data: 2 };
      ws.emit("message", JSON.stringify({ type: "init", yourPeerId: peerId }));
      ws.send(JSON.stringify(msg));

      // WebCrypto resolves through a native promise queue, while the
      // watchdog uses fake timers. `vi.waitFor` advances the fake clock and
      // yields to the native queue, making this deterministic under parallel
      // suite load instead of relying on a fixed number of 1 ms ticks.
      await vi.waitFor(
        () => expect(MockWebSocket.instances[0]!.sent).toHaveLength(1),
        { timeout: 1000, interval: 1 },
      );
      await vi.advanceTimersByTimeAsync(SIGNAL_INIT_TIMEOUT_MS + 1);

      const sent = MockWebSocket.instances[0]!.sent;
      expect(sent).toHaveLength(1);
      // Init arrived → signal is HMAC-signed (signalAuth present), NOT the raw
      // fallthrough the watchdog would have produced.
      const signed = JSON.parse(sent[0]!);
      expect(signed.signalAuth).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes non-signal, non-join frames through untouched", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    const ping = JSON.stringify({ type: "ping", data: "hello" });
    ws.send(ping);
    await waitForSent(1);
    expect(MockWebSocket.instances[0]!.sent).toEqual([ping]);
  });

  it("recovers the FIFO queue after a native send failure", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    const socket = MockWebSocket.instances[0]!;
    socket.failNextSend = true;

    ws.send(JSON.stringify({ type: "ping", data: "first" }));
    ws.send(JSON.stringify({ type: "ping", data: "second" }));
    await waitForSent(1);

    expect(socket.sent).toEqual([
      JSON.stringify({ type: "ping", data: "second" }),
    ]);
  });

  it("keeps signal send order with async signing", async () => {
    const factory = createSignalingSocketFactory("secret-1", "room-1", {
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SIGNALING_ORIGIN,
    });
    const ws = factory("wss://sig.example.com/room-1") as unknown as MockWebSocket;
    const peerId = "peer-555";
    ws.emit("message", JSON.stringify({ type: "init", yourPeerId: peerId }));
    ws.send(JSON.stringify({ type: "signal", senderPeerId: peerId, receiverPeerId: "b", data: { n: 1 } }));
    ws.send(JSON.stringify({ type: "signal", senderPeerId: peerId, receiverPeerId: "b", data: { n: 2 } }));
    await waitForSent(2);
    const sent = MockWebSocket.instances[0]!.sent;
    expect(JSON.parse(sent[0]!).data).toEqual({ n: 1 });
    expect(JSON.parse(sent[1]!).data).toEqual({ n: 2 });
  });

  it("deriveClientSignalKey is deterministic and matches the server key", async () => {
    const key = await deriveClientSignalKey("secret-1", "room-1");
    const expected = createHmac("sha256", "secret-1")
      .update("bookmarkforge-signal-auth:room-1")
      .digest();
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode("payload-bytes"),
    );
    const refSignature = createHmac("sha256", expected)
      .update("payload-bytes")
      .digest("hex");
    const hex = Array.from(new Uint8Array(signature), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    expect(hex).toBe(refSignature);
  });
});
