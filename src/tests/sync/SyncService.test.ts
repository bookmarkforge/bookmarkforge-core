import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { SyncService, deriveSyncTopic } from "../../services/SyncService";
import { securityVault } from "../../services/SecurityVault";
import { SYNC_CONFIG } from "../../constants/config";

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
}));

vi.mock("../../utils/env", () => ({
  getEnvVar: vi.fn(),
}));

import {
  replicateWebRTC,
  getConnectionHandlerSimplePeer,
} from "rxdb/plugins/replication-webrtc";

const { logger } = await import("../../utils/logger");
const { validateIceServers, checkNetworkRequest } = await import(
  "../../utils/networkFirewall"
);
const { getEnvVar } = await import("../../utils/env");

describe("SyncService", () => {
  let service: SyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    service = new SyncService();
    // jsdom 30 implements WebSocket and would try a REAL connection to
    // wss://signaling.rxdb.info/ inside fetchIceServersFromSignaling. That
    // connection hangs in CI/sandbox, and because fake timers are active the
    // function's own 3s fallback setTimeout never fires — so startP2PSync
    // (and every restartSync/startP2PSync test) would time out at 60s.
    // Stub the constructor to throw: fetchIceServersFromSignaling catches
    // that and resolves to [] immediately, matching pre-jsdom-30 behavior.
    // The "coverage gaps" describe overrides this with its own mock to
    // exercise makeSignalingSocket.
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          throw new Error("WebSocket disabled in SyncService unit tests");
        }
      } as unknown as typeof WebSocket,
    );
  });

  afterEach(() => {
    service.stopAll();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("initialization", () => {
    it("should create service with correct initial state", () => {
      expect(service.isSyncing).toBe(false);
      expect(service.currentRoomId).toBeNull();
      expect(service.connectedPeers).toBe(0);
      expect(service.lastSyncTime).toBeNull();
      expect(service.syncHealth).toBe("connecting");
    });

    it("should notify listeners on state change", () => {
      const listener = vi.fn();
      service.onSyncStateChange = listener;
      service.isSyncing = true;
      service["notify"]();
      expect(listener).toHaveBeenCalledWith(true, null, 0, "connecting", null);
    });

    it("should not throw when notify has no listener", () => {
      service.onSyncStateChange = null;
      service.isSyncing = true;
      expect(() => service["notify"]()).not.toThrow();
    });
  });

  describe("restartSync", () => {
    it("should stop and restart with current room id", async () => {
      const stopSpy = vi.spyOn(service, "stopAll");
      service.currentRoomId = "room-1";

      const dbMock = { collections: { bookmarks: { name: "bookmarks" } } } as any;
      (replicateWebRTC as any).mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
        peerStates$: null,
        cancel: vi.fn(),
      });

      await service.restartSync(dbMock);
      expect(stopSpy).toHaveBeenCalled();
      expect(replicateWebRTC).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "[SyncService] Restarting sync process",
      );
    });

    it("should generate room id when none set", async () => {
      vi.mocked(securityVault.getSessionToken).mockReturnValue("tok");
      if (typeof crypto !== "undefined" && crypto.subtle) {
        vi.spyOn(crypto.subtle, "digest").mockResolvedValue(
          new ArrayBuffer(32),
        );
      }

      const dbMock = { collections: { bookmarks: { name: "bookmarks" } } } as any;
      (replicateWebRTC as any).mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
        peerStates$: null,
        cancel: vi.fn(),
      });

      await service.restartSync(dbMock);
      expect(replicateWebRTC).toHaveBeenCalled();
    });
  });

  describe("startP2PSync", () => {
    const mockCollection = { name: "bookmarks" };
    const dbMock = { collections: { bookmarks: mockCollection } } as any;
    const mockReplicationState = {
      error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
      peerStates$: null,
      cancel: vi.fn(),
    };

    beforeEach(() => {
      (replicateWebRTC as any).mockResolvedValue(mockReplicationState);
    });

    it("should start sync with given room id", async () => {
      await service.startP2PSync(dbMock, "test-room");
      expect(service.isSyncing).toBe(true);
      expect(service.currentRoomId).toBe("test-room");
      expect(replicateWebRTC).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "[SyncService] Starting P2P Zero-Knowledge sync",
        { roomId: "test-room" },
      );
    });

    it("should return early if already syncing with same room and healthy", async () => {
      await service.startP2PSync(dbMock, "test-room");
      (replicateWebRTC as any).mockClear();
      await service.startP2PSync(dbMock, "test-room");
      expect(replicateWebRTC).not.toHaveBeenCalled();
    });

    it("should force restart if syncing with different room", async () => {
      const stopSpy = vi.spyOn(service, "stopAll");
      await service.startP2PSync(dbMock, "room-1");
      (replicateWebRTC as any).mockClear();
      stopSpy.mockClear();
      await service.startP2PSync(dbMock, "room-2");
      expect(stopSpy).toHaveBeenCalled();
      expect(replicateWebRTC).toHaveBeenCalled();
    });

    it("should handle replication error and schedule reconnect", async () => {
      const errorSub = {
        subscribe: vi.fn((cb) => {
          cb(new Error("conn failed"));
          return { unsubscribe: vi.fn() };
        }),
      };
      (replicateWebRTC as any).mockResolvedValue({
        error$: errorSub,
        peerStates$: null,
        cancel: vi.fn(),
      });
      const reconnectSpy = vi
        .spyOn(service as any, "scheduleReconnect")
        .mockImplementation(() => {});

      await service.startP2PSync(dbMock, "test-room");
      expect(errorSub.subscribe).toHaveBeenCalled();
      expect(reconnectSpy).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        "[SyncService] Replication error",
        expect.objectContaining({
          collection: "bookmarks",
          error: expect.any(Error),
        }),
      );
    });

    it("should subscribe to peerStates$ when available", async () => {
      const peerSub = { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) };
      (replicateWebRTC as any).mockResolvedValue({
        ...mockReplicationState,
        peerStates$: peerSub,
      });

      await service.startP2PSync(dbMock, "test-room");
      expect(peerSub.subscribe).toHaveBeenCalled();
    });

    it("should update health and notify on peer state change with peers", async () => {
      const notifySpy = vi
        .spyOn(service as any, "notify")
        .mockImplementation(() => {});
      let peerCallback: (peers: Map<string, unknown>) => void;
      const peerSub = {
        subscribe: vi.fn((cb) => {
          peerCallback = cb;
          return { unsubscribe: vi.fn() };
        }),
      };
      (replicateWebRTC as any).mockResolvedValue({
        ...mockReplicationState,
        peerStates$: peerSub,
      });

      await service.startP2PSync(dbMock, "test-room");
      peerCallback!(new Map([["peer1", {}]]));
      expect(service.syncHealth).toBe("healthy");
      expect(service.connectedPeers).toBe(1);
      expect(notifySpy).toHaveBeenCalled();
    });

    it("should set connecting when peers drop to zero while syncing", async () => {
      let peerCallback: (peers: Map<string, unknown>) => void;
      const peerSub = {
        subscribe: vi.fn((cb) => {
          peerCallback = cb;
          return { unsubscribe: vi.fn() };
        }),
      };
      (replicateWebRTC as any).mockResolvedValue({
        ...mockReplicationState,
        peerStates$: peerSub,
      });

      await service.startP2PSync(dbMock, "test-room");
      service.syncHealth = "healthy";
      peerCallback!(new Map());
      expect(service.syncHealth).toBe("connecting");
    });

    it("should handle replication start error gracefully", async () => {        (replicateWebRTC as any).mockRejectedValue(new Error("start failed"));
      await service.startP2PSync(dbMock, "test-room");
      expect(service.syncHealth).toBe("error");
      expect(logger.error).toHaveBeenCalledWith(
        "[SyncService] Failed to start replication",
        expect.objectContaining({
          collection: "bookmarks",
          error: expect.any(Error),
        }),
      );
    });

    it("H-03: does NOT abort when only one signaling server is blocked", async () => {
      // Only the FIRST server fails the firewall; the fallback servers pass.
      // Sync must continue (no rejection) so a blocked custom URL never
      // kills the public rxdb.info/pubnub fallback (audit H-03).
      vi.mocked(checkNetworkRequest).mockRejectedValueOnce("blocked");
      await service.startP2PSync(dbMock, "room");
      expect(service.syncHealth).not.toBe("error");
      expect(replicateWebRTC).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        "[SyncService] Signaling server blocked by firewall",
        expect.objectContaining({
          server: expect.any(String),
          error: "blocked",
        }),
      );
    });

    it("A-2: replicates under the keyed HMAC topic, never the readable room id", async () => {
      const roomSecret = "a".repeat(64);
      (replicateWebRTC as any).mockClear();
      await service.startP2PSync(dbMock, "room-A2", roomSecret);

      const options = (replicateWebRTC as any).mock.calls[0]?.[0] as {
        topic?: string;
      };
      const expected = await deriveSyncTopic(roomSecret, "room-A2", "bookmarks");
      expect(options.topic).toBe(expected);
      // The signaling server (or a public relay) must never see the room id.
      expect(options.topic).toMatch(/^[0-9a-f]{64}$/);
      expect(options.topic).not.toContain("room-A2");
    });

    it("should filter out chunks collection", async () => {
      const dbWithChunks = {
        collections: { bookmarks: { name: "bookmarks" }, chunks: { name: "chunks" } },
      } as any;
      (replicateWebRTC as any).mockClear();
      await service.startP2PSync(dbWithChunks, "room");
      // chunks should be filtered out, so only 1 collection replicated
      expect(replicateWebRTC).toHaveBeenCalledTimes(1);
    });

    it("P0 canary: syncs only the reviewed allowlist and excludes future sensitive collections", async () => {
      const dbAll = {
        collections: {
          bookmarks: { name: "bookmarks" },
          documents: { name: "documents" },
          messages: { name: "messages" },
          memory: { name: "memory" },
          highlights: { name: "highlights" },
          insights: { name: "insights" },
          chunks: { name: "chunks" },
          futureCollection: { name: "futureCollection" },
        },
      } as any;
      (replicateWebRTC as any).mockClear();
      await service.startP2PSync(dbAll, "room");

      const syncedNames = (replicateWebRTC as any).mock.calls
        .map((c: unknown[]) => (c[0] as { collection?: { name?: string } })?.collection?.name)
        .filter((n: string | undefined) => n !== undefined);

      expect([...syncedNames].sort()).toEqual(["bookmarks", "documents"]);
    });

    it("P0 refuses to start when an allowlisted collection contains private data", async () => {
      const privateBookmarks = {
        name: "bookmarks",
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([{ id: "private-1", isPrivate: true }]),
        })),
      };

      await expect(
        service.startP2PSync(
          { collections: { bookmarks: privateBookmarks } } as any,
          "room",
        ),
      ).rejects.toThrow("bookmarks contains private data");
      expect(replicateWebRTC).not.toHaveBeenCalled();
    });

    it("configures bounded RxDB pull/push modifiers and rechecks the privacy boundary per peer", async () => {
      let hasPrivateRecord = false;
      const guardedBookmarks = {
        name: "bookmarks",
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue(
            hasPrivateRecord ? [{ id: "private-1", isPrivate: true }] : [],
          ),
        })),
      };

      await service.startP2PSync(
        { collections: { bookmarks: guardedBookmarks } } as any,
        "room",
      );

      const options = (replicateWebRTC as any).mock.calls[0]?.[0];
      expect(options.pull.batchSize).toBe(100);
      expect(options.push.batchSize).toBe(100);
      expect(options.pull.modifier({ id: "public", isPrivate: false })).toEqual({
        id: "public",
        isPrivate: false,
      });
      expect(() => options.pull.modifier({ id: "private", isPrivate: true })).toThrow(
        "Private document rejected by replication boundary",
      );
      expect(() => options.push.modifier({ id: "private", isPrivate: true })).toThrow(
        "Private document rejected by replication boundary",
      );

      await expect(options.isPeerValid({})).resolves.toBe(true);
      hasPrivateRecord = true;
      await expect(options.isPeerValid({})).resolves.toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        "[SyncService] Peer rejected: private data boundary",
        expect.any(Object),
      );
    });
  });

  describe("simulatePartition", () => {
    it("should set error health and schedule reconnect", async () => {
      const scheduleSpy = vi
        .spyOn(service as any, "scheduleReconnect")
        .mockImplementation(() => {});
      const cancelMock = vi.fn();
      (service as any).replications.set("test", { cancel: cancelMock });

      await service.simulatePartition({} as any);
      expect(service.syncHealth).toBe("error");
      expect(service.connectedPeers).toBe(0);
      expect(cancelMock).toHaveBeenCalled();
      expect(scheduleSpy).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "[SyncService] !!! SIMULATING NETWORK PARTITION !!!",
      );
    });
  });

  describe("firewall validation", () => {
    it("should validate ICE servers before replication starts", async () => {
      await service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      expect(validateIceServers).toHaveBeenCalled();
    });

    it("should check all signaling servers through firewall", async () => {
      await service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      expect(checkNetworkRequest).toHaveBeenCalled();
    });

    it("H-03: fails hard only when EVERY signaling server is blocked", async () => {
      // All servers reject the firewall check → syncHealth error and the
      // sync promise rejects (no fallback left).
      vi.mocked(checkNetworkRequest).mockRejectedValue(
        new Error("blocked"),
      );
      try {
        await expect(
          service.startP2PSync(
            { collections: { bookmarks: { name: "bookmarks" } } } as any,
            "room",
          ),
        ).rejects.toThrow(
          "[SyncService] All signaling servers blocked by network firewall",
        );
        expect(service.syncHealth).toBe("error");
        expect(replicateWebRTC).not.toHaveBeenCalled();
      } finally {
        // Restore the default resolving mock — clearAllMocks() only clears
        // call history, not implementations, so without this every later
        // test in the file would inherit mockRejectedValue.
        vi.mocked(checkNetworkRequest).mockReset();
      }
    });
  });

  describe("signaling server fallback", () => {
    it("should try multiple signaling servers when first fails", async () => {
      const firstFail = vi.fn().mockRejectedValueOnce(new Error("fail"));
      // Cast to `any` because production SyncService narrows the value to
      // RxJS Observable + BehaviorSubject shapes; the test stub uses plain
      // mocks instead. Runtime is exercised separately by vitest, which
      // accepts the structural stub.
      const secondOk = vi.fn().mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
        peerStates$: null as any,
        cancel: vi.fn(),
      } as any);
      (replicateWebRTC as any)
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce({
          error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
          peerStates$: null,
          cancel: vi.fn(),
        } as any);

      await service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      expect(replicateWebRTC).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Signaling server"),
        expect.any(Object),
      );
    });

    it("should fail gracefully when all signaling servers are unreachable", async () => {
      (replicateWebRTC as any).mockRejectedValue(
        new Error("all servers down"),
      );
      await service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      expect(service.syncHealth).toBe("error");
      expect(logger.error).toHaveBeenCalledWith(
        "[SyncService] Failed to start replication",
        expect.any(Object),
      );
    });
  });

  // makeSignalingSocket is a closure inside startP2PSync, tested indirectly
  // through firewall and edge-cases tests above.

  describe("edge cases", () => {
    it("should restartSync return undefined when no roomId available", async () => {
      vi.spyOn(service as any, "generateRoomId").mockResolvedValue(null);
      const result = await service.restartSync({} as any);
      expect(result).toBeUndefined();
    });

    it("should not start sync when both room ids are null", async () => {
      service.currentRoomId = null;
      vi.spyOn(service as any, "generateRoomId").mockResolvedValue(null);
      const startSpy = vi.spyOn(service, "startP2PSync");
      await service.restartSync({} as any);
      expect(startSpy).not.toHaveBeenCalled();
    });

    it("should stopAll safely with empty replications map", () => {
      (service as any).replications = new Map();
      expect(() => service.stopAll()).not.toThrow();
    });

    it("should startP2PSync with no collections", async () => {
      await service.startP2PSync(
        { collections: {} } as any,
        "room",
      );
      expect(service.isSyncing).toBe(true);
      expect(replicateWebRTC).not.toHaveBeenCalled();
    });

    it("should generate roomSecret per sync session", async () => {
      vi.mocked(replicateWebRTC).mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } as any,
        peerStates$: null as any,
        cancel: vi.fn(),
      } as any);
      await service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      expect((service as any).roomSecret).toBeTruthy();
      expect(typeof (service as any).roomSecret).toBe("string");
      expect((service as any).roomSecret.length).toBe(64);
    });

    it("should handle null generateRoomId in generateRoomId gracefully", async () => {
      vi.mocked(securityVault.getSessionToken).mockReturnValue(null);
      const id = await service.generateRoomId();
      expect(id).not.toBeNull();
      expect(id?.length).toBe(32);
    });
  });

  describe("coverage gaps", () => {
    let capturedWsConstructor: ((url: string) => WebSocket) | undefined;
    let wsSendSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      wsSendSpy = vi.fn();
      class MockWebSocket {
        close = vi.fn();
        send = wsSendSpy;
      }
      global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

      vi.mocked(getConnectionHandlerSimplePeer).mockImplementation(
        (args: any): any => {
          capturedWsConstructor = args.webSocketConstructor;
          return {} as any;
        },
      );
    });

    afterEach(() => {
      capturedWsConstructor = undefined;
      vi.mocked(getConnectionHandlerSimplePeer).mockReturnValue({} as any);
    });

    it("injects roomSecret into join messages via makeSignalingSocket for the self-hosted server", async () => {
      // A-3: the secret travels only to the configured self-hosted server, so
      // the deployment below is part of the contract this test pins.
      vi.mocked(getEnvVar).mockImplementation((name: string): any =>
        name === "VITE_P2P_SIGNALING_URL"
          ? "wss://signaling.example.com"
          : undefined,
      );
      vi.mocked(replicateWebRTC).mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } as any,
        peerStates$: null as any,
        cancel: vi.fn(),
      } as any);

      const syncPromise = service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      await vi.advanceTimersByTimeAsync(3001);
      await syncPromise;

      expect(capturedWsConstructor).toBeDefined();
      const roomSecret = (service as any).roomSecret;
      expect(roomSecret).toBeTruthy();

      const ws = capturedWsConstructor!("wss://signaling.example.com");
      ws.send(JSON.stringify({ type: "join", room: "room-1" }));

      expect(wsSendSpy).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(wsSendSpy.mock.calls[0]![0]);
      expect(sent).toMatchObject({
        type: "join",
        room: "room-1",
        roomSecret,
      });
    });

    it("A-3: never sends roomSecret to the public relays (no self-hosted server configured)", async () => {
      // Public-relay mode: the app must keep working over rxdb.info/PubNub
      // without handing those third parties the room capability.
      vi.mocked(getEnvVar).mockReturnValue(undefined);
      vi.mocked(replicateWebRTC).mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } as any,
        peerStates$: null as any,
        cancel: vi.fn(),
      } as any);

      const syncPromise = service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      await vi.advanceTimersByTimeAsync(3001);
      await syncPromise;

      const roomSecret = (service as any).roomSecret;
      expect(roomSecret).toBeTruthy();

      const ws = capturedWsConstructor!("wss://signaling.rxdb.info/");
      ws.send(JSON.stringify({ type: "join", room: "room-1" }));

      expect(wsSendSpy).toHaveBeenCalledTimes(1);
      const frame = wsSendSpy.mock.calls[0]![0] as string;
      expect(JSON.parse(frame)).toEqual({ type: "join", room: "room-1" });
      expect(frame).not.toContain(roomSecret);
    });

    it("A-3: withholds roomSecret when a self-hosted server is configured but the socket is not on it", async () => {
      // Defense in depth: the decision is re-derived per socket from the URL,
      // so even a wrong URL cannot leak the secret to a relay.
      vi.mocked(getEnvVar).mockImplementation((name: string): any =>
        name === "VITE_P2P_SIGNALING_URL"
          ? "wss://signaling.example.com"
          : undefined,
      );
      vi.mocked(replicateWebRTC).mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } as any,
        peerStates$: null as any,
        cancel: vi.fn(),
      } as any);

      const syncPromise = service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      await vi.advanceTimersByTimeAsync(3001);
      await syncPromise;

      const ws = capturedWsConstructor!("wss://signaling.rxdb.info/");
      ws.send(JSON.stringify({ type: "join", room: "room-1" }));

      expect(JSON.parse(wsSendSpy.mock.calls[0]![0])).toEqual({
        type: "join",
        room: "room-1",
      });
    });

    it("makeSignalingSocket rejects ws:// for remote hosts and allows wss:// and local ws:// (audit #2)", async () => {
      vi.mocked(replicateWebRTC).mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } as any,
        peerStates$: null as any,
        cancel: vi.fn(),
      } as any);

      const syncPromise = service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      await vi.advanceTimersByTimeAsync(3001);
      await syncPromise;

      const ws = capturedWsConstructor!;
      // wss:// remoto → permitido
      expect(() => ws("wss://signaling.example.com")).not.toThrow();
      // ws:// local (dev) → permitido
      expect(() => ws("ws://localhost:3000")).not.toThrow();
      // ws:// remoto → BLOQUEADO (transporte inseguro)
      expect(() => ws("ws://remote.example.com")).toThrow(/wss:\/\//);
    });

    it("should pass non-join messages through makeSignalingSocket unchanged", async () => {
      vi.mocked(replicateWebRTC).mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } as any,
        peerStates$: null as any,
        cancel: vi.fn(),
      } as any);

      const syncPromise = service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      await vi.advanceTimersByTimeAsync(3001);
      await syncPromise;

      const ws = capturedWsConstructor!("wss://signaling.example.com");
      const raw = JSON.stringify({ type: "ping", ts: 123 });
      ws.send(raw);

      expect(wsSendSpy).toHaveBeenCalledWith(raw);
    });

    it("should fall back to raw send when makeSignalingSocket receives invalid JSON", async () => {
      vi.mocked(replicateWebRTC).mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } as any,
        peerStates$: null as any,
        cancel: vi.fn(),
      } as any);

      const syncPromise = service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      await vi.advanceTimersByTimeAsync(3001);
      await syncPromise;

      const ws = capturedWsConstructor!("wss://signaling.example.com");
      const raw = "{invalid json]]";
      ws.send(raw);

      expect(wsSendSpy).toHaveBeenCalledWith(raw);
    });

    it("should prefer custom VITE_P2P_SIGNALING_URL when set", async () => {
      vi.mocked(getEnvVar).mockImplementation((name: string): any => {
        if (name === "VITE_P2P_SIGNALING_URL") {
          return "wss://custom.example.com";
        }
        return undefined;
      });

      vi.mocked(replicateWebRTC).mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } as any,
        peerStates$: null as any,
        cancel: vi.fn(),
      } as any);

      const syncPromise = service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      await vi.advanceTimersByTimeAsync(3001);
      await syncPromise;

      expect(getConnectionHandlerSimplePeer).toHaveBeenCalledWith(
        expect.objectContaining({
          signalingServerUrl: "wss://custom.example.com",
        }),
      );
    });

    it("uses ONLY the self-hosted signaling server when configured (no public fallback)", async () => {
      // A deployment that configured private signaling (VITE_P2P_SIGNALING_URL)
      // must never downgrade a secret room to the public rxdb.info/PubNub
      // relays, which ignore roomSecret. Only the custom URL may be used.
      vi.mocked(getEnvVar).mockImplementation((name: string): any => {
        if (name === "VITE_P2P_SIGNALING_URL") {
          return "wss://custom.example.com";
        }
        return undefined;
      });

      vi.mocked(replicateWebRTC).mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } as any,
        peerStates$: null as any,
        cancel: vi.fn(),
      } as any);

      const syncPromise = service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      await vi.advanceTimersByTimeAsync(3001);
      await syncPromise;

      // Every replication attempt must use the custom URL and nothing else.
      const calls = (getConnectionHandlerSimplePeer as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call[0].signalingServerUrl).toBe("wss://custom.example.com");
      }
      expect(checkNetworkRequest).toHaveBeenCalledWith(
        "wss://custom.example.com",
        "P2P_Signaling",
      );
      expect(checkNetworkRequest).not.toHaveBeenCalledWith(
        expect.stringContaining("rxdb.info"),
        "P2P_Signaling",
      );
    });

    it("fails closed when the configured signaling server is blocked by the firewall", async () => {
      vi.mocked(getEnvVar).mockImplementation((name: string): any => {
        if (name === "VITE_P2P_SIGNALING_URL") {
          return "wss://custom.example.com";
        }
        return undefined;
      });
      vi.mocked(checkNetworkRequest).mockRejectedValueOnce("blocked");
      vi.mocked(replicateWebRTC).mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } as any,
        peerStates$: null as any,
        cancel: vi.fn(),
      } as any);

      await expect(
        service.startP2PSync(
          { collections: { bookmarks: { name: "bookmarks" } } } as any,
          "room",
        ),
      ).rejects.toThrow("All signaling servers blocked by network firewall");
      expect(service.syncHealth).toBe("error");
      // No fallback: replication must never start on a public relay.
      expect(replicateWebRTC).not.toHaveBeenCalled();
    });

    it("should not simulate partition in production", async () => {
      vi.stubEnv("PROD", "true" as any);
      const cancelMock = vi.fn();
      (service as any).replications.set("test", { cancel: cancelMock });

      await service.simulatePartition({} as any);

      expect(cancelMock).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "[SyncService] simulatePartition is not available in production",
      );
    });

    it("should handle undefined replication state", async () => {
      vi.mocked(replicateWebRTC).mockResolvedValue(undefined as any);

      const syncPromise = service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      await vi.advanceTimersByTimeAsync(3001);
      await syncPromise;

      expect(service.syncHealth).toBe("error");
      expect(logger.error).toHaveBeenCalledWith(
        "[SyncService] Failed to start replication",
        expect.objectContaining({
          collection: "bookmarks",
          error: expect.any(Error),
        }),
      );
    });

    it("should not set connecting health when not syncing on peerStates update", async () => {
      let peerCallback: (peers: Map<string, unknown>) => void;
      const peerSub = {
        subscribe: vi.fn((cb) => {
          peerCallback = cb;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(replicateWebRTC).mockResolvedValue({
        error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) } as any,
        peerStates$: peerSub,
        cancel: vi.fn(),
      } as any);

      const syncPromise = service.startP2PSync(
        { collections: { bookmarks: { name: "bookmarks" } } } as any,
        "room",
      );
      await vi.advanceTimersByTimeAsync(3001);
      await syncPromise;

      service.syncHealth = "healthy";
      service.isSyncing = false;
      peerCallback!(new Map());

      expect(service.syncHealth).toBe("healthy");
    });
  });

  describe("stale-session concurrency guards (replicateWebRTC)", () => {
    const dbMock = {
      collections: { bookmarks: { name: "bookmarks" } },
    } as any;
    const mockReplicationState = {
      error$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
      peerStates$: null,
      cancel: vi.fn(),
    };

    it("different-room startP2PSync during an in-flight startup supersedes it instead of returning its promise", async () => {
      const resolvers: Array<(value: unknown) => void> = [];
      vi.mocked(replicateWebRTC).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvers.push(resolve);
          }),
      );

      const first = service.startP2PSync(dbMock, "room-A");
      const second = service.startP2PSync(dbMock, "room-B");

      // The old behaviour returned room-A's promise, so room-B never started.
      expect(second).not.toBe(first);

      // Let room-B's startup reach the pending replicateWebRTC call. The
      // startup awaits an HMAC (crypto.subtle) to derive the keyed room name
      // (A-2) before replicating, so a fixed number of plain microtask yields
      // is not enough — pump microtasks and let fake timers flush real async
      // work until the pending call appears.
      for (let i = 0; i < 100 && resolvers.length === 0; i++) {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(resolvers.length).toBe(1);
      resolvers[0]!(mockReplicationState);

      await second;
      await first;
      expect(service.currentRoomId).toBe("room-B");
      expect(service.isSyncing).toBe(true);
    });

    it("stale peerStates$ emission after simulatePartition does not resurrect healthy on the superseded session", async () => {
      let peerCallback: (peers: Map<string, unknown>) => void;
      const peerSub = {
        subscribe: vi.fn((cb: (peers: Map<string, unknown>) => void) => {
          peerCallback = cb;
          return { unsubscribe: vi.fn() };
        }),
      };
      vi.mocked(replicateWebRTC).mockResolvedValue({
        ...mockReplicationState,
        peerStates$: peerSub,
      } as any);

      await service.startP2PSync(dbMock, "room");
      service.syncHealth = "healthy";
      service.connectedPeers = 2;
      // simulatePartition bumps the session generation but does NOT
      // unsubscribe the live replication callbacks — it only cancels the
      // replications and clears the map.
      await service.simulatePartition(dbMock);

      peerCallback!(new Map([["peer1", {}]]));
      expect(service.syncHealth).toBe("error");
      expect(service.connectedPeers).toBe(0);
    });

    it("stale error$ emission after a generation bump does not arm reconnect or poison health", async () => {
      let errorCallback: (err: unknown) => void;
      const errorSub = {
        subscribe: vi.fn((cb: (err: unknown) => void) => {
          errorCallback = cb;
          return { unsubscribe: vi.fn() };
        }),
      };
      vi.mocked(replicateWebRTC).mockResolvedValue({
        ...mockReplicationState,
        error$: errorSub,
      } as any);
      const reconnectSpy = vi
        .spyOn(service as any, "scheduleReconnect")
        .mockImplementation(() => {});

      await service.startP2PSync(dbMock, "room");
      (service as any).sessionGeneration++;
      service.syncHealth = "healthy";

      errorCallback!(new Error("stale channel failure"));
      expect(reconnectSpy).not.toHaveBeenCalled();
      expect(service.syncHealth).toBe("healthy");
    });

    it("reconnect timer skips restart when the session recovered on its own", async () => {
      const restartSpy = vi
        .spyOn(service, "restartSync")
        .mockResolvedValue(undefined);

      await service.startP2PSync(dbMock, "room");
      service.syncHealth = "error";
      (service as any).scheduleReconnect(dbMock);
      // The replication recovers while the backoff ticks: peers are back and
      // health reports healthy. The pending timer must not force a restart.
      service.syncHealth = "healthy";
      service.connectedPeers = 1;

      await vi.advanceTimersByTimeAsync(
        SYNC_CONFIG.RECONNECT_BASE_DELAY_MS + 100,
      );
      expect(restartSpy).not.toHaveBeenCalled();
    });
  });
});
