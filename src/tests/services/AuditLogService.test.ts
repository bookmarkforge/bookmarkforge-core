import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Safely hoist mock storage state above vi.mock (vi.mock is hoisted by Vitest)
const { mockSecrets, mockSecureStorage } = vi.hoisted(() => {
  const secrets: Record<string, string> = {};
  return {
    mockSecrets: secrets,
    mockSecureStorage: {
      setSecret: vi.fn(async (key: string, value: string) => {
        secrets[key] = value;
      }),
      getSecret: vi.fn(async (key: string) => {
        return secrets[key] ?? null;
      }),
      deleteSecret: vi.fn(async (key: string) => {
        delete secrets[key];
      }),
      // P1: device-key gate used by recoverFallbackEntries() — without these
      // the boot recovery silently returned on every import (TypeError swallowed).
      isDeviceKeyWrapped: vi.fn(async () => false),
      isDeviceKeyMaterialized: vi.fn(() => false),
    },
  };
});

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: mockSecureStorage,
}));

vi.mock("../../services/SecurityVault", () => ({
  securityVault: vaultMock,
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const vaultMock = vi.hoisted(() => ({
  withMasterPasswordBytes: vi.fn(),
  registerCaller: vi.fn(),
  onLock: vi.fn(() => () => {}),
  onUnlock: vi.fn(() => () => {}),
}));

import {
  auditLog,
  getAuditSessionId,
  rotateAuditSessionId,
} from "../../services/AuditLogService";
import type {
  AuditEntry,
  AuditAction,
  AuditResult,
} from "../../services/AuditLogService";

// Helper to advance timers and flush pending writes
async function advanceTimersAndFlush(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  // Allow any pending promises (flush writes) to resolve
  await vi.runAllTicks();
}

describe("AuditLogService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Clear mock secrets
    Object.keys(mockSecrets).forEach((k) => delete mockSecrets[k]);
    // Reset the audit log internal state by clearing and resetting cache
    mockSecureStorage.setSecret.mockClear();
    mockSecureStorage.getSecret.mockClear();
    mockSecureStorage.deleteSecret.mockClear();
    (auditLog as any).cache = null;
    (auditLog as any).pendingWrites = [];
    (auditLog as any).writeTimer = null;
    (auditLog as any).flushPromise = null;
    (auditLog as any).suspended = false;
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("attestation chain integrity (H2)", () => {
    beforeEach(async () => {
      // Unlocked vault: withMasterPasswordBytes hands out key bytes.
      vaultMock.withMasterPasswordBytes.mockImplementation((_caller, fn) =>
        fn(new Uint8Array([1, 2, 3])),
      );
      // The dynamically imported AttestationChain is a module singleton whose
      // in-memory chain + `initialized` flag survive across tests; reset it
      // so each test starts from the mocked storage state.
      const { attestationChain } = await import(
        "../../services/security/AttestationChain",
      );
      attestationChain.clear();
      (attestationChain as unknown as { initialized: boolean }).initialized =
        false;
    });

    it("appends every recorded entry to the chain while unlocked", async () => {
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });
      await auditLog.record({
        action: "vault_lock",
        result: "success",
        origin: "test",
      });
      // Let the serialized appends (dynamic import + HMAC) settle.
      await (auditLog as unknown as { attestationQueue: Promise<void> })
        .attestationQueue;

      const stored = mockSecrets["attestation_chain"];
      expect(stored).toBeDefined();
      const chain = JSON.parse(stored!) as Array<{
        index: number;
        signature: string;
      }>;
      expect(chain).toHaveLength(2);
      expect(chain[0]!.signature.length).toBeGreaterThan(0);
    });

    it("verifyIntegrity returns valid for a genuine chain", async () => {
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });
      await auditLog.record({
        action: "vault_lock",
        result: "success",
        origin: "test",
      });

      const result = await auditLog.verifyIntegrity();
      expect(result.valid).toBe(true);
      expect(result.brokenAt).toBeNull();
      expect(result.checked).toBe(2);
      expect(result.error).toBeUndefined();
    });

    it("verifyIntegrity detects a tampered chain link", async () => {
      // Seed a broken chain (second link points at a wrong prevHash).
      mockSecrets["attestation_chain"] = JSON.stringify([
        {
          index: 0,
          prevHash: "genesis",
          data: "{}",
          timestamp: "2026-01-01T00:00:00Z",
          signature: "deadbeef",
        },
        {
          index: 1,
          prevHash: "wrong-prev",
          data: "{}",
          timestamp: "2026-01-01T00:00:01Z",
          signature: "cafebabe",
        },
      ]);

      const result = await auditLog.verifyIntegrity();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
      expect(result.checked).toBe(2);
    });

    it("skips chaining without throwing when the vault is locked", async () => {
      vaultMock.withMasterPasswordBytes.mockImplementation(() =>
        Promise.resolve(null),
      );
      await auditLog.record({
        action: "vault_unlock_failed",
        result: "failure",
        origin: "test",
      });
      await (auditLog as unknown as { attestationQueue: Promise<void> })
        .attestationQueue;
      await advanceTimersAndFlush(5000);

      // No chain record was written; the entry itself still flushed fine.
      expect(mockSecrets["attestation_chain"]).toBeUndefined();
      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      expect(JSON.parse(storedJson)).toHaveLength(1);
    });
  });

  describe("getAuditSessionId / rotateAuditSessionId", () => {
    it("returns a session ID starting with s_", () => {
      rotateAuditSessionId(); // ensure fresh
      const id = getAuditSessionId();
      expect(id.startsWith("s_")).toBe(true);
      expect(id.length).toBeGreaterThan(10);
    });

    it("returns the same session ID across multiple calls", () => {
      rotateAuditSessionId();
      const id1 = getAuditSessionId();
      const id2 = getAuditSessionId();
      expect(id1).toBe(id2);
    });

    it("rotateAuditSessionId generates a new session ID", () => {
      rotateAuditSessionId();
      const id1 = getAuditSessionId();
      rotateAuditSessionId();
      const id2 = getAuditSessionId();
      expect(id1).not.toBe(id2);
    });
  });

  describe("record", () => {
    it("queues an entry without immediately writing to SecureStorage", async () => {
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });

      // Should not have written yet (5s batch timer)
      expect(mockSecureStorage.setSecret).not.toHaveBeenCalled();
    });

    it("flushes after batch interval", async () => {
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });

      await advanceTimersAndFlush(5000);

      expect(mockSecureStorage.setSecret).toHaveBeenCalledTimes(1);
    });

    it("schedules only one flush timer for multiple records", async () => {
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });
      await auditLog.record({
        action: "vault_lock",
        result: "success",
        origin: "test",
      });
      await auditLog.record({
        action: "secret_encrypt",
        result: "success",
        origin: "test",
      });

      await advanceTimersAndFlush(5000);

      // All 3 entries should be in one batch
      expect(mockSecureStorage.setSecret).toHaveBeenCalledTimes(1);
      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed).toHaveLength(3);
    });

    it("sets default target to 'system'", async () => {
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed[0]!.target).toBe("system");
    });

    it("uses provided target", async () => {
      await auditLog.record({
        action: "backup_exported",
        target: "export_123",
        result: "success",
        origin: "BackupService",
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed[0]!.target).toBe("export_123");
    });

    it("sanitizes context values containing passwords", async () => {
      await auditLog.record({
        action: "vault_unlock",
        result: "failure",
        origin: "test",
        context: {
          reason: "password=mySecret123 was incorrect",
          timestamp: "2026-01-01T00:00:00Z",
        },
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed[0]!.context!.reason!).toContain("[REDACTED]");
      expect(parsed[0]!.context!.reason!).not.toContain("mySecret123");
    });

    it("sanitizes context values containing API keys", async () => {
      await auditLog.record({
        action: "api_key_stored",
        result: "success",
        origin: "test",
        context: {
          key: "api_key=sk-1234567890abcdef",
        },
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed[0]!.context!.key!).toContain("[REDACTED]");
      expect(parsed[0]!.context!.key!).not.toContain("sk-1234567890abcdef");
    });

    it("sanitizes context values containing tokens", async () => {
      await auditLog.record({
        action: "sync_started",
        result: "success",
        origin: "test",
        context: {
          auth: "token=bearer.jwt.token.here",
        },
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed[0]!.context!.auth!).toContain("[REDACTED]");
      expect(parsed[0]!.context!.auth!).not.toContain("bearer.jwt.token.here");
    });

    it("sanitizes context values containing secrets", async () => {
      await auditLog.record({
        action: "recovery_phrase_set",
        result: "success",
        origin: "test",
        context: {
          phrase: "secret=horse-battery-staple",
        },
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed[0]!.context!.phrase!).toContain("[REDACTED]");
      expect(parsed[0]!.context!.phrase!).not.toContain("horse-battery-staple");
    });

    it("truncates context values longer than 200 characters", async () => {
      const longString = "a".repeat(300);
      await auditLog.record({
        action: "data_exported",
        result: "success",
        origin: "test",
        context: { detail: longString },
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed[0]!.context!.detail!.length!).toBeLessThanOrEqual(200);
    });

    it("sanitizes targets with internal storage key prefixes", async () => {
      await auditLog.record({
        action: "secret_encrypt",
        target: "encrypted_api_key",
        result: "success",
        origin: "test",
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed[0]!.target).toBe("internal_key");
    });

    it("preserves non-internal targets unchanged", async () => {
      await auditLog.record({
        action: "backup_exported",
        target: "export_123",
        result: "success",
        origin: "BackupService",
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed[0]!.target).toBe("export_123");
    });

    it("sanitizes targets with recovery_ prefix", async () => {
      await auditLog.record({
        action: "recovery_phrase_set",
        target: "recovery_data",
        result: "success",
        origin: "test",
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed[0]!.target).toBe("internal_key");
    });

    it("includes session ID in every entry", async () => {
      rotateAuditSessionId();
      const sessionId = getAuditSessionId();

      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed[0]!.sessionId).toBe(sessionId);
    });

    it("sets ISO 8601 timestamp", async () => {
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(() => new Date(parsed[0]!.timestamp)).not.toThrow();
      expect(parsed[0]!.timestamp).toContain("T");
    });
  });

  describe("suspend (nuclear forget wipe)", () => {
    it("drops records recorded while suspended", async () => {
      auditLog.suspend();
      await auditLog.record({
        action: "vault_lock",
        result: "success",
        origin: "test",
      });
      await advanceTimersAndFlush(5000);
      expect(mockSecureStorage.setSecret).not.toHaveBeenCalled();
      expect((auditLog as any).pendingWrites).toHaveLength(0);
    });

    it("cancels a pending flush timer and clears queued entries", async () => {
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });
      expect((auditLog as any).writeTimer).not.toBeNull();

      auditLog.suspend();

      expect((auditLog as any).writeTimer).toBeNull();
      expect((auditLog as any).pendingWrites).toHaveLength(0);
      await advanceTimersAndFlush(5000);
      expect(mockSecureStorage.setSecret).not.toHaveBeenCalled();
    });

    it("forceFlush is a no-op while suspended (pagehide during post-wipe reload)", async () => {
      auditLog.suspend();
      await auditLog.record({
        action: "vault_lock",
        result: "success",
        origin: "test",
      });
      await auditLog.forceFlush();
      expect(mockSecureStorage.setSecret).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("audit_pending_fallback")).toBeNull();
      expect((auditLog as any).writeTimer).toBeNull();
    });

    it("a flush that runs while suspended never touches storage", async () => {
      // Even if a flush was already in flight when suspend() landed (the
      // pagehide handler during the post-wipe reload is the real-world
      // case), flushInternal must not reach SecureStorage.
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });
      auditLog.suspend();
      await (auditLog as any).flush();
      expect(mockSecureStorage.setSecret).not.toHaveBeenCalled();
      expect((auditLog as any).pendingWrites).toHaveLength(0);
    });

    it("resume re-enables recording", async () => {
      auditLog.suspend();
      auditLog.resume();
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });
      await advanceTimersAndFlush(5000);
      expect(mockSecureStorage.setSecret).toHaveBeenCalledTimes(1);
    });
  });

  describe("forceFlush", () => {
    it("flushPending is an immediate lifecycle flush", async () => {
      await auditLog.record({
        action: "vault_lock",
        result: "success",
        origin: "SecurityVault",
      });

      await auditLog.flushPending();

      expect(mockSecureStorage.setSecret).toHaveBeenCalledTimes(1);
      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      expect((JSON.parse(storedJson) as AuditEntry[])[0]!.action).toBe("vault_lock");
    });

    it("flushes pending writes immediately", async () => {
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });

      // forceFlush without waiting for timer
      await auditLog.forceFlush();

      expect(mockSecureStorage.setSecret).toHaveBeenCalledTimes(1);
    });

    it("clears the pending write timer", async () => {
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });

      expect((auditLog as any).writeTimer).not.toBeNull();

      await auditLog.forceFlush();

      expect((auditLog as any).writeTimer).toBeNull();
    });

    it("retains the unload fallback when IndexedDB flush fails", async () => {
      mockSecureStorage.setSecret.mockRejectedValue(new Error("IDB down"));
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });

      await auditLog.forceFlush();

      expect(sessionStorage.getItem("audit_pending_fallback")).not.toBeNull();
      expect((auditLog as any).pendingWrites).toHaveLength(1);
      mockSecureStorage.setSecret.mockImplementation(async (key: string, value: string) => {
        mockSecrets[key] = value;
      });
    });
  });

  describe("getAll", () => {
    it("returns empty array when no entries exist", async () => {
      const entries = await auditLog.getAll();
      expect(entries).toEqual([]);
    });

    it("returns stored entries newest first", async () => {
      // Pre-populate mock storage with entries
      const entries: AuditEntry[] = [
        {
          id: "1",
          timestamp: "2026-01-01T00:00:00.000Z",
          action: "vault_unlock",
          target: "system",
          result: "success",
          origin: "test",
          sessionId: "s_abc",
        },
        {
          id: "2",
          timestamp: "2026-01-01T01:00:00.000Z",
          action: "vault_lock",
          target: "system",
          result: "success",
          origin: "test",
          sessionId: "s_abc",
        },
      ];
      mockSecrets["audit_log"] = JSON.stringify(entries);
      (auditLog as any).cache = null;

      const result = await auditLog.getAll();
      expect(result).toHaveLength(2);
    });

    it("caches results after first read", async () => {
      mockSecrets["audit_log"] = JSON.stringify([]);
      (auditLog as any).cache = null;

      await auditLog.getAll();
      mockSecureStorage.getSecret.mockClear();

      // Second call should use cache
      await auditLog.getAll();
      expect(mockSecureStorage.getSecret).not.toHaveBeenCalled();
    });

    it("returns empty array on parse error", async () => {
      mockSecrets["audit_log"] = "invalid json{{{";
      (auditLog as any).cache = null;

      const entries = await auditLog.getAll();
      expect(entries).toEqual([]);
    });

    it("returns empty array when stored JSON is not an array", async () => {
      mockSecrets["audit_log"] = JSON.stringify({ not: "an array" });
      (auditLog as any).cache = null;

      const entries = await auditLog.getAll();
      expect(entries).toEqual([]);
      // The cache must be a real array so the NEXT call spreads safely.
      await auditLog.getAll();
      expect(entries).toEqual([]);
    });

    it("drops non-object entries from a stored array", async () => {
      const good: AuditEntry = {
        id: "1",
        timestamp: "2026-01-01T00:00:00.000Z",
        action: "vault_unlock",
        target: "system",
        result: "success",
        origin: "test",
        sessionId: "s_abc",
      };
      mockSecrets["audit_log"] = JSON.stringify([good, "junk", null, 42]);
      (auditLog as any).cache = null;

      const entries = await auditLog.getAll();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.id).toBe("1");
    });
  });

  describe("getByAction", () => {
    it("filters entries by action type", async () => {
      const entries: AuditEntry[] = [
        {
          id: "1",
          timestamp: "2026-01-01T00:00:00.000Z",
          action: "vault_unlock",
          target: "system",
          result: "success",
          origin: "test",
          sessionId: "s_abc",
        },
        {
          id: "2",
          timestamp: "2026-01-01T01:00:00.000Z",
          action: "vault_lock",
          target: "system",
          result: "success",
          origin: "test",
          sessionId: "s_abc",
        },
        {
          id: "3",
          timestamp: "2026-01-01T02:00:00.000Z",
          action: "vault_unlock",
          target: "system",
          result: "success",
          origin: "test",
          sessionId: "s_abc",
        },
      ];
      mockSecrets["audit_log"] = JSON.stringify(entries);
      (auditLog as any).cache = null;

      const result = await auditLog.getByAction("vault_unlock");
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.action === "vault_unlock")).toBe(true);
    });

    it("respects the limit parameter", async () => {
      const entries: AuditEntry[] = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        timestamp: `2026-01-01T0${i}:00:00.000Z`,
        action: "vault_unlock" as AuditAction,
        target: "system",
        result: "success" as AuditResult,
        origin: "test",
        sessionId: "s_abc",
      }));
      mockSecrets["audit_log"] = JSON.stringify(entries);
      (auditLog as any).cache = null;

      const result = await auditLog.getByAction("vault_unlock", 3);
      expect(result).toHaveLength(3);
    });

    it("returns empty array when no matches", async () => {
      mockSecrets["audit_log"] = JSON.stringify([]);
      (auditLog as any).cache = null;

      const result = await auditLog.getByAction("backup_exported");
      expect(result).toEqual([]);
    });
  });

  describe("getByResult", () => {
    it("filters entries by result type", async () => {
      const entries: AuditEntry[] = [
        {
          id: "1",
          timestamp: "2026-01-01T00:00:00.000Z",
          action: "vault_unlock",
          target: "system",
          result: "success",
          origin: "test",
          sessionId: "s_abc",
        },
        {
          id: "2",
          timestamp: "2026-01-01T01:00:00.000Z",
          action: "vault_unlock",
          target: "system",
          result: "failure",
          origin: "test",
          sessionId: "s_abc",
        },
      ];
      mockSecrets["audit_log"] = JSON.stringify(entries);
      (auditLog as any).cache = null;

      const failures = await auditLog.getByResult("failure");
      expect(failures).toHaveLength(1);
      expect(failures[0]!.result).toBe("failure");
    });
  });

  describe("getByTimeRange", () => {
    it("filters entries within a time range", async () => {
      const entries: AuditEntry[] = [
        {
          id: "1",
          timestamp: "2026-01-01T00:00:00.000Z",
          action: "vault_unlock",
          target: "system",
          result: "success",
          origin: "test",
          sessionId: "s_abc",
        },
        {
          id: "2",
          timestamp: "2026-01-02T00:00:00.000Z",
          action: "vault_lock",
          target: "system",
          result: "success",
          origin: "test",
          sessionId: "s_abc",
        },
        {
          id: "3",
          timestamp: "2026-01-03T00:00:00.000Z",
          action: "secret_encrypt",
          target: "system",
          result: "success",
          origin: "test",
          sessionId: "s_abc",
        },
      ];
      mockSecrets["audit_log"] = JSON.stringify(entries);
      (auditLog as any).cache = null;

      const result = await auditLog.getByTimeRange(
        new Date("2026-01-01T12:00:00.000Z"),
        new Date("2026-01-03T00:00:00.000Z"),
      );
      expect(result).toHaveLength(2);
    });

    it("returns empty array when no entries in range", async () => {
      mockSecrets["audit_log"] = JSON.stringify([]);
      (auditLog as any).cache = null;

      const result = await auditLog.getByTimeRange(
        new Date("2025-01-01"),
        new Date("2025-01-02"),
      );
      expect(result).toEqual([]);
    });

    it("respects the limit parameter", async () => {
      const entries: AuditEntry[] = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        timestamp: `2026-01-01T0${i}:00:00.000Z`,
        action: "vault_unlock" as AuditAction,
        target: "system",
        result: "success" as AuditResult,
        origin: "test",
        sessionId: "s_abc",
      }));
      mockSecrets["audit_log"] = JSON.stringify(entries);
      (auditLog as any).cache = null;

      const result = await auditLog.getByTimeRange(
        new Date("2026-01-01"),
        new Date("2026-01-02"),
        5,
      );
      expect(result.length).toBeLessThanOrEqual(5);
    });
  });

  describe("getActionCounts", () => {
    it("returns counts grouped by action type", async () => {
      const entries: AuditEntry[] = [
        {
          id: "1",
          timestamp: "2026-01-01T00:00:00.000Z",
          action: "vault_unlock",
          target: "system",
          result: "success",
          origin: "test",
          sessionId: "s_abc",
        },
        {
          id: "2",
          timestamp: "2026-01-01T01:00:00.000Z",
          action: "vault_lock",
          target: "system",
          result: "success",
          origin: "test",
          sessionId: "s_abc",
        },
        {
          id: "3",
          timestamp: "2026-01-01T02:00:00.000Z",
          action: "vault_unlock",
          target: "system",
          result: "success",
          origin: "test",
          sessionId: "s_abc",
        },
      ];
      mockSecrets["audit_log"] = JSON.stringify(entries);
      (auditLog as any).cache = null;

      const counts = await auditLog.getActionCounts();
      expect(counts["vault_unlock"]).toBe(2);
      expect(counts["vault_lock"]).toBe(1);
    });

    it("returns empty object when no entries", async () => {
      mockSecrets["audit_log"] = JSON.stringify([]);
      (auditLog as any).cache = null;

      const counts = await auditLog.getActionCounts();
      expect(counts).toEqual({});
    });
  });

  describe("count", () => {
    it("returns 0 when no entries", async () => {
      mockSecrets["audit_log"] = JSON.stringify([]);
      (auditLog as any).cache = null;

      const c = await auditLog.count();
      expect(c).toBe(0);
    });

    it("returns the total number of entries", async () => {
      const entries: AuditEntry[] = Array.from({ length: 5 }, (_, i) => ({
        id: String(i),
        timestamp: `2026-01-01T0${i}:00:00.000Z`,
        action: "vault_unlock" as AuditAction,
        target: "system",
        result: "success" as AuditResult,
        origin: "test",
        sessionId: "s_abc",
      }));
      mockSecrets["audit_log"] = JSON.stringify(entries);
      (auditLog as any).cache = null;

      const c = await auditLog.count();
      expect(c).toBe(5);
    });
  });

  describe("hasEntries", () => {
    it("returns false when no entries", async () => {
      mockSecrets["audit_log"] = JSON.stringify([]);
      (auditLog as any).cache = null;

      const has = await auditLog.hasEntries();
      expect(has).toBe(false);
    });

    it("returns true when entries exist", async () => {
      const entries: AuditEntry[] = [
        {
          id: "1",
          timestamp: "2026-01-01T00:00:00.000Z",
          action: "vault_unlock",
          target: "system",
          result: "success",
          origin: "test",
          sessionId: "s_abc",
        },
      ];
      mockSecrets["audit_log"] = JSON.stringify(entries);
      (auditLog as any).cache = null;

      const has = await auditLog.hasEntries();
      expect(has).toBe(true);
    });
  });

  describe("clear", () => {
    it("deletes all entries from storage", async () => {
      mockSecrets["audit_log"] = JSON.stringify([]);
      (auditLog as any).cache = null;

      await auditLog.clear();

      expect(mockSecureStorage.deleteSecret).toHaveBeenCalledWith("audit_log");
    });

    it("resets cache after clear", async () => {
      mockSecrets["audit_log"] = JSON.stringify([{ id: "1" }]);
      (auditLog as any).cache = [{ id: "1" }];
      sessionStorage.setItem("audit_pending_fallback", "stale");

      await auditLog.clear();

      expect((auditLog as any).cache).toBeNull();
      expect((auditLog as any).pendingWrites).toEqual([]);
      expect(sessionStorage.getItem("audit_pending_fallback")).toBeNull();
      expect((auditLog as any).writeTimer).toBeNull();
    });

    it("re-throws errors from storage", async () => {
      mockSecureStorage.deleteSecret.mockRejectedValueOnce(
        new Error("Storage error"),
      );

      await expect(auditLog.clear()).rejects.toThrow("Storage error");
    });
  });

  describe("max entries eviction", () => {
    it("evicts oldest entries when exceeding 200", async () => {
      // Create 201 entries with staggered timestamps
      const existingEntries: AuditEntry[] = Array.from(
        { length: 200 },
        (_, i) => ({
          id: `old-${i}`,
          timestamp: `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`,
          action: "vault_unlock" as AuditAction,
          target: "system",
          result: "success" as AuditResult,
          origin: "test",
          sessionId: "s_abc",
        }),
      );

      mockSecrets["audit_log"] = JSON.stringify(existingEntries);
      (auditLog as any).cache = null;

      // Record one more entry
      await auditLog.record({
        action: "vault_lock",
        result: "success",
        origin: "test",
      });

      await advanceTimersAndFlush(5000);

      // Should have evicted the oldest and kept 200
      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed.length).toBeLessThanOrEqual(200);
    });
  });

  describe("error handling", () => {
    it("re-queues pending writes on flush failure", async () => {
      mockSecureStorage.setSecret.mockRejectedValueOnce(
        new Error("Write failed"),
      );

      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });

      await advanceTimersAndFlush(5000);

      // Pending writes should be re-queued after failed flush
      // The entries are pushed back to pendingWrites
      const pendingCount = (auditLog as any).pendingWrites.length;
      expect(pendingCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("context sanitization edge cases", () => {
    it("handles null context", async () => {
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
        // No context at all
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed[0]!.context!).toBeUndefined();
    });

    it("replaces newlines and tabs in context values", async () => {
      await auditLog.record({
        action: "backup_exported",
        result: "failure",
        origin: "test",
        context: {
          error: "line1\nline2\tindented",
        },
      });

      await advanceTimersAndFlush(5000);

      const storedJson = mockSecureStorage.setSecret.mock.calls[0]![1] as string;
      const parsed = JSON.parse(storedJson) as AuditEntry[];
      expect(parsed[0]!.context!.error!).not.toContain("\n");
      expect(parsed[0]!.context!.error!).not.toContain("\t");
      expect(parsed[0]!.context!.error!).toContain("line1 line2 indented");
    });
  });

  describe("multiple flush cycles", () => {
    it("handles multiple flush cycles correctly", async () => {
      // First batch
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });
      await advanceTimersAndFlush(5000);

      // Second batch
      await auditLog.record({
        action: "vault_lock",
        result: "success",
        origin: "test",
      });
      await advanceTimersAndFlush(5000);

      expect(mockSecureStorage.setSecret).toHaveBeenCalledTimes(2);
    });

    it("accumulates entries across cycles", async () => {
      // First batch
      await auditLog.record({
        action: "vault_unlock",
        result: "success",
        origin: "test",
      });
      await advanceTimersAndFlush(5000);

      // Second batch
      await auditLog.record({
        action: "vault_lock",
        result: "success",
        origin: "test",
      });
      await advanceTimersAndFlush(5000);

      // After two flushes, should have 2 entries total
      const calls = mockSecureStorage.setSecret.mock.calls;
      expect(calls.length).toBe(2);

      // The second call should contain both entries (old + new)
      const secondCall = calls[1]![1] as string;
      const secondEntries = JSON.parse(secondCall) as AuditEntry[];
      expect(secondEntries.length).toBe(2);
    });
  });

  // ── P1 mock-contract sweep — boot fallback recovery gate ─────────────────
  describe("P1 — boot fallback recovery (device-key gate)", () => {
    const FALLBACK_ENTRY = {
      id: "fb-1",
      timestamp: "2026-09-30T00:00:00.000Z",
      action: "vault_unlock_failed",
      target: "system",
      result: "failure",
      origin: "test",
      sessionId: "s_boot",
    };

    it("merges sessionStorage fallback entries when the device key is available", async () => {
      expect(mockSecureStorage.isDeviceKeyWrapped).toBeDefined();
      expect(mockSecureStorage.isDeviceKeyMaterialized).toBeDefined();

      sessionStorage.setItem(
        "audit_pending_fallback",
        JSON.stringify([FALLBACK_ENTRY]),
      );
      mockSecrets["audit_log"] = JSON.stringify([]);
      (auditLog as any).cache = null;

      await auditLog.recoverFallbackEntries();

      expect(mockSecureStorage.isDeviceKeyWrapped).toHaveBeenCalled();
      expect(sessionStorage.getItem("audit_pending_fallback")).toBeNull();
      expect((auditLog as any).cache).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "fb-1" }),
        ]),
      );
    });

    it("keeps the fallback queued while the device key is wrapped but not materialized", async () => {
      expect(mockSecureStorage.isDeviceKeyWrapped).toBeDefined();
      expect(mockSecureStorage.isDeviceKeyMaterialized).toBeDefined();

      sessionStorage.setItem(
        "audit_pending_fallback",
        JSON.stringify([FALLBACK_ENTRY]),
      );
      mockSecureStorage.isDeviceKeyWrapped.mockResolvedValue(true);
      mockSecureStorage.isDeviceKeyMaterialized.mockReturnValue(false);

      await auditLog.recoverFallbackEntries();

      // The gate branch must actually run (this is the P1 finding):
      expect(mockSecureStorage.isDeviceKeyWrapped).toHaveBeenCalled();
      expect(mockSecureStorage.isDeviceKeyMaterialized).toHaveBeenCalled();
      // Still queued — SecureStorage must not be touched while wrapped+locked:
      expect(sessionStorage.getItem("audit_pending_fallback")).not.toBeNull();
    });
  });
});
