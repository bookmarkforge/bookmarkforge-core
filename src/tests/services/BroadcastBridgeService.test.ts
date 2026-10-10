/**
 * Tests for BroadcastBridgeService
 * Mocks BroadcastChannel, initDB and logger
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let mockChannelPostMessage: any;
const mockBroadcastChannel = vi.hoisted(() =>
  vi.fn(function () {
    let _onmessage: any = null;
    const channel = {
      postMessage: vi.fn(),
      close: vi.fn(),
      get onmessage() {
        return _onmessage;
      },
      set onmessage(handler: any) {
        _onmessage = handler;
      },
    };
    mockChannelPostMessage = channel.postMessage;
    return channel;
  }),
);
vi.stubGlobal("BroadcastChannel", mockBroadcastChannel);

const mockInitDB = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    bookmarks: {
      insert: vi.fn().mockResolvedValue({}),
    },
  }),
);
vi.mock("../../db/database", () => ({
  initDB: (...args: any[]) => mockInitDB(...args),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    isLocked: vi.fn(() => false),
    deriveBridgeKey: vi.fn(async () =>
      crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode("test-bridge-key"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      ),
    ),
    encryptSecret: vi.fn(),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
  SECURE_STORAGE_KEYS: {
    RECOVERY_DATA: "recovery_data",
    API_KEY: "encrypted_api_key",
    DB_KEY: "encrypted_db_key",
    MASTER_PASSWORD_SETUP: "master_password_setup",
    VERIFICATION: "vault_verification",
  },
}));

import { broadcastBridgeService } from "../../services/BroadcastBridgeService";

const BRIDGE_REALM = "bookmarkforge-bridge-v1";

async function signPayload(
  payload: Record<string, unknown>,
  nonce: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("test-bridge-key"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = JSON.stringify({ ...payload, nonce, realm: BRIDGE_REALM });
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return Array.from(new Uint8Array(sig), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

const signed = async (
  data: Record<string, unknown>,
  messageId: string,
): Promise<Record<string, unknown>> => {
  const nonce = `valid-nonce-${messageId}`;
  const signature = await signPayload(data, nonce);
  return { type: "SAVE_BOOKMARK", messageId, data, signature, nonce };
};

describe("BroadcastBridgeService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitDB.mockResolvedValue({
      bookmarks: { insert: vi.fn().mockResolvedValue({}) },
    });
    mockBroadcastChannel.mockClear();
  });

  afterEach(() => {
    broadcastBridgeService.stop();
  });

  describe("start", () => {
    it("should create a BroadcastChannel", () => {
      broadcastBridgeService.start();
      expect(mockBroadcastChannel).toHaveBeenCalledWith("bmf-channel");
    });

    it("should not create another channel if already started", () => {
      broadcastBridgeService.start();
      broadcastBridgeService.start();
      expect(mockBroadcastChannel).toHaveBeenCalledTimes(1);
    });
  });

  describe("stop", () => {
    it("should close the channel", () => {
      broadcastBridgeService.start();
      const channel = mockBroadcastChannel.mock.results[0]!.value;
      broadcastBridgeService.stop();
      expect(channel.close).toHaveBeenCalled();
    });
  });

  describe("message handling", () => {
    it("should respond to PING with PONG", () => {
      broadcastBridgeService.start();
      const channel = mockBroadcastChannel.mock.results[0]!.value;

      channel.onmessage({ data: { type: "PING" } });
      expect(channel.postMessage).toHaveBeenCalledWith({
        type: "PONG",
        source: "bookmarkforge",
      });
    });

    it("should ignore messages without data", () => {
      broadcastBridgeService.start();
      const channel = mockBroadcastChannel.mock.results[0]!.value;
      channel.onmessage(null);
      expect(channel.postMessage).not.toHaveBeenCalled();
    });

    it("should ignore messages without type", () => {
      broadcastBridgeService.start();
      const channel = mockBroadcastChannel.mock.results[0]!.value;
      channel.onmessage({ data: { foo: "bar" } });
      expect(channel.postMessage).not.toHaveBeenCalled();
    });

    it("should ignore unrecognized message types", () => {
      broadcastBridgeService.start();
      const channel = mockBroadcastChannel.mock.results[0]!.value;
      channel.onmessage({ data: { type: "UNKNOWN" } });
      expect(channel.postMessage).not.toHaveBeenCalled();
    });

    it("should detect nonce replay (does not re-forward second message)", async () => {
      broadcastBridgeService.start();
      const channel = mockBroadcastChannel.mock.results[0]!.value;
      const msg = await signed({ url: "https://example.com" }, "replay-msg");

      await channel.onmessage({ data: msg });
      const firstCalls = channel.postMessage.mock.calls.length;

      await channel.onmessage({ data: msg });
      // El handler retorna silenciosamente sin postMessage en replay
      expect(channel.postMessage.mock.calls.length - firstCalls).toBe(0);
    });

    it("should handle SAVE_BOOKMARK successfully", async () => {
      broadcastBridgeService.start();
      const channel = mockBroadcastChannel.mock.results[0]!.value;

      const db = await mockInitDB();

      await channel.onmessage({
        data: await signed(
          {
            url: "https://example.com",
            title: "Test Bookmark",
            aiSummary: "AI Summary",
            keywords: ["tag1"],
            timestamp: new Date().toISOString(),
          },
          "msg-1",
        ),
      });

      expect(db.bookmarks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com/",
          title: "Test Bookmark",
          summary: "AI Summary",
          tags: ["tag1"],
        }),
      );

      expect(channel.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SAVE_BOOKMARK_RESULT",
          messageId: "msg-1",
          success: true,
        }),
      );
    });

    it("should handle error in SAVE_BOOKMARK", async () => {
      broadcastBridgeService.start();
      const channel = mockBroadcastChannel.mock.results[0]!.value;

      mockInitDB.mockRejectedValueOnce(new Error("DB connection failed"));

      await channel.onmessage({
        data: await signed({ url: "https://example.com" }, "msg-2"),
      });

      expect(channel.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SAVE_BOOKMARK_RESULT",
          messageId: "msg-2",
          success: false,
        }),
      );
    });

    it("should handle default values when fields are missing", async () => {
      broadcastBridgeService.start();
      const channel = mockBroadcastChannel.mock.results[0]!.value;
      const db = await mockInitDB();

      await channel.onmessage({
        data: await signed({}, "msg-3"),
      });

      expect(db.bookmarks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Untitled",
          url: "",
          summary: "",
          tags: [],
        }),
      );
    });

    it("should reject SAVE_BOOKMARK with invalid signature (no postMessage)", async () => {
      broadcastBridgeService.start();
      const channel = mockBroadcastChannel.mock.results[0]!.value;

      await channel.onmessage({
        data: {
          type: "SAVE_BOOKMARK",
          messageId: "bad-sig",
          data: { url: "https://evil.com" },
          signature: "invalid",
          nonce: "nonce-bad",
        },
      });

      // El handler retorna silenciosamente sin postMessage
      expect(channel.postMessage).not.toHaveBeenCalled();
    });

    it("should handle SYNC_SETTINGS successfully", async () => {
      broadcastBridgeService.start();
      const channel = mockBroadcastChannel.mock.results[0]!.value;

      const nonce = `sync-nonce-1`;
      const payload = { geminiKey: "test-key-123" };
      const signature = await signPayload(payload, nonce);

      await channel.onmessage({
        data: {
          type: "SYNC_SETTINGS",
          messageId: "sync-1",
          data: payload,
          signature,
          nonce,
        },
      });

      const { securityVault } = await import("../../services/SecurityVault");
      expect(securityVault.encryptSecret).toHaveBeenCalledWith(
        "test-key-123",
        "encrypted_api_key",
      );
    });

    it("should reject SYNC_SETTINGS with invalid signature", async () => {
      broadcastBridgeService.start();
      const channel = mockBroadcastChannel.mock.results[0]!.value;

      await channel.onmessage({
        data: {
          type: "SYNC_SETTINGS",
          messageId: "bad-sync",
          data: { geminiKey: "leaked" },
          signature: "bad",
          nonce: "bad-nonce",
        },
      });

      const { securityVault } = await import("../../services/SecurityVault");
      expect(securityVault.encryptSecret).not.toHaveBeenCalled();
    });
  });
});
