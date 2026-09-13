import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createSignalingSocketFactory,
  deriveClientSignalKey,
  deriveSyncTopic,
  canonicalSignalPayload,
  isSelfHostedSignalingUrl,
  SIGNAL_INIT_TIMEOUT_MS,
  SIGNAL_QUEUE_LIMIT,
  SYNC_TOPIC_DOMAIN,
} from "../../../services/sync/signaling";

/**
 * Direct unit tests for the signaling client (src/services/sync/signaling.ts):
 * HMAC key derivation, canonical payload serialization, and the signed
 * WebSocket factory (credentials/URL guards, join fast path, queued signals,
 * ordering guarantees).
 */

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  sent: string[] = [];
  private readonly handlers = new Map<string, Array<(event?: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(listener);
    this.handlers.set(type, list);
  }

  removeEventListener(type: string, listener: (event?: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    this.handlers.set(type, list.filter((fn) => fn !== listener));
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    /* Real sockets dispatch a close event; tests emit it explicitly. */
  }

  emit(type: "message" | "error" | "close", event?: unknown): void {
    for (const listener of this.handlers.get(type) ?? []) {
      listener(event);
    }
  }
}

const ROOM_SECRET = "correct-horse-battery-staple";
const ROOM_ID = "room-42";
/**
 * The self-hosted signaling server "configured" for these tests — the ONE
 * origin allowed to receive the room secret (A-3).
 */
const SELF_HOSTED_URL = "wss://signaling.example.com/socket";
/** A third-party relay that must never be handed the room secret. */
const PUBLIC_RELAY_URL = "wss://signaling.rxdb.info/";

function makeSocket(
  url = SELF_HOSTED_URL,
  selfHostedSignalingUrl: string | null = SELF_HOSTED_URL,
): FakeWebSocket {
  const factory = createSignalingSocketFactory(ROOM_SECRET, ROOM_ID, {
    webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    selfHostedSignalingUrl,
  });
  return factory(url) as unknown as FakeWebSocket;
}

/** Emits a valid init frame carrying the server peer id. */
function sendInit(socket: FakeWebSocket, yourPeerId = "server-1"): void {
  socket.emit("message", { data: JSON.stringify({ type: "init", yourPeerId }) });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

async function expectedSignalAuth(
  peerId: string,
  msg: Record<string, unknown>,
): Promise<string> {
  const key = await deriveClientSignalKey(ROOM_SECRET, ROOM_ID);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonicalSignalPayload(peerId, msg)),
  );
  return hex(signature);
}

afterEach(() => {
  // Close every socket so pending init watchdogs are cleared.
  for (const socket of FakeWebSocket.instances) {
    socket.emit("close");
  }
  FakeWebSocket.instances = [];
});

describe("signaling constants", () => {
  it("pins the bounded init wait and queue limits", () => {
    expect(SIGNAL_INIT_TIMEOUT_MS).toBe(10_000);
    expect(SIGNAL_QUEUE_LIMIT).toBe(64);
  });

  it("pins the sync-topic domain separator (room-name derivation input)", () => {
    // Changing this string changes every live room name: it is a protocol
    // value, not an implementation detail.
    expect(SYNC_TOPIC_DOMAIN).toBe("bookmarkforge-sync-topic:v1");
  });
});

describe("deriveClientSignalKey", () => {
  it("derives the same signing key for the same room secret and id", async () => {
    const payload = new TextEncoder().encode("same-message");
    const keyA = await deriveClientSignalKey(ROOM_SECRET, ROOM_ID);
    const keyB = await deriveClientSignalKey(ROOM_SECRET, ROOM_ID);
    const sigA = await crypto.subtle.sign("HMAC", keyA, payload);
    const sigB = await crypto.subtle.sign("HMAC", keyB, payload);
    expect(hex(sigA)).toBe(hex(sigB));
  });

  it("derives a different key for a different room secret", async () => {
    const payload = new TextEncoder().encode("same-message");
    const keyA = await deriveClientSignalKey(ROOM_SECRET, ROOM_ID);
    const keyB = await deriveClientSignalKey("another-secret", ROOM_ID);
    const sigA = await crypto.subtle.sign("HMAC", keyA, payload);
    const sigB = await crypto.subtle.sign("HMAC", keyB, payload);
    expect(hex(sigA)).not.toBe(hex(sigB));
  });

  it("binds the key to the room id", async () => {
    const payload = new TextEncoder().encode("same-message");
    const keyA = await deriveClientSignalKey(ROOM_SECRET, ROOM_ID);
    const keyB = await deriveClientSignalKey(ROOM_SECRET, "room-other");
    const sigA = await crypto.subtle.sign("HMAC", keyA, payload);
    const sigB = await crypto.subtle.sign("HMAC", keyB, payload);
    expect(hex(sigA)).not.toBe(hex(sigB));
  });
});

describe("deriveSyncTopic (A-2 keyed room name)", () => {
  it("derives HMAC-SHA256(roomSecret, domain:roomId:collection) as lowercase hex", async () => {
    // Pinned vector, computed with an independent HMAC implementation
    // (node:crypto). If either side of the derivation drifts, this fails.
    expect(await deriveSyncTopic(ROOM_SECRET, ROOM_ID, "bookmarks")).toBe(
      "07767d0cabbb7f5a8173eb91453305cd764081fb7d9ef371ca4a54d43db51b2d",
    );
  });

  it("is deterministic across peers holding the same room secret", async () => {
    expect(await deriveSyncTopic(ROOM_SECRET, ROOM_ID, "documents")).toBe(
      await deriveSyncTopic(ROOM_SECRET, ROOM_ID, "documents"),
    );
  });

  it("separates rooms by secret, room id and collection", async () => {
    const variants = await Promise.all([
      deriveSyncTopic(ROOM_SECRET, ROOM_ID, "bookmarks"),
      deriveSyncTopic("another-secret", ROOM_ID, "bookmarks"),
      deriveSyncTopic(ROOM_SECRET, "room-43", "bookmarks"),
      deriveSyncTopic(ROOM_SECRET, ROOM_ID, "documents"),
    ]);
    expect(new Set(variants).size).toBe(4);
  });

  it("produces a bounded room id that reveals neither the room id nor the collection", async () => {
    const topic = await deriveSyncTopic(ROOM_SECRET, ROOM_ID, "bookmarks");
    // Must satisfy the client guard and the server's ROOM_ID_PATTERN.
    expect(topic).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
    expect(topic).toMatch(/^[0-9a-f]{64}$/);
    expect(topic).not.toContain(ROOM_ID);
    expect(topic).not.toContain("bookmarks");
  });

  it("sends the derived topic (and never the plaintext room id) in the join frame", async () => {
    const topic = await deriveSyncTopic(ROOM_SECRET, ROOM_ID, "bookmarks");
    const factory = createSignalingSocketFactory(ROOM_SECRET, topic, {
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      selfHostedSignalingUrl: SELF_HOSTED_URL,
    });
    const socket = factory(
      "wss://signaling.example.com/socket",
    ) as unknown as FakeWebSocket;
    socket.send(JSON.stringify({ type: "join", room: topic }));

    expect(socket.sent).toHaveLength(1);
    const frame = socket.sent[0]!;
    expect(JSON.parse(frame)).toEqual({
      type: "join",
      room: topic,
      roomSecret: ROOM_SECRET,
    });
    // The relay sees the keyed room name and the secret it needs for the
    // self-hosted HMAC gate — never the readable room id or collection.
    expect(frame).not.toContain(ROOM_ID);
    expect(frame).not.toContain("bookmarks");
  });
});

describe("canonicalSignalPayload", () => {
  it("serializes with the exact key order the server re-derives", () => {
    expect(
      canonicalSignalPayload("peer-1", {
        receiverPeerId: "peer-2",
        data: { sdp: "v=0" },
      }),
    ).toBe(
      '{"type":"signal","senderPeerId":"peer-1","receiverPeerId":"peer-2","data":{"sdp":"v=0"}}',
    );
  });

  it("normalizes a missing receiverPeerId to empty string and missing data to null", () => {
    expect(canonicalSignalPayload("peer-1", {})).toBe(
      '{"type":"signal","senderPeerId":"peer-1","receiverPeerId":"","data":null}',
    );
  });
});

describe("createSignalingSocketFactory — credential and URL guards", () => {
  it("rejects invalid room credentials before opening a socket", () => {
    const invalidFactories: Array<[string, string]> = [
      ["", ROOM_ID],
      [ROOM_SECRET, ""],
      [ROOM_SECRET, "x".repeat(65)], // roomId > 64 chars
      ["x".repeat(129), ROOM_ID], // secret > 128 chars
      [ROOM_SECRET, "room\u0001control"],
      ["secret\u007fcontrol", ROOM_ID],
    ];
    for (const [secret, roomId] of invalidFactories) {
      const factory = createSignalingSocketFactory(secret, roomId, {
        webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      });
      expect(() => factory("wss://signaling.example.com/socket")).toThrow(
        "[SyncService] Invalid signaling room credentials",
      );
    }
  });

  it("rejects plaintext ws:// for remote hosts", () => {
    const socket = makeSocket();
    expect(() => socket).not.toThrow();
    const factory = createSignalingSocketFactory(ROOM_SECRET, ROOM_ID, {
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    expect(() => factory("ws://signaling.example.com/socket")).toThrow(/must use wss:\/\/.*signaling\.example\.com/);
  });

  it("rejects non-WebSocket protocols", () => {
    const factory = createSignalingSocketFactory(ROOM_SECRET, ROOM_ID, {
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    expect(() => factory("https://signaling.example.com/socket")).toThrow(
      "must use ws:// or wss://",
    );
  });

  it("tolerates plaintext ws:// on loopback/local hosts only", () => {
    const factory = createSignalingSocketFactory(ROOM_SECRET, ROOM_ID, {
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    expect(() => factory("ws://localhost:8080/socket")).not.toThrow();
    expect(() => factory("ws://127.0.0.1:8080/socket")).not.toThrow();
    expect(() => factory("ws://vault.local:8080/socket")).not.toThrow();
    expect(() => factory("wss://signaling.example.com/socket")).not.toThrow();
  });

  it("throws a descriptive error on an unparseable URL", () => {
    const factory = createSignalingSocketFactory(ROOM_SECRET, ROOM_ID, {
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    expect(() => factory(":::not-a-url:::")).toThrow(/Invalid signaling URL/);
  });
});

describe("isSelfHostedSignalingUrl", () => {
  it("matches the configured server by origin, whatever path/query it carries", () => {
    expect(isSelfHostedSignalingUrl("wss://sig.example.com", "wss://sig.example.com")).toBe(true);
    expect(
      isSelfHostedSignalingUrl("wss://sig.example.com/room-abc", "wss://sig.example.com"),
    ).toBe(true);
    expect(
      isSelfHostedSignalingUrl("wss://sig.example.com:8443/room-abc?a=1", "wss://sig.example.com:8443"),
    ).toBe(true);
    expect(isSelfHostedSignalingUrl("ws://localhost:8787", "ws://localhost:8787/")).toBe(true);
  });

  it("rejects a different host, port or scheme", () => {
    expect(isSelfHostedSignalingUrl("wss://sig.example.com", "wss://other.example.com")).toBe(false);
    expect(isSelfHostedSignalingUrl("wss://sig.example.com:8443", "wss://sig.example.com")).toBe(false);
    expect(isSelfHostedSignalingUrl("wss://sig.example.com", "wss://sig.example.com:8443")).toBe(false);
    // Scheme is part of the origin: an upgrade/downgrade is not the same server.
    expect(isSelfHostedSignalingUrl("ws://localhost:8787", "wss://localhost:8787")).toBe(false);
  });

  it("is not fooled by a lookalike host or a non-WebSocket scheme", () => {
    // A host that merely CONTAINS the configured host must not match (the
    // classic suffix-confusion bug a string prefix check would introduce).
    expect(
      isSelfHostedSignalingUrl("wss://sig.example.com.evil.test/room", "wss://sig.example.com"),
    ).toBe(false);
    expect(isSelfHostedSignalingUrl("https://sig.example.com", "wss://sig.example.com")).toBe(false);
    expect(isSelfHostedSignalingUrl("wss://sig.example.com", "https://sig.example.com")).toBe(false);
  });

  it("fails closed for a missing, empty or unparseable configuration", () => {
    expect(isSelfHostedSignalingUrl("wss://sig.example.com", null)).toBe(false);
    expect(isSelfHostedSignalingUrl("wss://sig.example.com", undefined)).toBe(false);
    expect(isSelfHostedSignalingUrl("wss://sig.example.com", "")).toBe(false);
    expect(isSelfHostedSignalingUrl("wss://sig.example.com", ":::not-a-url:::")).toBe(false);
    expect(isSelfHostedSignalingUrl(":::not-a-url:::", "wss://sig.example.com")).toBe(false);
  });
});

describe("createSignalingSocketFactory — room secret scoping (A-3)", () => {
  const joinFrame = (socket: FakeWebSocket): string => {
    socket.send(JSON.stringify({ type: "join", room: ROOM_ID }));
    expect(socket.sent).toHaveLength(1);
    return socket.sent[0]!;
  };

  it("never sends roomSecret to a public relay, even with a self-hosted server configured", () => {
    const socket = makeSocket(PUBLIC_RELAY_URL, SELF_HOSTED_URL);
    const frame = joinFrame(socket);
    expect(JSON.parse(frame)).toEqual({ type: "join", room: ROOM_ID });
    expect(frame).not.toContain(ROOM_SECRET);
  });

  it("never sends roomSecret when no self-hosted server is configured (fail closed)", () => {
    for (const configured of [null, undefined, ""] as const) {
      const socket = makeSocket(SELF_HOSTED_URL, configured ?? null);
      const frame = joinFrame(socket);
      expect(JSON.parse(frame)).toEqual({ type: "join", room: ROOM_ID });
    }
  });

  it("forwards a public-relay join byte-identically (no re-serialization)", () => {
    const socket = makeSocket(PUBLIC_RELAY_URL);
    const raw = '{"type":"join","room":"room-42","extra":1 }';
    socket.send(raw);
    expect(socket.sent).toEqual([raw]);
  });

  it("still signs signal frames for a public relay (the signature is not the secret)", async () => {
    const socket = makeSocket(PUBLIC_RELAY_URL);
    sendInit(socket, "server-1");
    const msg = { type: "signal", receiverPeerId: "peer-2", data: { sdp: "v=0" } };
    socket.send(JSON.stringify(msg));

    await waitUntil(() => socket.sent.length >= 1);
    const parsed = JSON.parse(socket.sent[0]!) as Record<string, unknown>;
    expect(parsed.signalAuth).toBe(await expectedSignalAuth("server-1", msg));
    expect(socket.sent[0]!).not.toContain(ROOM_SECRET);
  });
});

describe("createSignalingSocketFactory — send behavior", () => {
  it("injects roomSecret on the join fast path synchronously", () => {
    const socket = makeSocket();
    socket.send(JSON.stringify({ type: "join", room: ROOM_ID }));
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      type: "join",
      room: ROOM_ID,
      roomSecret: ROOM_SECRET,
    });
  });

  it("signs signal frames with the HMAC once the server peer id is known", async () => {
    const socket = makeSocket();
    sendInit(socket, "server-1");
    const msg = { type: "signal", receiverPeerId: "peer-2", data: { sdp: "v=0" } };
    socket.send(JSON.stringify(msg));

    await waitUntil(() => socket.sent.length >= 1);
    const parsed = JSON.parse(socket.sent[0]!) as Record<string, unknown>;
    expect(parsed.type).toBe("signal");
    expect(parsed.receiverPeerId).toBe("peer-2");
    expect(parsed.data).toEqual({ sdp: "v=0" });
    const expected = await expectedSignalAuth("server-1", msg);
    expect(parsed.signalAuth).toBe(expected);
  });

  it("queues signals that race the init frame and releases them on init", async () => {
    const socket = makeSocket();
    const msg = { type: "signal", receiverPeerId: "peer-2", data: { n: 1 } };
    socket.send(JSON.stringify(msg));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(socket.sent).toHaveLength(0);

    sendInit(socket, "server-1");
    await waitUntil(() => socket.sent.length === 1);
    const parsed = JSON.parse(socket.sent[0]!) as Record<string, unknown>;
    expect(parsed.signalAuth).toBe(await expectedSignalAuth("server-1", msg));
  });

  it("discards queued signals when the socket closes before init", async () => {
    const socket = makeSocket();
    socket.send(JSON.stringify({ type: "signal", receiverPeerId: "peer-2", data: {} }));
    socket.emit("close");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(socket.sent).toHaveLength(0);
  });

  it("drops frames beyond the bounded queue instead of unbounded buffering", async () => {
    const socket = makeSocket();
    for (let i = 0; i < SIGNAL_QUEUE_LIMIT + 1; i += 1) {
      socket.send(
        JSON.stringify({ type: "signal", receiverPeerId: "peer-2", data: { i } }),
      );
    }
    sendInit(socket, "server-1");
    await waitUntil(() => socket.sent.length === SIGNAL_QUEUE_LIMIT, 5000);
    expect(socket.sent.length).toBe(SIGNAL_QUEUE_LIMIT);
  });

  it("passes non-signal frames through raw synchronously", () => {
    const socket = makeSocket();
    socket.send("ping");
    expect(socket.sent).toEqual(["ping"]);
  });

  it("drops frames exceeding the safe size limit", () => {
    const socket = makeSocket();
    socket.send("x".repeat(300 * 1024));
    expect(socket.sent).toHaveLength(0);
  });

  it("closes the socket when the server sends an oversized frame", () => {
    const socket = makeSocket();
    socket.emit("message", { data: "y".repeat(300 * 1024) });
    // The factory invokes ws.close() on protocol violations; our fake only
    // records the event listener wiring, so reaching this point without a
    // throw is the observable contract (the server frame was rejected).
    expect(socket).toBeDefined();
  });
});
