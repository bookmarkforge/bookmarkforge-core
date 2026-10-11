import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("../../utils/logger", () => ({ logger: mockLogger }));

vi.mock("../../db/database", () => ({ initDB: vi.fn() }));
vi.mock("../../utils/networkFirewall", () => ({
  validateIceServers: vi.fn().mockResolvedValue(undefined),
  setFirewallDisabled: vi.fn(),
}));

const {
  compareSyncVersions,
  constantTimeStringEqual,
  webRTCSyncService,
  isWebRTCSupported,
  WebRTCUnsupportedError,
} = await import("../../services/WebRTCSyncService");
const { isValidSyncDoc } = await import("../../services/webrtc-sync/validation");

type Service = typeof webRTCSyncService;

// Receiver collection mock: the LWW apply path looks up the local doc
// (findOne) before upserting, so every receiver test mock must provide it.
// localDocs entries use the RxDocument shape the apply path reads (get()).
const mockSyncCollection = (
  upsert: ReturnType<typeof vi.fn>,
  localDocs: Array<{ id: string; get: (field: string) => unknown }> = [],
) => ({
  upsert,
  findOne: vi.fn((id: string) => ({
    exec: vi.fn().mockResolvedValue(
      localDocs.find((d) => d.id === id) ?? null,
    ),
  })),
});

describe("WebRTCSyncService", () => {
  let service: Service;
  let mockPC: Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    // The incremental-sync cursor persists in localStorage; clear it so a
    // stored cursor from one test cannot change the advertised cursor (and
    // trigger the empty-DB guard's extra initDB read) in a later one.
    localStorage.clear();
    service = webRTCSyncService;
    // Tests drive startSync directly on the shared singleton without session
    // teardown, so the per-session cursor/negotiation fields would leak
    // between tests.
    (service as any).peerLastSyncAt = null;
    (service as any).advertisedCursor = undefined;
    (service as any).capabilitiesNegotiated = false;
    (service as any).supportsPaginatedSync = false;
    (service as any).onProgress = null;
    (service as any).onStateChange = null;
    // Reset transient per-session state on the shared singleton. A completed
    // sync test leaves a 2s disconnect timer behind (created under real
    // timers); without clearing it, its callback can fire mid-suite and a
    // later maybeScheduleDisconnectAfterSync would refuse to arm a fresh one.
    if ((service as any).disconnectTimer) {
      clearTimeout((service as any).disconnectTimer);
      (service as any).disconnectTimer = null;
    }
    (service as any).outboundSyncActive = false;
    (service as any).syncGeneration = 0;
    mockPC = {
      close: vi.fn(),
      createDataChannel: vi.fn(() => ({
        send: vi.fn(),
        close: vi.fn(),
        onopen: null as any,
        onclose: null as any,
        onmessage: null as any,
      })),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      setRemoteDescription: vi.fn().mockResolvedValue(undefined),
      createOffer: vi
        .fn()
        .mockResolvedValue({ type: "offer", sdp: "mock-sdp" }),
      createAnswer: vi
        .fn()
        .mockResolvedValue({ type: "answer", sdp: "mock-answer-sdp" }),
      onicecandidate: null as any,
      localDescription: {
        type: "offer" as RTCSdpType,
        sdp: [
          "v=0",
          "o=test",
          "s=-",
          "t=0 0",
          "a=candidate:1 1 UDP 2130706431 192.168.1.1 12345 typ host",
          "a=candidate:2 1 UDP 2130706431 10.0.0.1 12346 typ srflx",
          "m=application 9 UDP/DTLS/SCTP",
          "a=mid:0",
          "a=sctp-port:5000",
          "a=setup:active",
          "a=fingerprint:sha-256 AA:BB:CC",
          "a=ice-ufrag:test",
          "a=ice-pwd:test",
        ].join("\r\n"),
      },
      ondatachannel: null as any,
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn(function () {
        return mockPC;
      }),
    );
    vi.stubGlobal("RTCDataChannel", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("registerCallbacks", () => {
    it("registers callbacks and setState invokes them", () => {
      const stateCb = vi.fn();
      const progressCb = vi.fn();
      service.registerCallbacks(stateCb, progressCb);
      (service as any).setState("connected");
      expect(stateCb).toHaveBeenCalledWith("connected", undefined);
    });

    it("setState with a message passes it to the callback", () => {
      const stateCb = vi.fn();
      service.registerCallbacks(stateCb, vi.fn());
      (service as any).setState("error", "something broke");
      expect(stateCb).toHaveBeenCalledWith("error", "something broke");
    });

    it("setState without a registered callback does not fail", () => {
      (service as any).setState("error", "test");
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe("WebRTC unavailability fallback", () => {
    it("isWebRTCSupported reports true when the API is present", () => {
      expect(isWebRTCSupported()).toBe(true);
    });

    it("isWebRTCSupported reports false when RTCPeerConnection is absent", () => {
      vi.stubGlobal("RTCPeerConnection", undefined);
      expect(isWebRTCSupported()).toBe(false);
    });

    it("startHost rejects with WebRTCUnsupportedError and a clear error state", async () => {
      vi.stubGlobal("RTCPeerConnection", undefined);
      const stateCb = vi.fn();
      service.registerCallbacks(stateCb, vi.fn());
      await expect(service.startHost()).rejects.toBeInstanceOf(
        WebRTCUnsupportedError,
      );
      expect(stateCb).toHaveBeenCalledWith(
        "error",
        "WebRTC is not supported by this browser",
      );
    });

    it("startClient rejects with WebRTCUnsupportedError and a clear error state", async () => {
      vi.stubGlobal("RTCPeerConnection", undefined);
      const stateCb = vi.fn();
      service.registerCallbacks(stateCb, vi.fn());
      await expect(service.startClient("encoded-offer")).rejects.toBeInstanceOf(
        WebRTCUnsupportedError,
      );
      expect(stateCb).toHaveBeenCalledWith(
        "error",
        "WebRTC is not supported by this browser",
      );
    });
  });

  describe("disconnect", () => {
    it("resets peerConnection, dataChannel and state", () => {
      (service as any).peerConnection = mockPC;
      (service as any).dataChannel = mockPC.createDataChannel("test");
      service.disconnect();
      expect((service as any).currentState).toBe("disconnected");
      expect(mockPC.close).toHaveBeenCalled();
    });

    it("disconnect without dataChannel or peerConnection does not fail", () => {
      (service as any).peerConnection = null;
      (service as any).dataChannel = null;
      expect(() => service.disconnect()).not.toThrow();
    });
  });

  describe("setupDataChannel", () => {
    it("does nothing without a dataChannel", () => {
      (service as any).dataChannel = null;
      (service as any).setupDataChannel();
      // Must not throw an error
    });

    it("sets up onopen, onclose, onmessage", () => {
      const dc = mockPC.createDataChannel("test");
      (service as any).dataChannel = dc;
      (service as any).setupDataChannel();
      expect(typeof dc.onopen).toBe("function");
      expect(typeof dc.onclose).toBe("function");
      expect(typeof dc.onmessage).toBe("function");
    });

    it("onopen llama setState connected y startSync", async () => {
      const dc = mockPC.createDataChannel("test");
      (service as any).dataChannel = dc;
      (service as any).setupDataChannel();
      const stateCb = vi.fn();
      service.registerCallbacks(stateCb, vi.fn());
      dc.onopen();
      expect((service as any).currentState).toBe("syncing");
    });

    it("onclose llama setState disconnected", () => {
      const dc = mockPC.createDataChannel("test");
      (service as any).dataChannel = dc;
      (service as any).setupDataChannel();
      dc.onclose();
      expect((service as any).currentState).toBe("disconnected");
    });

    it("onmessage handles invalid JSON", () => {
      const dc = mockPC.createDataChannel("test");
      (service as any).dataChannel = dc;
      (service as any).setupDataChannel();
      dc.onmessage({ data: "not-valid-json" });
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("onmessage handles error in handleIncomingMessage", async () => {
      const dc = mockPC.createDataChannel("test");
      (service as any).dataChannel = dc;
      (service as any).setupDataChannel();
      vi.spyOn(service as any, "handleIncomingMessage").mockRejectedValue(new Error("handle error"));
      await dc.onmessage({ data: JSON.stringify({ type: "sync_start" }) });
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("encodeLocalDescription (privado)", () => {
    it("returns empty when there is no peerConnection", () => {
      (service as any).peerConnection = null;
      expect((service as any).encodeLocalDescription()).toBe("");
    });

    it("returns string with peerConnection present", () => {
      (service as any).peerConnection = mockPC;
      const result = (service as any).encodeLocalDescription();
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });
  });

  describe("decodeDescription", () => {
    it("decodes a compressed description", async () => {
      const { compressToEncodedURIComponent } = await import("lz-string");
      const original = { type: "offer", sdp: "test-sdp" };
      const encoded = compressToEncodedURIComponent(JSON.stringify(original));
      expect(service.decodeDescription(encoded)).toEqual(original);
    });

    it("returns null for invalid input", () => {
      expect(service.decodeDescription("invalid!!")).toBeNull();
    });

    it("rejects oversized encoded descriptions before decompression", () => {
      expect(service.decodeDescription("x".repeat(64 * 1024 + 1))).toBeNull();
    });

    it("rejects decoded descriptions with the wrong shape", async () => {
      const { compressToEncodedURIComponent } = await import("lz-string");
      const malformed = compressToEncodedURIComponent(
        JSON.stringify({ type: "offer", sdp: 123 }),
      );
      expect(service.decodeDescription(malformed)).toBeNull();
    });

    it("rejects unsupported SDP roles", async () => {
      const { compressToEncodedURIComponent } = await import("lz-string");
      const malformed = compressToEncodedURIComponent(
        JSON.stringify({ type: "pranswer", sdp: "test-sdp" }),
      );
      expect(service.decodeDescription(malformed)).toBeNull();
    });

    it("rejects SDP containing a NUL character", async () => {
      const { compressToEncodedURIComponent } = await import("lz-string");
      const malformed = compressToEncodedURIComponent(
        JSON.stringify({ type: "offer", sdp: `v=0${String.fromCharCode(0)}` }),
      );
      expect(service.decodeDescription(malformed)).toBeNull();
    });
  });

  describe("minimizeSDP (privado)", () => {
    const minimize = (sdp: string) => (service as any).minimizeSDP(sdp);

    it("keeps essential lines v= o= s= t=", () => {
      const sdp = "v=0\r\no=test\r\ns=-\r\nt=0 0\r\nm=application\r\na=mid:0";
      expect(minimize(sdp)).toContain("v=0");
    });

    it("filters srflx and relay candidates", () => {
      const sdp = [
        "a=candidate:1 1 UDP 2130706431 192.168.1.1 12345 typ host",
        "a=candidate:2 1 UDP 2130706431 10.0.0.1 12346 typ srflx",
        "a=candidate:3 1 UDP 2130706431 10.0.0.1 12347 typ relay",
      ].join("\r\n");
      const result = minimize(sdp);
      expect(result).toContain("typ host");
      expect(result).not.toContain("typ srflx");
      expect(result).not.toContain("typ relay");
    });

    it("keeps data-channel SDP session metadata required by browser parsers", () => {
      const result = minimize(
        [
          "v=0",
          "a=group:BUNDLE 0",
          "a=ice-options:trickle",
          "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
          "a=sctp-port:5000",
          "a=max-message-size:262144",
        ].join("\r\n"),
      );
      expect(result).toContain("a=group:BUNDLE 0");
      expect(result).toContain("a=ice-options:trickle");
      expect(result).toContain("a=sctp-port:5000");
      expect(result).toContain("a=max-message-size:262144");
    });

    it("excludes non-relevant lines", () => {
      expect(minimize("v=0\r\nunexpected-line\r\nm=application")).not.toContain(
        "unexpected",
      );
    });
  });

  describe("encodeLocalDescription (privado)", () => {
    it("returns empty when there is no peerConnection", () => {
      (service as any).peerConnection = null;
      expect((service as any).encodeLocalDescription()).toBe("");
    });

    it("returns string with peerConnection present", () => {
      (service as any).peerConnection = mockPC;
      const result = (service as any).encodeLocalDescription();
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });
  });

  describe("startHost", () => {
    it("starts gathering and resolves when ICE completes", async () => {
      const resultPromise = service.startHost();
      await new Promise((resolve) => setTimeout(resolve, 0));
      mockPC.onicecandidate({ candidate: null });
      const encoded = await resultPromise;
      expect(encoded).toBeTruthy();
      expect((service as any).currentState).toBe("ready_to_share");
    });

    it("handles error in createOffer and rejects the promise", async () => {
      mockPC.createOffer.mockRejectedValue(new Error("offer failed"));
      await expect(service.startHost()).rejects.toThrow("offer failed");
      expect((service as any).currentState).toBe("error");
    });

    it("closes a previous peerConnection before retrying (no ICE leak)", async () => {
      // Simulate a live session from an earlier attempt.
      const previous = { close: vi.fn() };
      (service as any).peerConnection = previous;
      const resultPromise = service.startHost();
      await new Promise((resolve) => setTimeout(resolve, 0));
      mockPC.onicecandidate({ candidate: null });
      await resultPromise;
      // The old RTCPeerConnection must be closed, not left alive.
      expect(previous.close).toHaveBeenCalledTimes(1);
      expect((service as any).peerConnection).not.toBe(previous);
    });
  });

  describe("processClientAnswer", () => {
    it("processes answer and switches to connecting", async () => {
      (service as any).peerConnection = mockPC;
      const { compressToEncodedURIComponent } = await import("lz-string");
      const answer = compressToEncodedURIComponent(
        JSON.stringify({ type: "answer", sdp: "ans" }),
      );
      await service.processClientAnswer(answer);
      expect((service as any).currentState).toBe("connecting");
    });

    it("handles an invalid answer", async () => {
      (service as any).peerConnection = mockPC;
      await service.processClientAnswer("invalid");
      expect((service as any).currentState).toBe("error");
    });

    it("rejects an offer presented as the client answer", async () => {
      (service as any).peerConnection = mockPC;
      const { compressToEncodedURIComponent } = await import("lz-string");
      const offer = compressToEncodedURIComponent(
        JSON.stringify({ type: "offer", sdp: "not-an-answer" }),
      );

      await service.processClientAnswer(offer);

      expect((service as any).currentState).toBe("error");
      expect(mockPC.setRemoteDescription).not.toHaveBeenCalled();
    });

    it("returns without changing state if there is no peerConnection", async () => {
      (service as any).peerConnection = null;
      (service as any).currentState = "disconnected";
      await service.processClientAnswer("whatever");
      expect((service as any).currentState).toBe("disconnected");
    });

    it("handles error in setRemoteDescription", async () => {
      (service as any).peerConnection = mockPC;
      mockPC.setRemoteDescription.mockRejectedValue(new Error("remote error"));
      const { compressToEncodedURIComponent } = await import("lz-string");
      const answer = compressToEncodedURIComponent(
        JSON.stringify({ type: "answer", sdp: "ans" }),
      );
      await service.processClientAnswer(answer);
      expect((service as any).currentState).toBe("error");
    });

    it("handles non-Error error in setRemoteDescription", async () => {
      (service as any).peerConnection = mockPC;
      mockPC.setRemoteDescription.mockRejectedValue("string error");
      const { compressToEncodedURIComponent } = await import("lz-string");
      const answer = compressToEncodedURIComponent(
        JSON.stringify({ type: "answer", sdp: "ans" }),
      );
      await service.processClientAnswer(answer);
      expect((service as any).currentState).toBe("error");
    });
  });

  describe("startClient", () => {
    it("starts client and resolves with encoded answer", async () => {
      const { compressToEncodedURIComponent } = await import("lz-string");
      const offer = compressToEncodedURIComponent(
        JSON.stringify({ type: "offer", sdp: "offer" }),
      );
      const resultPromise = service.startClient(offer);
      await new Promise((resolve) => setTimeout(resolve, 0));
      mockPC.onicecandidate({ candidate: null });
      const encoded = await resultPromise;
      expect(encoded).toBeTruthy();
    });

    it("rejects an invalid offer", async () => {
      await expect(service.startClient("bad")).rejects.toThrow(
        "Invalid Host QR code",
      );
    });

    it("rejects an answer presented as the host offer", async () => {
      const { compressToEncodedURIComponent } = await import("lz-string");
      const answer = compressToEncodedURIComponent(
        JSON.stringify({ type: "answer", sdp: "not-an-offer" }),
      );

      await expect(service.startClient(answer)).rejects.toThrow(
        "Invalid Host QR code",
      );
      expect((service as any).peerConnection).toBeNull();
    });

    it("configures peerConnection ondatachannel", async () => {
      const { compressToEncodedURIComponent } = await import("lz-string");
      const offer = compressToEncodedURIComponent(
        JSON.stringify({ type: "offer", sdp: "offer" }),
      );
      const resultPromise = service.startClient(offer);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(typeof mockPC.ondatachannel).toBe("function");
      // Simular data channel entrante
      const mockDC = { send: vi.fn() };
      mockPC.ondatachannel({ channel: mockDC });
      mockPC.onicecandidate({ candidate: null });
      await resultPromise;
    });

    it("handles error in createAnswer", async () => {
      const { compressToEncodedURIComponent } = await import("lz-string");
      const offer = compressToEncodedURIComponent(
        JSON.stringify({ type: "offer", sdp: "offer" }),
      );
      mockPC.createAnswer.mockRejectedValue(new Error("answer failed"));
      await expect(service.startClient(offer)).rejects.toThrow("answer failed");
    });

    it("timeout fallback switches to ready_to_share", async () => {
      vi.useFakeTimers();
      const { compressToEncodedURIComponent } = await import("lz-string");
      const offer = compressToEncodedURIComponent(
        JSON.stringify({ type: "offer", sdp: "offer" }),
      );
      const resultPromise = service.startClient(offer);
      await Promise.resolve();
      vi.advanceTimersByTime(3000);
      const encoded = await resultPromise;
      expect(encoded).toBeTruthy();
      vi.useRealTimers();
    });

    it("ignores non-null ICE candidate and resolves via fallback", async () => {
      vi.useFakeTimers();
      const { compressToEncodedURIComponent } = await import("lz-string");
      const offer = compressToEncodedURIComponent(
        JSON.stringify({ type: "offer", sdp: "offer" }),
      );
      const promise = service.startClient(offer);
      await Promise.resolve();
      mockPC.onicecandidate({ candidate: { candidate: "fake-candidate" } });
      expect((service as any).currentState).toBe("gathering");
      vi.advanceTimersByTime(3000);
      const encoded = await promise;
      expect(encoded).toBeTruthy();
      expect((service as any).currentState).toBe("ready_to_share");
      vi.useRealTimers();
    });

    it("fallback does nothing if the state is no longer gathering", async () => {
      vi.useFakeTimers();
      const { compressToEncodedURIComponent } = await import("lz-string");
      const offer = compressToEncodedURIComponent(
        JSON.stringify({ type: "offer", sdp: "offer" }),
      );
      const promise = service.startClient(offer);
      await Promise.resolve();
      mockPC.onicecandidate({ candidate: null });
      await promise;
      (service as any).currentState = "connected";
      vi.advanceTimersByTime(3000);
      expect((service as any).currentState).toBe("connected");
      vi.useRealTimers();
    });
  });

  describe("fallback stale timer (L-10)", () => {
    it("a stale timer from a previous session does not resolve the new one", async () => {
      vi.useFakeTimers();
      // Session 1 ends via ICE: its 3 s fallback becomes stale (and must
      // be a no-op thanks to the `resolved` flag + clearTimeout of fix L-10).
      const p1 = service.startHost();
      await Promise.resolve();
      mockPC.onicecandidate({ candidate: null });
      await p1;
      expect((service as any).currentState).toBe("ready_to_share");

      // Session 2 starts 2 s later and is still "gathering".
      vi.advanceTimersByTime(2000);
      const p2 = service.startHost();
      await Promise.resolve();
      expect((service as any).currentState).toBe("gathering");

      // At t=3000 it would fire session 1's stale timer, still inside
      // session 2's 3 s gathering. Without the fix, it would resolve p2 early
      // with a stale localDescription; with the fix it is a no-op.
      vi.advanceTimersByTime(1000);
      let settled = false;
      p2.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      expect((service as any).currentState).toBe("gathering");

      // Cleanup: no pending timers left across tests.
      service.disconnect();
      vi.useRealTimers();
    });
  });

  describe("handleIncomingMessage", () => {
    it("ignores messages without type", () => {
      (service as any).handleIncomingMessage({ noType: true });
      // Must not throw an error
    });

    it("processes sync_start and prepares the buffer", () => {
      (service as any).handleIncomingMessage({
        type: "sync_start",
        totalChunks: 3,
      });
      expect((service as any).expectedChunks).toBe(3);
      expect((service as any).incomingBuffer).toHaveLength(3);
    });

    it("processes sync_chunk", () => {
      (service as any).expectedChunks = 2;
      (service as any).incomingBuffer = new Array(2);
      (service as any).handleIncomingMessage({
        type: "sync_chunk",
        index: 0,
        data: "part1",
      });
      expect((service as any).incomingBuffer[0]).toBe("part1");
    });

    it("clears an interrupted buffer to allow the next sync_start", async () => {
      (service as any).expectedChunks = 2;
      (service as any).incomingBuffer = ["partial", undefined];
      (service as any).expectedChecksum = "old-checksum";
      (service as any).expectedSyncAuth = "old-auth";
      (service as any).expectedPayloadHmac = "old-hmac";

      await (service as any).handleIncomingMessage({
        type: "sync_start",
        totalChunks: 1,
      });

      expect((service as any).currentState).toBe("error");
      expect((service as any).expectedChunks).toBe(1);
      expect((service as any).incomingBuffer).toHaveLength(1);
      expect((service as any).expectedChecksum).toBe("");
    });

    it("rejects incomplete or unauthenticated paginated metadata", async () => {
      await (service as any).handleIncomingMessage({
        type: "sync_start",
        totalChunks: 1,
        batchId: "batch-1",
        batchIndex: 0,
        hasMore: true,
        syncSessionId: "session-1",
      });
      expect((service as any).currentState).toBe("error");
      expect((service as any).expectedChunks).toBe(0);
    });

    it("rejects paginated batches out of order or from another session", async () => {
      const base = {
        type: "sync_start",
        totalChunks: 1,
        checksum: "a".repeat(64),
        auth: "auth-key",
        hmac: "b".repeat(64),
        batchId: "batch-1",
        batchIndex: 0,
        hasMore: true,
        syncSessionId: "session-1",
      };
      await (service as any).handleIncomingMessage(base);
      expect((service as any).expectedChunks).toBe(1);

      await (service as any).handleIncomingMessage({
        ...base,
        batchId: "batch-2",
        batchIndex: 2,
      });
      expect((service as any).currentState).toBe("error");
      expect((service as any).expectedChunks).toBe(0);
    });

    it("restarts an interrupted paginated session without inheriting its index", async () => {
      const firstSession = {
        type: "sync_start",
        totalChunks: 1,
        checksum: "a".repeat(64),
        auth: "auth-one",
        hmac: "b".repeat(64),
        batchId: "batch-one",
        batchIndex: 0,
        hasMore: true,
        syncSessionId: "session-one",
      };
      await (service as any).handleIncomingMessage(firstSession);
      expect((service as any).expectedChunks).toBe(1);

      const secondSession = {
        ...firstSession,
        auth: "auth-two",
        batchId: "batch-two",
        syncSessionId: "session-two",
      };
      await (service as any).handleIncomingMessage(secondSession);
      expect((service as any).expectedChunks).toBe(1);
      expect((service as any).expectedBatchId).toBe("batch-two");
      expect((service as any).paginatedSessionId).toBe("session-two");
    });

    it("rejects an invalid chunk count in sync_start", () => {
      (service as any).handleIncomingMessage({
        type: "sync_start",
        totalChunks: 999999,
      });
      expect((service as any).currentState).toBe("error");
    });

    it("rejects out-of-range chunk", () => {
      (service as any).expectedChunks = 2;
      (service as any).incomingBuffer = new Array(2);
      (service as any).handleIncomingMessage({
        type: "sync_chunk",
        index: 5,
        data: "x",
      });
      expect((service as any).currentState).toBe("error");
    });

    it("rejects chunk exceeding MAX_CHUNK_SIZE", () => {
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = new Array(1);
      (service as any).handleIncomingMessage({
        type: "sync_chunk",
        index: 0,
        data: "x".repeat(2 * 1024 * 1024),
      });
      expect((service as any).currentState).toBe("error");
    });
  });

  describe("startHost", () => {
    it("timeout fallback switches to ready_to_share", async () => {
      vi.useFakeTimers();
      const resultPromise = service.startHost();
      await Promise.resolve();
      vi.advanceTimersByTime(3000);
      const encoded = await resultPromise;
      expect(encoded).toBeTruthy();
      vi.useRealTimers();
    });

    it("ignores non-null ICE candidate and resolves via fallback", async () => {
      vi.useFakeTimers();
      const promise = service.startHost();
      await Promise.resolve();
      mockPC.onicecandidate({ candidate: { candidate: "fake-candidate" } });
      expect((service as any).currentState).toBe("gathering");
      vi.advanceTimersByTime(3000);
      const encoded = await promise;
      expect(encoded).toBeTruthy();
      expect((service as any).currentState).toBe("ready_to_share");
      vi.useRealTimers();
    });

    it("fallback does nothing if the state is no longer gathering", async () => {
      vi.useFakeTimers();
      const promise = service.startHost();
      await Promise.resolve();
      mockPC.onicecandidate({ candidate: null });
      await promise;
      (service as any).currentState = "connected";
      vi.advanceTimersByTime(3000);
      expect((service as any).currentState).toBe("connected");
      vi.useRealTimers();
    });
  });

  describe("processReceivedData (shape validation)", () => {
    it("rejects a document with missing required fields in an authenticated batch", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      const payload = JSON.stringify({
        type: "sync_data",
        documents: [{ id: "d1", title: "missing schema fields" }],
        bookmarks: [],
      });
      const auth = "strict-test-auth";
      const encoder = new TextEncoder();
      const hash = await crypto.subtle.digest("SHA-256", encoder.encode(payload));
      const checksum = Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(auth),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
      const hmac = Array.from(new Uint8Array(signature), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = checksum;
      (service as any).expectedSyncAuth = auth;
      (service as any).expectedPayloadHmac = hmac;

      await (service as any).processReceivedData();

      expect(upsert).not.toHaveBeenCalled();
      expect((service as any).currentState).toBe("error");
    });

    it("rejects documents without a valid id and upserts only valid ones", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });

      const payload = JSON.stringify({
        type: "sync_data",
        documents: [
          { id: "d1", title: "ok" },
          { title: "no-id" },
          { id: "", content: "empty-id" },
        ],
        bookmarks: [{ id: "b1" }],
      });

      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();

      const upsertedDocs = upsert.mock.calls
        .map((c: unknown[]) => c[0] as Record<string, unknown>)
        .filter((d) => d.id !== undefined);
      const docIds = upsertedDocs.map((d) => d.id);
      expect(docIds).toEqual([]);
      expect((service as any).currentState).toBe("error");
    });
  });

  describe("handleIncomingMessage - edge cases", () => {
    it("rejects sync_start with totalChunks=0", () => {
      (service as any).handleIncomingMessage({
        type: "sync_start",
        totalChunks: 0,
      });
      expect((service as any).currentState).toBe("error");
    });

    it("rejects sync_start with negative totalChunks", () => {
      (service as any).handleIncomingMessage({
        type: "sync_start",
        totalChunks: -5,
      });
      expect((service as any).currentState).toBe("error");
    });

    it("rejects sync_start with non-integer totalChunks", () => {
      (service as any).handleIncomingMessage({
        type: "sync_start",
        totalChunks: 1.5,
      });
      expect((service as any).currentState).toBe("error");
    });

    it("rejects sync_start with totalChunks=2001", () => {
      (service as any).handleIncomingMessage({
        type: "sync_start",
        totalChunks: 2001,
      });
      expect((service as any).currentState).toBe("error");
    });

    it("accepts sync_start with totalChunks=2000", () => {
      (service as any).handleIncomingMessage({
        type: "sync_start",
        totalChunks: 2000,
      });
      expect((service as any).expectedChunks).toBe(2000);
    });

    it("rejects sync_chunk with negative index", () => {
      (service as any).expectedChunks = 2;
      (service as any).incomingBuffer = new Array(2);
      (service as any).handleIncomingMessage({
        type: "sync_chunk",
        index: -1,
        data: "x",
      });
      expect((service as any).currentState).toBe("error");
    });

    it("rejects sync_chunk with non-integer index", () => {
      (service as any).expectedChunks = 2;
      (service as any).incomingBuffer = new Array(2);
      (service as any).handleIncomingMessage({
        type: "sync_chunk",
        index: 0.5,
        data: "x",
      });
      expect((service as any).currentState).toBe("error");
    });

    it("rejects sync_chunk when incomingBuffer is not an array", () => {
      (service as any).expectedChunks = 2;
      (service as any).incomingBuffer = "not-array";
      (service as any).handleIncomingMessage({
        type: "sync_chunk",
        index: 0,
        data: "x",
      });
      expect((service as any).currentState).toBe("error");
    });

    it("rejects sync_chunk with non-string data", () => {
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = new Array(1);
      (service as any).handleIncomingMessage({
        type: "sync_chunk",
        index: 0,
        data: 123,
      });
      expect((service as any).currentState).toBe("error");
    });

    it("accepts sync_chunk with 1-char data", () => {
      (service as any).resetBuffer();
      (service as any).expectedChunks = 2;
      (service as any).incomingBuffer = new Array(2);
      (service as any).currentState = "connected";
      (service as any).handleIncomingMessage({
        type: "sync_chunk",
        index: 0,
        data: "a",
      });
      expect((service as any).incomingBuffer[0]).toBe("a");
      expect((service as any).currentState).toBe("connected");
    });

    it("ignores a message with an unknown type", () => {
      (service as any).currentState = "connected";
      (service as any).handleIncomingMessage({
        type: "unknown_type",
      });
      expect((service as any).currentState).toBe("connected");
    });

    it("ignores null", () => {
      (service as any).currentState = "connected";
      (service as any).handleIncomingMessage(null);
      expect((service as any).currentState).toBe("connected");
    });

    it("ignores a string", () => {
      (service as any).currentState = "connected";
      (service as any).handleIncomingMessage("hello");
      expect((service as any).currentState).toBe("connected");
    });
  });

  describe("processReceivedData - checksum and HMAC", () => {
    function setupReceivedBuffer(payload: string) {
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
    }

    it("accepts a payload without checksum or HMAC (no verification)", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });

      const payload = JSON.stringify({ type: "sync_data", documents: [], bookmarks: [] });
      setupReceivedBuffer(payload);
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();
      expect(upsert).not.toHaveBeenCalled();
    });

    it("rejects payload with incorrect checksum", async () => {
      const payload = JSON.stringify({ type: "sync_data", documents: [], bookmarks: [] });
      setupReceivedBuffer(payload);
      (service as any).expectedChecksum = "badchecksum";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();
      expect((service as any).currentState).toBe("error");
    });

    it("rejects payload with incorrect HMAC", async () => {
      const payload = JSON.stringify({ type: "sync_data", documents: [], bookmarks: [] });
      setupReceivedBuffer(payload);
      // Compute real checksum
      const { subtle } = globalThis.crypto;
      const encoder = new TextEncoder();
      const hashBuffer = await subtle.digest("SHA-256", encoder.encode(payload));
      const checksum = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      (service as any).expectedChecksum = checksum;
      (service as any).expectedSyncAuth = "real-key";
      (service as any).expectedPayloadHmac = "badhmac";

      await (service as any).processReceivedData();
      expect((service as any).currentState).toBe("error");
    });

    it("accepts legacy checksum without HMAC for compatibility", async () => {
      const payload = JSON.stringify({ type: "sync_data", documents: [], bookmarks: [] });
      setupReceivedBuffer(payload);
      const { subtle } = globalThis.crypto;
      const encoder = new TextEncoder();
      const hashBuffer = await subtle.digest("SHA-256", encoder.encode(payload));
      const checksum = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      (service as any).expectedChecksum = checksum;
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();
      expect((service as any).currentState).toBe("completed");
    });

    it("accepts a payload with a valid HMAC", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });

      const syncAuth = "test-auth-key";
      const payload = JSON.stringify({ type: "sync_data", documents: [], bookmarks: [] });

      // Compute HMAC
      const { subtle } = globalThis.crypto;
      const encoder = new TextEncoder();
      const cryptoKey = await subtle.importKey(
        "raw",
        encoder.encode(syncAuth),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sig = await subtle.sign("HMAC", cryptoKey, encoder.encode(payload));
      const hmac = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Compute checksum
      const hashBuffer = await subtle.digest("SHA-256", encoder.encode(payload));
      const checksum = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      setupReceivedBuffer(payload);
      (service as any).expectedChecksum = checksum;
      (service as any).expectedSyncAuth = syncAuth;
      (service as any).expectedPayloadHmac = hmac;

      await (service as any).processReceivedData();
      expect((service as any).currentState).toBe("completed");
    });
  });

  describe("processReceivedData - upsert batching", () => {
    it("processes documents and bookmarks in batches of 50", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });

      const docs = Array.from({ length: 120 }, (_, i) => ({
        id: `doc-${i}`,
        title: `Doc ${i}`,
      }));
      const payload = JSON.stringify({ type: "sync_data", documents: docs, bookmarks: [] });

      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();
      expect(upsert).toHaveBeenCalledTimes(120);
    });

    it("fails the batch if an upsert does not persist", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockRejectedValue(new Error("db fail"));
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });

      const payload = JSON.stringify({
        type: "sync_data",
        documents: [{ id: "d1" }],
        bookmarks: [],
      });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();
      expect((service as any).currentState).toBe("error");
      expect((service as any).disconnectTimer).toBeNull();
    });

    it("LWW: skips a newer local doc (the peer's stale snapshot does not regress the local edit)", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert, [
          {
            id: "d1",
            get: (field: string) =>
              field === "updatedAt" ? "2026-08-13T10:00:00.000Z" : undefined,
          },
        ]),
        bookmarks: mockSyncCollection(upsert),
      });
      const payload = JSON.stringify({
        type: "sync_data",
        documents: [{ id: "d1", updatedAt: "2026-08-13T09:00:00.000Z" }],
        bookmarks: [],
      });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();
      expect(upsert).not.toHaveBeenCalled();
      expect((service as any).currentState).toBe("completed");
    });

    it("LWW: applies a newer incoming doc — including a remote tombstone that deletes the local one", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert, [
          {
            id: "d1",
            get: (field: string) =>
              field === "updatedAt" ? "2026-08-13T09:00:00.000Z" : undefined,
          },
        ]),
        bookmarks: mockSyncCollection(upsert),
      });
      const payload = JSON.stringify({
        type: "sync_data",
        documents: [
          { id: "d1", isDeleted: true, updatedAt: "2026-08-13T11:00:00.000Z" },
        ],
        bookmarks: [],
      });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();
      expect(upsert).toHaveBeenCalledWith({
        id: "d1",
        isDeleted: true,
        updatedAt: "2026-08-13T11:00:00.000Z",
      });
      expect((service as any).currentState).toBe("completed");
    });

    it("LWW: applies a newer bookmark tombstone over a local live bookmark", async () => {
      const { initDB } = await import("../../db/database");
      const documentUpsert = vi.fn().mockResolvedValue({});
      const bookmarkUpsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(documentUpsert),
        bookmarks: mockSyncCollection(bookmarkUpsert, [
          {
            id: "b1",
            get: (field: string) =>
              field === "updatedAt" ? "2026-08-13T09:00:00.000Z" : undefined,
          },
        ]),
      });
      const payload = JSON.stringify({
        type: "sync_data",
        documents: [],
        bookmarks: [
          {
            id: "b1",
            isDeleted: true,
            updatedAt: "2026-08-13T11:00:00.000Z",
          },
        ],
      });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();

      expect(bookmarkUpsert).toHaveBeenCalledWith({
        id: "b1",
        isDeleted: true,
        updatedAt: "2026-08-13T11:00:00.000Z",
      });
      expect(documentUpsert).not.toHaveBeenCalled();
      expect((service as any).currentState).toBe("completed");
    });

    it("protects a local private document from a newer remote public version", async () => {
      const { initDB } = await import("../../db/database");
      const documentUpsert = vi.fn().mockResolvedValue({});
      const bookmarkUpsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(documentUpsert, [
          {
            id: "private-doc",
            get: (field: string) => {
              if (field === "isPrivate") return true;
              if (field === "updatedAt") return "2026-08-13T09:00:00.000Z";
              return undefined;
            },
          },
        ]),
        bookmarks: mockSyncCollection(bookmarkUpsert),
      });
      const payload = JSON.stringify({
        type: "sync_data",
        documents: [
          {
            id: "private-doc",
            title: "remote public copy",
            isPrivate: false,
            updatedAt: "2026-08-13T11:00:00.000Z",
          },
        ],
        bookmarks: [],
      });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();

      expect(documentUpsert).not.toHaveBeenCalled();
      expect(bookmarkUpsert).not.toHaveBeenCalled();
      expect((service as any).currentState).toBe("completed");
    });

    it("LWW: inserts docs that do not exist locally", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      const payload = JSON.stringify({
        type: "sync_data",
        documents: [{ id: "new-doc", updatedAt: "2026-08-13T10:00:00.000Z" }],
        bookmarks: [],
      });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();
      expect(upsert).toHaveBeenCalledTimes(1);
      expect((service as any).currentState).toBe("completed");
    });

    it("marks completed and schedules disconnect after 2s", async () => {
      vi.useFakeTimers();
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });

      const payload = JSON.stringify({ type: "sync_data", documents: [], bookmarks: [] });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      const stateCb = vi.fn();
      service.registerCallbacks(stateCb, vi.fn());

      await (service as any).processReceivedData();
      expect((service as any).currentState).toBe("completed");

      // Disconnect should fire after 2s
      (service as any).peerConnection = mockPC;
      (service as any).dataChannel = mockPC.createDataChannel("test");
      vi.advanceTimersByTime(2000);
      expect((service as any).currentState).toBe("disconnected");
      vi.useRealTimers();
    });

    it("defers the post-completion disconnect while the outbound sync is still sending", async () => {
      vi.useFakeTimers();
      try {
        const { initDB } = await import("../../db/database");
        const upsert = vi.fn().mockResolvedValue({});
        (initDB as any).mockResolvedValue({
          documents: mockSyncCollection(upsert),
          bookmarks: mockSyncCollection(upsert),
        });
        (service as any).peerConnection = mockPC;
        (service as any).dataChannel = {
          readyState: "open",
          send: vi.fn(),
          bufferedAmount: 0,
          close: vi.fn(),
        };
        // This peer is mid-way through sending its own (large) vault to the
        // peer whose small vault we have just finished receiving. The 2s
        // disconnect must not be armed or the channel would close mid-send,
        // truncating the outbound transfer.
        (service as any).outboundSyncActive = true;

        const payload = JSON.stringify({ type: "sync_data", documents: [], bookmarks: [] });
        (service as any).expectedChunks = 1;
        (service as any).incomingBuffer = [payload];
        (service as any).expectedChecksum = "";
        (service as any).expectedSyncAuth = null;
        (service as any).expectedPayloadHmac = null;
        (service as any).expectedHasMore = false;

        await (service as any).processReceivedData();
        expect((service as any).currentState).toBe("completed");
        // Deferred: no disconnect while the outbound transfer is in flight.
        expect((service as any).disconnectTimer).toBeNull();

        // The outbound transfer finishes; startSync's finally clears the flag
        // and arms the deferred disconnect.
        (service as any).outboundSyncActive = false;
        (service as any).maybeScheduleDisconnectAfterSync();
        expect((service as any).disconnectTimer).not.toBeNull();

        vi.advanceTimersByTime(2000);
        expect((service as any).currentState).toBe("disconnected");
      } finally {
        vi.useRealTimers();
      }
    });

    it("arms the deferred disconnect from startSync's finally when the inbound completed mid-send (bidirectional asymmetric vaults)", async () => {
      vi.useFakeTimers();
      try {
        const { initDB } = await import("../../db/database");
        const upsert = vi.fn().mockResolvedValue({});
        // The collection must serve BOTH roles: the sender path queries with
        // find() while the receiver apply path uses findOne()/upsert().
        const combinedCollection = () => ({
          ...mockSyncCollection(upsert),
          find: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue([]),
          }),
        });
        (initDB as any).mockResolvedValue({
          documents: combinedCollection(),
          bookmarks: combinedCollection(),
        });
        const send = vi.fn();
        (service as any).dataChannel = {
          readyState: "open",
          send,
          bufferedAmount: 0,
          close: vi.fn(),
        };
        (service as any).peerConnection = mockPC;

        // Kick off this peer's outbound sync (its own vault) without awaiting:
        // it is still sending when the inbound transfer completes below.
        const syncPromise = (service as any).startSync();
        // Resolve capability negotiation immediately so the outbound proceeds.
        await (service as any).handleIncomingMessage({
          type: "sync_capabilities_ack",
          paginated: true,
        });

        // The peer's small vault arrives in full while we are still sending
        // ours (the asymmetric pairing: this side owns the large vault).
        const payload = JSON.stringify({ type: "sync_data", documents: [], bookmarks: [] });
        (service as any).expectedChunks = 1;
        (service as any).incomingBuffer = [payload];
        (service as any).expectedChecksum = "";
        (service as any).expectedSyncAuth = null;
        (service as any).expectedPayloadHmac = null;
        (service as any).expectedHasMore = false;
        await (service as any).processReceivedData();

        expect((service as any).currentState).toBe("completed");
        // The outbound transfer is still in flight, so the disconnect must be
        // deferred rather than armed.
        expect((service as any).outboundSyncActive).toBe(true);
        expect((service as any).disconnectTimer).toBeNull();

        // Let the outbound transfer finish; its finally must arm the deferred
        // disconnect now that both directions have completed.
        for (let i = 0; i < 20 && !(service as any).disconnectTimer; i++) {
          await vi.advanceTimersByTimeAsync(50);
        }
        await syncPromise;
        expect((service as any).outboundSyncActive).toBe(false);
        expect((service as any).disconnectTimer).not.toBeNull();

        // The 2s grace elapses and the channel is torn down.
        await vi.advanceTimersByTimeAsync(2000);
        expect((service as any).currentState).toBe("disconnected");
      } finally {
        vi.useRealTimers();
      }
    });

    it("a stale startSync from a closed session cannot poison a reopened session (finding #3, catch path)", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      const combinedCollection = () => ({
        ...mockSyncCollection(upsert),
        find: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });

      // initDB calls are queued: session 1's call stays pending until released
      // AFTER session 2 has started, so the stale run is still in flight when
      // the new session is established.
      const initResolvers: Array<(db: unknown) => void> = [];
      const initRejecters: Array<(err: unknown) => void> = [];
      (initDB as any).mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            initResolvers.push(resolve);
            initRejecters.push(reject);
          }),
      );

      // Session 1: the outbound sync starts and blocks awaiting initDB.
      (service as any).dataChannel = {
        readyState: "open",
        send: vi.fn(),
        bufferedAmount: 0,
        close: vi.fn(),
      };
      (service as any).peerConnection = mockPC;
      const staleSync = (service as any).startSync();
      await (service as any).handleIncomingMessage({
        type: "sync_capabilities_ack",
        paginated: true,
      });
      expect(initResolvers).toHaveLength(1);

      // The user closes the modal and reopens it quickly: session 1 is torn
      // down and session 2 starts while session 1's startSync is still in
      // flight (blocked on its initDB call).
      service.disconnect();
      (service as any).dataChannel = {
        readyState: "open",
        send: vi.fn(),
        bufferedAmount: 0,
        close: vi.fn(),
      };
      (service as any).peerConnection = mockPC;
      const freshSync = (service as any).startSync();
      await (service as any).handleIncomingMessage({
        type: "sync_capabilities_ack",
        paginated: true,
      });
      expect(initResolvers).toHaveLength(2);

      // Session 2's initDB resolves; its outbound sync completes normally.
      initResolvers[1]!({ documents: combinedCollection(), bookmarks: combinedCollection() });
      await freshSync;
      expect((service as any).currentState).toBe("syncing");
      expect((service as any).syncGeneration).toBe(2);

      // Session 1's initDB now fails. With the fix its catch is generation-
      // guarded: the failure belongs to the OLD channel and must not set an
      // error state on (or drop ACKs of) the new session.
      initRejecters[0]!(new Error("db init fail (stale session)"));
      await staleSync;

      expect((service as any).currentState).toBe("syncing");
      expect((service as any).outboundSyncActive).toBe(false);
    });

    it("a stale startSync bails at the first checkpoint instead of resuming into the new session (finding #3, checkpoint path)", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      const combinedCollection = () => ({
        ...mockSyncCollection(upsert),
        find: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });

      const initResolvers: Array<(db: unknown) => void> = [];
      (initDB as any).mockImplementation(
        () =>
          new Promise((resolve) => {
            initResolvers.push(resolve);
          }),
      );
      const progress = vi.fn();
      (service as any).onProgress = progress;

      // Session 1 blocks on initDB.
      (service as any).dataChannel = {
        readyState: "open",
        send: vi.fn(),
        bufferedAmount: 0,
        close: vi.fn(),
      };
      (service as any).peerConnection = mockPC;
      const staleSync = (service as any).startSync();
      await (service as any).handleIncomingMessage({
        type: "sync_capabilities_ack",
        paginated: true,
      });
      expect(initResolvers).toHaveLength(1);

      // Close + reopen: session 2 completes its outbound sync first.
      service.disconnect();
      (service as any).dataChannel = {
        readyState: "open",
        send: vi.fn(),
        bufferedAmount: 0,
        close: vi.fn(),
      };
      (service as any).peerConnection = mockPC;
      const freshSync = (service as any).startSync();
      await (service as any).handleIncomingMessage({
        type: "sync_capabilities_ack",
        paginated: true,
      });
      initResolvers[1]!({ documents: combinedCollection(), bookmarks: combinedCollection() });
      await freshSync;
      expect(progress).toHaveBeenLastCalledWith(100);
      const callsAfterFresh = progress.mock.calls.length;

      // Session 1's initDB resolves now — the stale run must hit the generation
      // checkpoint right after the await and bail, never touching the send
      // path or reporting progress into the new session.
      initResolvers[0]!({ documents: combinedCollection(), bookmarks: combinedCollection() });
      await staleSync;

      expect(progress.mock.calls.length).toBe(callsAfterFresh);
      expect((service as any).currentState).toBe("syncing");
      expect((service as any).outboundSyncActive).toBe(false);
    });

    it("restores state after error in processReceivedData", async () => {
      const { initDB } = await import("../../db/database");
      (initDB as any).mockRejectedValue(new Error("db init fail"));

      const payload = JSON.stringify({ type: "sync_data", documents: [], bookmarks: [] });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();
      expect((service as any).currentState).toBe("error");
      expect((service as any).incomingBuffer).toEqual([]);
      expect((service as any).expectedChunks).toBe(0);
    });

    it("restores state after non-Error error in processReceivedData", async () => {
      const { initDB } = await import("../../db/database");
      (initDB as any).mockRejectedValue("string-error");

      const payload = JSON.stringify({ type: "sync_data", documents: [], bookmarks: [] });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();
      expect((service as any).currentState).toBe("error");
      expect((service as any).incomingBuffer).toEqual([]);
      expect((service as any).expectedChunks).toBe(0);
    });
  });

  describe("sendOrThrow", () => {
    it("throws if dataChannel is null", () => {
      (service as any).dataChannel = null;
      expect(() => (service as any).sendOrThrow("test")).toThrow(
        "Data channel is not open",
      );
    });

    it("throws when the dataChannel is not open", () => {
      (service as any).dataChannel = { readyState: "connecting", send: vi.fn() };
      expect(() => (service as any).sendOrThrow("test")).toThrow(
        "Data channel is not open",
      );
    });

    it("throws when the buffer is full", () => {
      (service as any).dataChannel = {
        readyState: "open",
        send: vi.fn(),
        bufferedAmount: 17 * 1024 * 1024,
      };
      expect(() => (service as any).sendOrThrow("test")).toThrow(
        "Data channel buffer full",
      );
    });

    it("sends when the dataChannel is open and the buffer is OK", () => {
      const send = vi.fn();
      (service as any).dataChannel = {
        readyState: "open",
        send,
        bufferedAmount: 0,
      };
      (service as any).sendOrThrow("test-data");
      expect(send).toHaveBeenCalledWith("test-data");
    });
  });

  describe("startSync - sendOrThrow", () => {
    it("sendOrThrow sends JSON when the dataChannel is open", () => {
      const send = vi.fn();
      (service as any).dataChannel = {
        readyState: "open",
        send,
        bufferedAmount: 0,
      };
      const payload = JSON.stringify({ type: "test" });
      (service as any).sendOrThrow(payload);
      expect(send).toHaveBeenCalledWith(payload);
    });

    it("sendOrThrow throws when the dataChannel is 'closing'", () => {
      (service as any).dataChannel = {
        readyState: "closing",
        send: vi.fn(),
        bufferedAmount: 0,
      };
      expect(() => (service as any).sendOrThrow("data")).toThrow(
        "Data channel is not open",
      );
    });

    it("sendOrThrow throws when the dataChannel is 'closed'", () => {
      (service as any).dataChannel = {
        readyState: "closed",
        send: vi.fn(),
        bufferedAmount: 0,
      };
      expect(() => (service as any).sendOrThrow("data")).toThrow(
        "Data channel is not open",
      );
    });
  });

  describe("disconnect - timer cleanup", () => {
    it("clears all timers", () => {
      (service as any).hostFallbackTimer = setTimeout(() => {}, 99999);
      (service as any).clientFallbackTimer = setTimeout(() => {}, 99999);
      (service as any).disconnectTimer = setTimeout(() => {}, 99999);
      (service as any).incomingTransferTimer = setTimeout(() => {}, 99999);
      (service as any).dataChannel = { close: vi.fn() };
      (service as any).peerConnection = { close: vi.fn() };
      service.disconnect();
      expect((service as any).hostFallbackTimer).toBeNull();
      expect((service as any).clientFallbackTimer).toBeNull();
      expect((service as any).disconnectTimer).toBeNull();
      expect((service as any).incomingTransferTimer).toBeNull();
    });

    it("clears incomingBuffer and expectedChunks", () => {
      (service as any).incomingBuffer = ["a", "b"];
      (service as any).expectedChunks = 5;
      (service as any).dataChannel = { close: vi.fn() };
      (service as any).peerConnection = { close: vi.fn() };
      service.disconnect();
      expect((service as any).incomingBuffer).toEqual([]);
      expect((service as any).expectedChunks).toBe(0);
    });
  });

  describe("startClient - error en setRemoteDescription", () => {
    it("handles non-Error error in createAnswer", async () => {
      const { compressToEncodedURIComponent } = await import("lz-string");
      const offer = compressToEncodedURIComponent(
        JSON.stringify({ type: "offer", sdp: "offer" }),
      );
      mockPC.createAnswer.mockRejectedValue("string-error");
      await expect(service.startClient(offer)).rejects.toThrow("string-error");
    });
  });

  describe("processReceivedData - invalid JSON in buffer", () => {
    it("handles invalid JSON in a full buffer", async () => {
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = ["not-valid-json{{{"];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();
      expect((service as any).currentState).toBe("error");
    });
  });

  describe("coverage gaps", () => {
    it("startSync sends one bounded paginated batch and marks the final batch", async () => {
      const send = vi.fn();
      (service as any).dataChannel = {
        readyState: "open",
        send,
        bufferedAmount: 0,
        close: vi.fn(),
        onopen: null,
        onclose: null,
        onmessage: null,
      };
      const progress = vi.fn();
      service.registerCallbacks(vi.fn(), progress);

      const { initDB } = await import("../../db/database");
      const doc = { id: "d1", title: "x" };
      const bookmark = { id: "b1" };
      const toJSON = vi
        .fn()
        .mockReturnValueOnce(doc)
        .mockReturnValueOnce(bookmark);
      const collection = {
        find: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([{ toJSON }]),
        }),
      };
      (initDB as any).mockResolvedValue({
        documents: collection,
        bookmarks: collection,
      });

      await (service as any).startSync();
      const messages = send.mock.calls.map((c: unknown[]) =>
        JSON.parse(c[0] as string),
      );
      const syncStarts = messages.filter((message: any) => message.type === "sync_start");
      expect(syncStarts[0].type).toBe("sync_start");
      expect(syncStarts[0].hasMore).toBe(false);
      expect(syncStarts[0].batchIndex).toBe(0);
      expect(messages.some((m: any) => m.type === "sync_chunk")).toBe(true);
      expect((service as any).currentState).toBe("syncing");
      expect(progress).toHaveBeenCalledWith(10);
    });

    it("startSync paginates and waits for an acknowledgement before the next batch", async () => {
      const send = vi.fn();
      (service as any).dataChannel = {
        readyState: "open",
        send,
        bufferedAmount: 0,
        close: vi.fn(),
        onopen: null,
        onclose: null,
        onmessage: null,
      };
      const { initDB } = await import("../../db/database");
      let queryCount = 0;
      const firstPage = Array.from({ length: 501 }, (_, i) => ({
        toJSON: () => ({ id: `doc-${i}` }),
      }));
      const secondPage = [{ toJSON: () => ({ id: "doc-500" }) }];
      const collection = {
        find: vi.fn(() => ({
          exec: vi.fn().mockImplementation(async () => {
            queryCount++;
            return queryCount === 1 ? firstPage : queryCount === 2 ? [] : secondPage;
          }),
        })),
      };
      (initDB as any).mockResolvedValue({
        documents: collection,
        bookmarks: { find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })) },
      });

      const syncPromise = (service as any).startSync();
      await vi.waitFor(() => {
        expect(send.mock.calls.some((call: unknown[]) =>
          JSON.parse(call[0] as string).type === "sync_capabilities",
        )).toBe(true);
      });
      await (service as any).handleIncomingMessage({
        type: "sync_capabilities_ack",
        paginated: true,
      });
      await vi.waitFor(() => {
        expect(send.mock.calls.some((call: unknown[]) =>
          JSON.parse(call[0] as string).type === "sync_start",
        )).toBe(true);
      });
      const starts = send.mock.calls
        .map((call: unknown[]) => JSON.parse(call[0] as string))
        .filter((message: any) => message.type === "sync_start");
      expect(starts[0].hasMore).toBe(true);
      expect(starts[0].batchIndex).toBe(0);
      const firstBatchId = starts[0].batchId;
      expect(firstBatchId).toEqual(expect.any(String));

      await (service as any).handleIncomingMessage({
        type: "sync_ack",
        batchId: firstBatchId,
      });
      await syncPromise;
      const finalStart = send.mock.calls
        .map((call: unknown[]) => JSON.parse(call[0] as string))
        .filter((message: any) => message.type === "sync_start")
        .at(-1);
      expect(finalStart.hasMore).toBe(false);
      expect(finalStart.batchIndex).toBe(1);
    });

    it("receiver acknowledges a non-final page and completes only on the final page", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      const send = vi.fn();
      (service as any).dataChannel = {
        readyState: "open",
        send,
        bufferedAmount: 0,
        close: vi.fn(),
      };
      const page = JSON.stringify({ type: "sync_data", documents: [{ id: "d-page" }], bookmarks: [] });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [page];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;
      (service as any).expectedBatchId = "batch-1";
      (service as any).expectedHasMore = true;

      await (service as any).processReceivedData();
      expect(send).toHaveBeenCalledWith(JSON.stringify({ type: "sync_ack", batchId: "batch-1" }));
      expect((service as any).currentState).toBe("syncing");

      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [page];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;
      (service as any).expectedBatchId = "batch-2";
      (service as any).expectedHasMore = false;
      await (service as any).processReceivedData();
      expect((service as any).currentState).toBe("completed");
    });

    it("startSync works without registered progress callback", async () => {
      const send = vi.fn();
      (service as any).dataChannel = {
        readyState: "open",
        send,
        bufferedAmount: 0,
        close: vi.fn(),
        onopen: null,
        onclose: null,
        onmessage: null,
      };

      const { initDB } = await import("../../db/database");
      const collection = {
        find: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      };
      (initDB as any).mockResolvedValue({
        documents: collection,
        bookmarks: collection,
      });

      await (service as any).startSync();
      const messages = send.mock.calls.map((c: unknown[]) =>
        JSON.parse(c[0] as string),
      );
      const syncStarts = messages.filter((message: any) => message.type === "sync_start");
      expect(syncStarts[0].type).toBe("sync_start");
      expect(syncStarts[0].hasMore).toBe(false);
      expect(messages.some((m: any) => m.type === "sync_chunk")).toBe(true);
      expect((service as any).currentState).toBe("syncing");
    });

    it("startSync excludes private documents and bookmarks from sync (P-1)", async () => {
      const send = vi.fn();
      (service as any).dataChannel = {
        readyState: "open",
        send,
        bufferedAmount: 0,
        close: vi.fn(),
        onopen: null,
        onclose: null,
        onmessage: null,
      };
      const { initDB } = await import("../../db/database");
      const docFind = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      const bmFind = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      (initDB as any).mockResolvedValue({
        documents: { find: docFind },
        bookmarks: { find: bmFind },
      });

      await (service as any).startSync();

      // find() receives { selector, sort, limit } — P-1 requires both
      // selectors to exclude private content so it never leaves the device.
      const tombstoneDoc = { id: "del-1", isDeleted: true, updatedAt: "2026-08-13T10:00:00.000Z" };
      const privateDoc = { id: "priv-1", isPrivate: true, updatedAt: "2026-08-13T10:00:00.000Z" };
      const normalDoc = { id: "ok-1", updatedAt: "2026-08-13T10:00:00.000Z" };
      const sent: Record<string, unknown>[] = [];
      // The mock simulates RxDB applying the sender's selector: private docs
      // are filtered out, tombstones (isDeleted: true) are NOT — they travel.
      const senderDocs: Array<{
        id: string;
        isPrivate?: boolean;
        isDeleted?: boolean;
        updatedAt: string;
      }> = [tombstoneDoc, privateDoc, normalDoc];
      const senderCollection = {
        find: vi.fn((query: { selector: { isPrivate?: boolean } }) => ({
          exec: vi.fn().mockResolvedValue(
            senderDocs
              .filter((d) => d.isPrivate !== true)
              .map((d) => ({ toJSON: () => d })),
          ),
        })),
      };
      (initDB as any).mockResolvedValue({
        documents: senderCollection,
        bookmarks: { find: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }) },
      });
      const send2 = vi.fn();
      (service as any).dataChannel = {
        readyState: "open",
        send: send2,
        bufferedAmount: 0,
        close: vi.fn(),
        onopen: null,
        onclose: null,
        onmessage: null,
      };
      await (service as any).startSync();
      for (const call of send2.mock.calls) {
        const msg = JSON.parse(String(call[0]));
        if (msg.type === "sync_chunk") {
          const parsed = JSON.parse(msg.data);
          sent.push(...(parsed.documents ?? []));
        }
      }
      // Tombstone (isDeleted) travels; private never leaves the device.
      expect(sent.some((d) => d.id === "del-1" && d.isDeleted === true)).toBe(true);
      expect(sent.some((d) => d.id === "priv-1")).toBe(false);
      expect(sent.some((d) => d.id === "ok-1")).toBe(true);

      const docCall = docFind.mock.calls[0]?.[0] as { selector: Record<string, unknown> } | undefined;
      const bmCall = bmFind.mock.calls[0]?.[0] as { selector: Record<string, unknown> } | undefined;
      expect(docCall?.selector.isPrivate).toBe(false);
      // Tombstones: deleted docs (isDeleted: true) ARE sent so removals
      // propagate and are applied LWW by the receiver. Filtering them here
      // resurrects locally deleted docs from the peer's stale mirror.
      expect(docCall?.selector.isDeleted).toBeUndefined();
      expect(bmCall?.selector.isPrivate).toBe(false);
      expect(bmCall?.selector.isDeleted).toBeUndefined();
    });

    it("syncs a document after an explicit private-to-public transition", async () => {
      const send = vi.fn();
      (service as any).dataChannel = {
        readyState: "open",
        send,
        bufferedAmount: 0,
        close: vi.fn(),
        onopen: null,
        onclose: null,
        onmessage: null,
      };
      const { initDB } = await import("../../db/database");
      let isPrivate = true;
      const document = {
        id: "transition-doc",
        title: "Explicitly shared document",
        updatedAt: "2026-08-16T10:00:00.000Z",
      };
      const docFind = vi.fn((query: { selector: Record<string, unknown> }) => ({
        exec: vi.fn().mockResolvedValue(
          isPrivate
            ? []
            : [{ toJSON: () => ({ ...document, isPrivate: false }) }],
        ),
      }));
      const emptyBookmarks = {
        find: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
      };
      (initDB as any).mockResolvedValue({
        documents: { find: docFind },
        bookmarks: emptyBookmarks,
      });

      const extractDocuments = () =>
        send.mock.calls
          .map((call: unknown[]) => JSON.parse(String(call[0])))
          .filter((message: { type?: string }) => message.type === "sync_chunk")
          .flatMap((message: { data: string }) => JSON.parse(message.data).documents ?? []);

      await (service as any).startSync();
      expect(extractDocuments()).toEqual([]);
      expect(docFind.mock.calls[0]?.[0].selector.isPrivate).toBe(false);

      // The user explicitly changes the record's sharing state. A fresh sync
      // must query the now-public record rather than treating its old private
      // state as permanently local-only.
      isPrivate = false;
      send.mockClear();
      await (service as any).startSync();

      expect(extractDocuments()).toEqual([
        { ...document, isPrivate: false },
      ]);
      expect(docFind.mock.calls.at(-1)?.[0].selector.isPrivate).toBe(false);
    });

    it("startSync sets error when initDB fails", async () => {
      const { initDB } = await import("../../db/database");
      (initDB as any).mockRejectedValue(new Error("db fail"));
      (service as any).dataChannel = {
        readyState: "open",
        send: vi.fn(),
        bufferedAmount: 0,
        close: vi.fn(),
        onopen: null,
        onclose: null,
        onmessage: null,
      };
      await (service as any).startSync();
      expect((service as any).currentState).toBe("error");
    });

    it("startSync sets error when initDB rejects with non-Error", async () => {
      const { initDB } = await import("../../db/database");
      (initDB as any).mockRejectedValue("string-error");
      (service as any).dataChannel = {
        readyState: "open",
        send: vi.fn(),
        bufferedAmount: 0,
        close: vi.fn(),
        onopen: null,
        onclose: null,
        onmessage: null,
      };
      await (service as any).startSync();
      expect((service as any).currentState).toBe("error");
    });

    it("rejects oversized or malformed sync fields before upsert", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      const payload = JSON.stringify({
        type: "sync_data",
        documents: [
          { id: "valid", title: "ok" },
          { id: "bad-title", title: "x".repeat(501) },
          { id: "bad-tags", tags: [123] },
          { id: "bad-embedding", embedding: [Infinity] },
        ],
        bookmarks: [],
      });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;
      await (service as any).processReceivedData();
      expect(upsert).not.toHaveBeenCalled();
      expect((service as any).currentState).toBe("error");
    });

    it("processReceivedData rejects array items in documents", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });

      const payload = JSON.stringify({
        type: "sync_data",
        documents: [["not-a-doc"]],
        bookmarks: [],
      });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();

      expect(upsert).not.toHaveBeenCalled();
      expect((service as any).currentState).toBe("error");
    });

    it("handleIncomingMessage processes all chunks and completes", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      const payload = JSON.stringify({
        type: "sync_data",
        documents: [{ id: "d1" }],
        bookmarks: [],
      });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = new Array(1);
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).handleIncomingMessage({
        type: "sync_chunk",
        index: 0,
        data: payload,
      });

      expect((service as any).currentState).toBe("completed");
    });
  });

  describe("adversarial sync protocol", () => {
    it("compares digest strings without early exit and rejects length changes", () => {
      expect(constantTimeStringEqual("a".repeat(64), "a".repeat(64))).toBe(true);
      expect(constantTimeStringEqual("a".repeat(63) + "b", "a".repeat(63) + "c")).toBe(false);
      expect(constantTimeStringEqual("a".repeat(64), "a".repeat(63))).toBe(false);
    });

    it("rejects partial HMAC metadata before any database write", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      const payload = JSON.stringify({ type: "sync_data", documents: [], bookmarks: [] });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = "ephemeral-key";
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();

      expect(upsert).not.toHaveBeenCalled();
      expect((service as any).currentState).toBe("error");
    });

    it("expires an incomplete transfer after bounded inactivity", async () => {
      vi.useFakeTimers();
      try {
        await (service as any).handleIncomingMessage({
          type: "sync_start",
          totalChunks: 2,
          checksum: "a".repeat(64),
          auth: "ephemeral-key",
          hmac: "b".repeat(64),
          batchId: "batch-timeout",
          batchIndex: 0,
          hasMore: false,
          syncSessionId: "session-timeout",
        });

        expect((service as any).incomingTransferTimer).not.toBeNull();
        vi.advanceTimersByTime(30_000);
        expect((service as any).currentState).toBe("error");
        expect((service as any).expectedChunks).toBe(0);
        expect((service as any).incomingTransferTimer).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("compares RxDB revision heights numerically during LWW fallback", () => {
      const lowerHeight = {
        id: "doc-1",
        _rev: "9-peer-a",
        updatedAt: "2026-08-15T00:00:00.000Z",
      };
      const higherHeight = {
        id: "doc-1",
        _rev: "10-peer-b",
        updatedAt: "2026-08-15T00:00:00.000Z",
      };

      expect(compareSyncVersions(lowerHeight, higherHeight)).toBeLessThan(0);
      expect(compareSyncVersions(higherHeight, lowerHeight)).toBeGreaterThan(0);
    });

    it("uses canonical payload ordering as the final LWW tie-break", () => {
      const left = {
        id: "same",
        updatedAt: "not-a-date",
        blocks: [{ text: "a" }],
      };
      const right = {
        id: "same",
        updatedAt: "not-a-date",
        blocks: [{ text: "b" }],
      };

      expect(compareSyncVersions(left, right)).toBeLessThan(0);
      expect(compareSyncVersions(right, left)).toBeGreaterThan(0);
    });

    it("chooses the same LWW winner for N peers regardless of arrival order", () => {
      const statesArbitrary = fc.array(
        fc.record({
          rev: fc.string({ minLength: 1, maxLength: 24 }),
          id: fc.constant("doc-1"),
          updatedAt: fc.constant("2026-08-15T00:00:00.000Z"),
        }),
        { minLength: 2, maxLength: 8 },
      ).map((states) =>
        states.map((state, index) => ({
          ...state,
          _rev: `${index + 1}-${state.rev}`,
          blocks: [{ id: `peer-${index}` }],
        })),
      );

      fc.assert(
        fc.property(statesArbitrary, (states) => {
          const pickWinner = (left: Record<string, unknown>, right: Record<string, unknown>) =>
            compareSyncVersions(left, right) >= 0 ? left : right;
          const forward = states.slice(1).reduce(pickWinner, states[0]!);
          const reverse = states.slice().reverse().slice(1).reduce(pickWinner, states[states.length - 1]!);
          expect(forward).toEqual(reverse);
          expect(forward).toEqual(
            states.reduce(pickWinner, states[0]!),
          );
        }),
        { numRuns: 100, endOnFailure: true },
      );
    });

    it("rejects a private incoming record before any database write", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [JSON.stringify({
        type: "sync_data",
        documents: [{ id: "private", isPrivate: true, updatedAt: "2026-08-15T00:00:00.000Z" }],
        bookmarks: [],
      })];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();

      expect(upsert).not.toHaveBeenCalled();
      expect((service as any).currentState).toBe("error");
    });

    it("does not overwrite a local private record with a remote tombstone", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert, [{
          id: "private",
          get: (field: string) => field === "isPrivate" ? true : "2026-08-15T00:00:00.000Z",
        }]),
        bookmarks: mockSyncCollection(upsert),
      });
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [JSON.stringify({
        type: "sync_data",
        documents: [{ id: "private", isDeleted: true, updatedAt: "2026-08-15T00:00:00.000Z" }],
        bookmarks: [],
      })];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();

      expect(upsert).not.toHaveBeenCalled();
      expect((service as any).currentState).toBe("completed");
    });

    it("rejects a conflicting duplicate chunk instead of replacing verified bytes", async () => {
      (service as any).expectedChunks = 2;
      (service as any).incomingBuffer = new Array(2);
      await (service as any).handleIncomingMessage({ type: "sync_chunk", index: 0, data: "first" });
      await (service as any).handleIncomingMessage({ type: "sync_chunk", index: 0, data: "tampered" });
      expect((service as any).currentState).toBe("error");
      expect((service as any).incomingBuffer).toEqual([]);
    });

    it("isValidSyncDoc rejects unparseable and far-future updatedAt timestamps", () => {
      const base = {
        id: "d1",
        folderId: "f1",
        title: "t",
        blocks: [],
        tags: [],
        links: [],
        processed: false,
        isPrivate: false,
        isDeleted: false,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-13T10:00:00.000Z",
      };
      expect(
        isValidSyncDoc({ ...base, updatedAt: "not-a-date" }, "documents", true),
      ).toBe(false);
      expect(
        isValidSyncDoc(
          { ...base, updatedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() },
          "documents",
          true,
        ),
      ).toBe(false);
      expect(
        isValidSyncDoc(
          { ...base, updatedAt: new Date(Date.now() + 60 * 1000).toISOString() },
          "documents",
          true,
        ),
      ).toBe(true);
      expect(
        isValidSyncDoc({ ...base, updatedAt: "2026-08-13T10:00:00.000Z" }, "documents", true),
      ).toBe(true);
    });

    it("rejects a doc with a far-future updatedAt before any database write (LWW poisoning)", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [JSON.stringify({
        type: "sync_data",
        documents: [{ id: "future-doc", updatedAt: future }],
        bookmarks: [],
      })];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();

      expect(upsert).not.toHaveBeenCalled();
      expect((service as any).currentState).toBe("error");
    });

    it("accepts a doc whose updatedAt is within the bounded clock-skew tolerance", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      const skew = new Date(Date.now() + 60 * 1000).toISOString();
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [JSON.stringify({
        type: "sync_data",
        documents: [{ id: "skew-doc", updatedAt: skew }],
        bookmarks: [],
      })];
      (service as any).expectedChecksum = "";
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();

      expect(upsert).toHaveBeenCalledTimes(1);
    });

    it("rejects a replayed completed sync session", async () => {
      (service as any).completedSyncSessions.add("session-complete");
      await (service as any).handleIncomingMessage({
        type: "sync_start",
        totalChunks: 1,
        checksum: "a".repeat(64),
        auth: "auth",
        hmac: "b".repeat(64),
        batchId: "batch-replay",
        batchIndex: 0,
        hasMore: false,
        syncSessionId: "session-complete",
      });
      expect((service as any).currentState).toBe("error");
      expect((service as any).expectedChunks).toBe(0);
    });

    it("bounds raw data-channel frames before JSON parsing", async () => {
      const dc = mockPC.createDataChannel("test");
      (service as any).dataChannel = dc;
      (service as any).setupDataChannel();
      await dc.onmessage({ data: "x".repeat(16_384 * 8 + 1) });
      expect((service as any).currentState).toBe("error");
    });
  });

  describe("incremental sync cursor (QR delta redesign)", () => {
    const CURSOR_KEY = "bmf_webrtc_sync_last_at";
    const CURSOR = "2026-08-13T10:00:00.000Z";
    const sha256Hex = async (payload: string): Promise<string> => {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(payload),
      );
      return Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    };
    // Strict-mode documents collection shape (isValidSyncDoc requires every
    // field when checksum-strict), with an updatedAt that also drives the
    // incremental cursor advance.
    const strictDoc = (id: string, updatedAt: string) => ({
      id,
      folderId: "f1",
      title: "t",
      blocks: [],
      tags: [],
      links: [],
      processed: false,
      isPrivate: false,
      isDeleted: false,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt,
    });
    const strictBookmark = (id: string, updatedAt: string) => ({
      id,
      url: "https://example.com",
      title: "t",
      tags: [],
      relatedLinks: [],
      processed: false,
      isPrivate: false,
      isDeleted: false,
      visitCount: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt,
    });
    // Drive a full outbound sync against a sender collection whose find()
    // captures the selector, returning the given docs.
    const runOutboundSync = async ({
      docs,
      bookmarks,
      ack,
    }: {
      docs: Array<Record<string, unknown>>;
      bookmarks: Array<Record<string, unknown>>;
      ack: Record<string, unknown>;
    }) => {
      const { initDB } = await import("../../db/database");
      const send = vi.fn();
      (service as any).dataChannel = {
        readyState: "open",
        send,
        bufferedAmount: 0,
        close: vi.fn(),
      };
      const selectors: Array<Record<string, unknown>> = [];
      const senderCollection = (rows: Array<Record<string, unknown>>) => {
        // Keyset pagination: each collection's first page returns its rows
        // and the next is empty, so `hasMore` is false and the send loop
        // stops after one batch. The page counter is per collection, so the
        // bookmarks query can no longer silently empty the documents page.
        let page = 0;
        return {
          find: vi.fn((query: { selector: Record<string, unknown> }) => {
            selectors.push(query.selector);
            const pageRows = page === 0 ? rows : [];
            page++;
            return {
              exec: vi.fn().mockResolvedValue(
                pageRows.map((row) => ({ toJSON: () => row })),
              ),
            };
          }),
        };
      };
      (initDB as any).mockResolvedValue({
        documents: senderCollection(docs),
        bookmarks: senderCollection(bookmarks),
      });
      const syncPromise = (service as any).startSync();
      await (service as any).handleIncomingMessage(ack);
      await syncPromise;
      // Reassemble what actually crossed the wire: the sender streams the
      // payload as sync_chunk frames, so concatenating their `data` rebuilds
      // the sync_data payload the peer receives.
      const transferred = send.mock.calls
        .map((call: unknown[]) => JSON.parse(call[0] as string))
        .filter((frame: { type?: string }) => frame.type === "sync_chunk")
        .map((frame: { data: string }) => frame.data)
        .join("");
      const sentPayload = transferred
        ? (JSON.parse(transferred) as {
            documents: Array<{ id: string }>;
            bookmarks: Array<{ id: string }>;
          })
        : { documents: [], bookmarks: [] };
      return { send, selectors, sentPayload };
    };

    it("sender filters documents by the peer's cursor (updatedAt >= lastSyncAt)", async () => {
      const { selectors, sentPayload } = await runOutboundSync({
        docs: [{ id: "d1", updatedAt: "2026-08-13T11:00:00.000Z" }],
        bookmarks: [],
        ack: { type: "sync_capabilities_ack", paginated: true, lastSyncAt: CURSOR },
      });
      expect(selectors).toHaveLength(2); // documents + bookmarks
      expect(selectors[0]!.updatedAt).toEqual({ $gte: CURSOR });
      expect(selectors[1]!.updatedAt).toEqual({ $gte: CURSOR });
      // P-1 is unchanged: the incremental filter is additive, private docs
      // still never leave the device.
      expect(selectors[0]!.isPrivate).toBe(false);
      expect(selectors[1]!.isPrivate).toBe(false);
      // The query result must actually cross the wire: a mock that returns
      // documents but sends none would leave this test green while proving
      // nothing about the incremental transfer.
      expect(sentPayload.documents.map((d) => d.id)).toEqual(["d1"]);
    });

    it("sender sends a full snapshot when the peer advertises no cursor (first pairing)", async () => {
      const { selectors, sentPayload } = await runOutboundSync({
        docs: [{ id: "d1", updatedAt: "2026-08-13T11:00:00.000Z" }],
        bookmarks: [],
        ack: { type: "sync_capabilities_ack", paginated: true },
      });
      expect(selectors).toHaveLength(2);
      expect(selectors[0]!.updatedAt).toBeUndefined();
      expect(selectors[1]!.updatedAt).toBeUndefined();
      expect(sentPayload.documents.map((d) => d.id)).toEqual(["d1"]);
    });

    it("the capability frames carry this device's durable cursor", async () => {
      const { initDB } = await import("../../db/database");
      const send = vi.fn();
      (service as any).dataChannel = {
        readyState: "open",
        send,
        bufferedAmount: 0,
        close: vi.fn(),
      };
      localStorage.setItem(CURSOR_KEY, CURSOR);
      (initDB as any).mockResolvedValue({
        documents: { count: () => ({ exec: vi.fn().mockResolvedValue(3) }) },
        bookmarks: { count: () => ({ exec: vi.fn().mockResolvedValue(5) }) },
      });

      // The ACK sent in response to the peer's capabilities frame advertises
      // the cursor (it must reach the peer even if its frame arrives first).
      await (service as any).handleIncomingMessage({
        type: "sync_capabilities",
        paginated: true,
      });
      const ack = send.mock.calls
        .map((call: unknown[]) => JSON.parse(call[0] as string))
        .find((m: any) => m.type === "sync_capabilities_ack");
      expect(ack?.lastSyncAt).toBe(CURSOR);

      // The outbound capabilities frame advertises the cursor too.
      send.mockClear();
      const syncPromise = (service as any).startSync();
      await vi.waitFor(() => {
        const caps = send.mock.calls
          .map((call: unknown[]) => JSON.parse(call[0] as string))
          .find((m: any) => m.type === "sync_capabilities");
        expect(caps?.lastSyncAt).toBe(CURSOR);
      });
      await (service as any).handleIncomingMessage({
        type: "sync_capabilities_ack",
        paginated: true,
        lastSyncAt: CURSOR,
      });
      await syncPromise;
    });

    it("a fresh/recreated vault (empty local store) advertises no cursor so the peer resends its full snapshot", async () => {
      const { initDB } = await import("../../db/database");
      localStorage.setItem(CURSOR_KEY, CURSOR);
      (initDB as any).mockResolvedValue({
        documents: { count: () => ({ exec: vi.fn().mockResolvedValue(0) }) },
        bookmarks: { count: () => ({ exec: vi.fn().mockResolvedValue(0) }) },
      });
      expect(await (service as any).readAdvertisedCursor()).toBeNull();

      // A non-empty local store keeps advertising the stored cursor.
      (initDB as any).mockResolvedValue({
        documents: { count: () => ({ exec: vi.fn().mockResolvedValue(1) }) },
        bookmarks: { count: () => ({ exec: vi.fn().mockResolvedValue(0) }) },
      });
      expect(await (service as any).readAdvertisedCursor()).toBe(CURSOR);
    });

    it("receiver persists the max received updatedAt as its new cursor on a completed sync", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      const docs = [
        strictDoc("d1", "2026-08-13T08:00:00.000Z"),
        strictDoc("d2", "2026-08-13T09:30:00.000Z"),
      ];
      const payload = JSON.stringify({ type: "sync_data", documents: docs, bookmarks: [] });
      const checksum = await sha256Hex(payload);
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = checksum;
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();

      expect((service as any).currentState).toBe("completed");
      expect(localStorage.getItem(CURSOR_KEY)).toBe("2026-08-13T09:30:00.000Z");
    });

    it("receiver does not advance the cursor on a non-final (paginated) batch", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      localStorage.setItem(CURSOR_KEY, "2026-08-13T07:00:00.000Z");
      const payload = JSON.stringify({
        type: "sync_data",
        documents: [strictDoc("d1", "2026-08-13T09:30:00.000Z")],
        bookmarks: [],
      });
      const checksum = await sha256Hex(payload);
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = checksum;
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;
      (service as any).expectedBatchId = "batch-1";
      (service as any).expectedHasMore = true;

      await (service as any).processReceivedData();

      // Still mid-session: the stored cursor must not move (a failed or
      // interrupted transfer resends everything next time).
      expect((service as any).currentState).toBe("syncing");
      expect(localStorage.getItem(CURSOR_KEY)).toBe("2026-08-13T07:00:00.000Z");
    });

    it("an empty final batch leaves the stored cursor untouched", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      localStorage.setItem(CURSOR_KEY, "2026-08-13T07:00:00.000Z");
      const payload = JSON.stringify({ type: "sync_data", documents: [], bookmarks: [] });
      const checksum = await sha256Hex(payload);
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = checksum;
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();

      expect((service as any).currentState).toBe("completed");
      expect(localStorage.getItem(CURSOR_KEY)).toBe("2026-08-13T07:00:00.000Z");
    });

    it("rejects a far-future-dated peer doc at validation (LWW poisoning and cursor starvation blocked)", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      const payload = JSON.stringify({
        type: "sync_data",
        documents: [strictDoc("d-future", "2099-01-01T00:00:00.000Z")],
        bookmarks: [],
      });
      const checksum = await sha256Hex(payload);
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = checksum;
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();

      // Fail-closed: the doc never reaches the DB (no LWW poisoning) and the
      // cursor never advances past the device clock (no send starvation).
      expect(upsert).not.toHaveBeenCalled();
      expect((service as any).currentState).toBe("error");
      expect(localStorage.getItem(CURSOR_KEY)).toBeNull();
    });

    it("clamps the stored cursor to this device's clock for an in-tolerance future-dated peer doc", async () => {
      const { initDB } = await import("../../db/database");
      const upsert = vi.fn().mockResolvedValue({});
      (initDB as any).mockResolvedValue({
        documents: mockSyncCollection(upsert),
        bookmarks: mockSyncCollection(upsert),
      });
      // Within the 5-minute clock tolerance, so validation accepts the doc;
      // the persisted cursor must still never advance beyond the local clock.
      const nearFuture = new Date(Date.now() + 60_000).toISOString();
      const payload = JSON.stringify({
        type: "sync_data",
        documents: [strictDoc("d-skew", nearFuture)],
        bookmarks: [],
      });
      const checksum = await sha256Hex(payload);
      (service as any).expectedChunks = 1;
      (service as any).incomingBuffer = [payload];
      (service as any).expectedChecksum = checksum;
      (service as any).expectedSyncAuth = null;
      (service as any).expectedPayloadHmac = null;

      await (service as any).processReceivedData();

      expect((service as any).currentState).toBe("completed");
      const stored = localStorage.getItem(CURSOR_KEY)!;
      expect(stored).not.toBe(nearFuture);
      expect(stored <= new Date().toISOString()).toBe(true);
    });
  });
});
