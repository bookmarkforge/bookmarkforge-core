import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { SyncService } from "../../services/SyncService";

// Mock RxDB WebRTC replication
vi.mock("rxdb/plugins/replication-webrtc", () => ({
  replicateWebRTC: vi.fn(),
  getConnectionHandlerSimplePeer: vi.fn(() => ({})),
}));

// Mock SecurityVault
vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    getSessionToken: vi.fn(),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/networkFirewall", () => ({
  validateIceServers: vi.fn(),
  checkNetworkRequest: vi.fn(),
  setFirewallDisabled: vi.fn(),
  firewalledWebSocket: vi.fn((url: string) =>
    Promise.resolve(new (globalThis as any).WebSocket(url)),
  ),
}));

import { replicateWebRTC, getConnectionHandlerSimplePeer } from "rxdb/plugins/replication-webrtc";
import { checkNetworkRequest } from "../../utils/networkFirewall";

const { logger } = await import("../../utils/logger");

describe("SyncService — S5 TURN relay (ADR-018)", () => {
  let service: SyncService;
  const mockCollection = { name: "bookmarks" };
  const dbMock = { collections: { bookmarks: mockCollection } } as any;
  const mockReplicationState = {
    error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
    peerStates$: null,
    cancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SyncService();
    (replicateWebRTC as any).mockResolvedValue(mockReplicationState);
  });

  afterEach(() => {
    service.stopAll();
    vi.unstubAllEnvs();
  });

  describe("buildIceServersFromEnv", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns default STUN when no TURN env vars are set", () => {
      const defaultStun = [
        { urls: "stun:stun.l.google.com:19302" },
      ];
      const result = (service as any).buildIceServersFromEnv(defaultStun);
      expect(result).toEqual(defaultStun);
    });

    it("returns TURN + STUN when all TURN env vars are set", () => {
      const testEnv = {
        VITE_TURN_URL: "turn:turn.example.com:3478",
        VITE_TURN_USERNAME: "user1",
        VITE_TURN_CREDENTIAL: "cred1",
      };

      const defaultStun = [{ urls: "stun:stun.l.google.com:19302" }];
      const result = (service as any).buildIceServersFromEnv(defaultStun, testEnv);

      expect(result).toEqual([
        {
          urls: "turn:turn.example.com:3478",
          username: "user1",
          credential: "cred1",
        },
        { urls: "stun:stun.l.google.com:19302" },
      ]);
    });

    it("returns STUN-only and warns when TURN_URL is set but credentials are missing", () => {
      const testEnv = {
        VITE_TURN_URL: "turn:turn.example.com:3478",
        // VITE_TURN_USERNAME and VITE_TURN_CREDENTIAL not set
      };

      const defaultStun = [{ urls: "stun:stun.l.google.com:19302" }];
      const result = (service as any).buildIceServersFromEnv(defaultStun, testEnv);

      expect(result).toEqual(defaultStun);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("VITE_TURN_URL set but"),
      );
    });

    it("returns STUN when env is an empty object", () => {
      const defaultStun = [{ urls: "stun:stun.l.google.com:19302" }];
      const result = (service as any).buildIceServersFromEnv(defaultStun, {});
      expect(result).toEqual(defaultStun);
    });

    it("returns STUN when VITE_TURN_URL is empty string", () => {
      const testEnv = { VITE_TURN_URL: "" };
      const defaultStun = [{ urls: "stun:stun.l.google.com:19302" }];
      const result = (service as any).buildIceServersFromEnv(defaultStun, testEnv);
      expect(result).toEqual(defaultStun);
    });

    it("returns STUN + warn when VITE_TURN_CREDENTIAL is empty string", () => {
      const testEnv = {
        VITE_TURN_URL: "turn:turn.example.com:3478",
        VITE_TURN_USERNAME: "user1",
        VITE_TURN_CREDENTIAL: "",
      };
      const defaultStun = [{ urls: "stun:stun.l.google.com:19302" }];
      const result = (service as any).buildIceServersFromEnv(defaultStun, testEnv);
      expect(result).toEqual(defaultStun);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("VITE_TURN_URL set but"),
      );
    });

    it("returns STUN + warn when VITE_TURN_USERNAME is empty string", () => {
      const testEnv = {
        VITE_TURN_URL: "turn:turn.example.com:3478",
        VITE_TURN_USERNAME: "",
        VITE_TURN_CREDENTIAL: "cred1",
      };
      const defaultStun = [{ urls: "stun:stun.l.google.com:19302" }];
      const result = (service as any).buildIceServersFromEnv(defaultStun, testEnv);
      expect(result).toEqual(defaultStun);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("VITE_TURN_URL set but"),
      );
    });

    it("logs a warning when static TURN env vars are used (audit #1)", () => {
      const testEnv = {
        VITE_TURN_URL: "turn:turn.example.com:3478",
        VITE_TURN_USERNAME: "user1",
        VITE_TURN_CREDENTIAL: "cred1",
      };
      const defaultStun = [{ urls: "stun:stun.l.google.com:19302" }];
      (service as any).buildIceServersFromEnv(defaultStun, testEnv);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Using STATIC TURN credentials"),
      );
    });
  });

  describe("TURN probe from signaling server", () => {
    // Probe tests use REAL timers so WebSocket mock's setTimeout fires.
    afterEach(() => {
      vi.useRealTimers();
    });

    it("uses TURN servers from signaling server when available", async () => {
      vi.stubGlobal("WebSocket", function MockWebSocket() {
        const ws = {
          close: vi.fn(),
          onmessage: null as any,
          onerror: null as any,
        };
        setTimeout(() => {
          if (ws.onmessage) {
            ws.onmessage({
              data: JSON.stringify({
                type: "init",
                yourPeerId: "abc",
                iceServers: [
                  {
                    urls: "turn:my-turn.example.com:3478",
                    username: "forge",
                    credential: "secret123",
                  },
                ],
              }),
            });
          }
        }, 10);
        return ws;
      } as any);

      await service.startP2PSync(dbMock, "test-room");

      expect(logger.info).toHaveBeenCalledWith(
        "[SyncService] Using TURN servers from signaling server",
        expect.objectContaining({ turnCount: 1 }),
      );

      // The config is passed to getConnectionHandlerSimplePeer, not returned by it.
      expect(getConnectionHandlerSimplePeer).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            iceServers: expect.arrayContaining([
              expect.objectContaining({
                urls: "turn:my-turn.example.com:3478",
                username: "forge",
              }),
            ]),
          }),
        }),
      );
    }, 15000);

    it("falls back to env vars when signaling probe returns no TURN", async () => {
      vi.stubGlobal("WebSocket", function MockWebSocket() {
        const ws = {
          close: vi.fn(),
          onmessage: null as any,
          onerror: null as any,
        };
        setTimeout(() => {
          if (ws.onmessage) {
            ws.onmessage({
              data: JSON.stringify({
                type: "init",
                yourPeerId: "abc",
              }),
            });
          }
        }, 10);
        return ws;
      } as any);

      const spy = vi.spyOn(service as any, "buildIceServersFromEnv")
        .mockImplementation(() => {
          return [
            { urls: "turn:env-turn.example.com:3478", username: "env-user", credential: "env-cred" },
            { urls: "stun:stun.l.google.com:19302" },
          ];
        });

      await service.startP2PSync(dbMock, "test-room");

      expect(getConnectionHandlerSimplePeer).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            iceServers: expect.arrayContaining([
              expect.objectContaining({
                urls: "turn:env-turn.example.com:3478",
                username: "env-user",
              }),
            ]),
          }),
        }),
      );

      spy.mockRestore();
    }, 15000);

    it("falls back to STUN-only when both probe and env vars fail", async () => {
      vi.stubGlobal("WebSocket", function MockWebSocket() {
        const ws = {
          close: vi.fn(),
          onmessage: null as any,
          onerror: null as any,
        };
        setTimeout(() => {
          if (ws.onerror) {
            ws.onerror(new Error("connection failed"));
          }
        }, 10);
        return ws;
      } as any);

      const spy = vi.spyOn(service as any, "buildIceServersFromEnv")
        .mockImplementation((stun: any) => stun);

      await service.startP2PSync(dbMock, "test-room");

      expect(getConnectionHandlerSimplePeer).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            iceServers: expect.arrayContaining([
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" },
            ]),
          }),
        }),
      );

      spy.mockRestore();
    }, 15000);

    it("validates probe URL through firewall before connecting", async () => {
      vi.stubGlobal("WebSocket", function MockWebSocket() {
        return {
          close: vi.fn(),
          onmessage: null,
          onerror: null,
        };
      } as any);

      await service.startP2PSync(dbMock, "test-room");

      // checkNetworkRequest should be called for each signaling server
      // plus the TURN probe uses the same URL which was already validated
      expect(checkNetworkRequest).toHaveBeenCalled();
    }, 15000);

    it("falls back gracefully when firewall blocks the probe", async () => {
      // checkNetworkRequest succeeds for signaling servers loop
      // then fails for the TURN probe (4th call)
      let callCount = 0;
      vi.mocked(checkNetworkRequest).mockImplementation(async () => {
        callCount++;
        if (callCount >= 3) throw new Error("firewall blocked");
      });

      const spy = vi.spyOn(service as any, "buildIceServersFromEnv")
        .mockImplementation((stun: any) => stun);

      vi.stubGlobal("WebSocket", function MockWebSocket() {
        return { close: vi.fn(), onmessage: null, onerror: null };
      } as any);

      await service.startP2PSync(dbMock, "test-room");

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to probe signaling server for ICE"),
        expect.any(Object),
      );

      expect(replicateWebRTC).toHaveBeenCalled();

      spy.mockRestore();
      // Reset checkNetworkRequest to prevent cross-test contamination
      // (vi.clearAllMocks() does NOT reset mockImplementations)
      vi.mocked(checkNetworkRequest).mockReset();
      vi.mocked(checkNetworkRequest).mockResolvedValue(undefined);
    }, 15000);

    it("falls back to STUN when signaling probe times out", async () => {
      vi.useFakeTimers();

      // WebSocket never calls onmessage or onerror — timeout must fire
      vi.stubGlobal("WebSocket", function MockWebSocket() {
        return { close: vi.fn(), onmessage: null, onerror: null };
      } as any);

      const spy = vi.spyOn(service as any, "buildIceServersFromEnv")
        .mockImplementation((stun: any) => stun);

      // Start sync (will hang on fetchIceServersFromSignaling's setTimeout)
      const syncPromise = service.startP2PSync(dbMock, "test-room");

      // Advance past the 3000ms probe timeout
      await vi.advanceTimersByTimeAsync(3001);
      await syncPromise;

      expect(getConnectionHandlerSimplePeer).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            iceServers: expect.arrayContaining([
              { urls: "stun:stun.l.google.com:19302" },
            ]),
          }),
        }),
      );

      spy.mockRestore();
      vi.useRealTimers();
    }, 15000);

    it("falls back to STUN when signaling server returns invalid JSON", async () => {
      vi.stubGlobal("WebSocket", function MockWebSocket() {
        const ws = {
          close: vi.fn(),
          onmessage: null as any,
          onerror: null as any,
        };
        setTimeout(() => {
          if (ws.onmessage) {
            ws.onmessage({ data: "{invalid json!!!}" });
          }
        }, 10);
        return ws;
      } as any);

      const spy = vi.spyOn(service as any, "buildIceServersFromEnv")
        .mockImplementation((stun: any) => stun);

      await service.startP2PSync(dbMock, "test-room");

      expect(getConnectionHandlerSimplePeer).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            iceServers: expect.arrayContaining([
              { urls: "stun:stun.l.google.com:19302" },
            ]),
          }),
        }),
      );

      spy.mockRestore();
    }, 15000);

    it("falls back to STUN when WebSocket constructor throws", async () => {
      vi.stubGlobal(
        "WebSocket",
        vi.fn(function MockWebSocket() {
          throw new Error("WebSocket not available");
        }) as any,
      );

      const spy = vi.spyOn(service as any, "buildIceServersFromEnv")
        .mockImplementation((stun: any) => stun);

      await service.startP2PSync(dbMock, "test-room");

      expect(getConnectionHandlerSimplePeer).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            iceServers: expect.arrayContaining([
              { urls: "stun:stun.l.google.com:19302" },
            ]),
          }),
        }),
      );

      spy.mockRestore();
    }, 15000);

    it("falls back to STUN when event.data is not a string", async () => {
      vi.stubGlobal("WebSocket", function MockWebSocket() {
        const ws = {
          close: vi.fn(),
          onmessage: null as any,
          onerror: null as any,
        };
        setTimeout(() => {
          if (ws.onmessage) {
            // Non-string event.data causes JSON.parse("{}") → {} → type !== "init"
            ws.onmessage({ data: { type: "init", iceServers: [] } });
          }
        }, 10);
        return ws;
      } as any);

      const spy = vi.spyOn(service as any, "buildIceServersFromEnv")
        .mockImplementation((stun: any) => stun);

      await service.startP2PSync(dbMock, "test-room");

      expect(getConnectionHandlerSimplePeer).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            iceServers: expect.arrayContaining([
              { urls: "stun:stun.l.google.com:19302" },
            ]),
          }),
        }),
      );

      spy.mockRestore();
    }, 15000);
  });
});
