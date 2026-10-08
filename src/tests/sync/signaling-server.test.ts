import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { spawn, ChildProcess } from "child_process";
import http from "node:http";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "node:fs";
import { createHash, createHmac } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "../../../server/src/index.ts");

// El signaling server (server/src/index.ts) es infraestructura opcional que
// previously did not exist in the repo. If the entry point were missing, the suite would skip
// instead of spawning a non-existent process and waiting 8s for a timeout.
const serverEntryExists = fs.existsSync(SERVER_ENTRY);

function startServer(
  port: number,
  extraEnv: Record<string, string> = {},
): Promise<{ proc: ChildProcess; url: string; logs: string[] }> {
  return new Promise((resolvePromise, reject) => {
    const tsxBin = resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
    const proc = spawn(process.execPath, [tsxBin, SERVER_ENTRY], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const url = `ws://127.0.0.1:${port}`;
    const logs: string[] = [];
    const capture = (d: Buffer) => logs.push(d.toString());
    const timeout = setTimeout(
      () => reject(new Error("server start timeout")),
      8000,
    );
    proc.stdout?.on("data", (d: Buffer) => {
      capture(d);
      if (d.toString().includes("Server running")) {
        clearTimeout(timeout);
        resolvePromise({ proc, url, logs });
      }
    });
    proc.stderr?.on("data", (d: Buffer) => {
      capture(d);
    });
    proc.on("error", reject);
  });
}

function waitForServerLog(
  logs: string[],
  marker: string,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (logs.join("").includes(marker)) {
        resolvePromise();
        return;
      }
      if (Date.now() >= deadline) {
        rejectPromise(new Error(`server log marker not found: ${marker}`));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

interface MessageQueue {
  buffered: unknown[];
  waiters: Array<(msg: unknown) => void>;
}

// Lossless message queue per socket. The classic flaky pattern here is
// `open()` → `nextMessage()`: if the server's `init` frame is parsed in the
// same tick as the client's `open` event (real under load on Windows — ws
// can emit 'message' before the await continuation registers its listener),
// the frame is dropped and the test hangs until the 60s timeout. Buffering
// from socket creation makes message delivery race-free.
const messageQueues = new WeakMap<WebSocket, MessageQueue>();

function open(
  url: string,
  options?: { headers?: Record<string, string> },
): Promise<WebSocket> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(url, options);
    const queue: MessageQueue = { buffered: [], waiters: [] };
    messageQueues.set(ws, queue);
    ws.on("message", (d) => {
      const msg = JSON.parse(d.toString());
      const waiter = queue.waiters.shift();
      if (waiter) {waiter(msg);} else {queue.buffered.push(msg);}
    });
    ws.on("open", () => resolvePromise(ws));
    ws.on("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<any> {
  const queue = messageQueues.get(ws);
  if (!queue) {
    // Sockets not created through open() (none today) — keep the old
    // behavior as a safe fallback.
    return new Promise((resolvePromise) => {
      ws.once("message", (d) => resolvePromise(JSON.parse(d.toString())));
    });
  }
  const buffered = queue.buffered.shift();
  if (buffered !== undefined) {return Promise.resolve(buffered);}
  return new Promise((resolvePromise, rejectPromise) => {
    // Fail fast: if the server disconnects without delivering the awaited
    // message, reject immediately instead of hanging until the 60s timeout.
    // Safe because a settled promise ignores late reject/resolve calls, so
    // tests that close the socket AFTER receiving their message are unaffected.
    const fail = (err: Error) => rejectPromise(err);
    ws.once("close", () =>
      fail(new Error("socket closed before message was received")),
    );
    ws.once("error", fail);
    queue.waiters.push((msg) => resolvePromise(msg));
  });
}

function send(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

async function waitClose(ws: WebSocket): Promise<void> {
  if (ws.readyState === ws.CLOSED || ws.readyState === ws.CLOSING) {
    // Close already fired (or is in flight): waiting for the event again
    // would hang forever. Give the event loop a tick to flush, then return.
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 10));
    return;
  }
  await new Promise<void>((resolvePromise) => {
    ws.once("close", () => resolvePromise());
    ws.once("error", () => resolvePromise());
  });
}

describe.skipIf(!serverEntryExists)("Signaling server — NET-01/02/04 security", () => {
  let proc: ChildProcess;
  let url: string;
  const port = 8799;

  beforeAll(async () => {
    const started = await startServer(port);
    proc = started.proc;
    url = started.url;
  }, 15000);

  afterAll(() => {
    proc?.kill("SIGTERM");
  });

  it("NET-01: first peer can join a new room without secret (becomes host)", async () => {
    const a = await open(url);
    const initA = await nextMessage(a);
    expect(initA.type).toBe("init");
    send(a, { type: "join", room: "room-host-1" });
    const joinedA = await nextMessage(a);
    expect(joinedA.type).toBe("joined");
    expect(joinedA.otherPeerIds).toContain(initA.yourPeerId);
    a.close();
    await waitClose(a);
  });

  it("NET-01: joiner WITHOUT the room secret is rejected when room has a secret", async () => {
    const host = await open(url);
    const initHost = await nextMessage(host);
    send(host, {
      type: "join",
      room: "secret-room-1",
      roomSecret: "topsecret",
    });
    await nextMessage(host);

    const intruder = await open(url);
    await nextMessage(intruder);
    send(intruder, { type: "join", room: "secret-room-1" });
    const closed = await new Promise<boolean>((resolvePromise) => {
      intruder.once("close", () => resolvePromise(true));
      intruder.once("error", () => resolvePromise(true));
      setTimeout(() => resolvePromise(false), 3000);
    });
    expect(closed).toBe(true);
    host.close();
    await waitClose(host);
  });

  it("NET-01: joiner WITH the correct room secret is admitted", async () => {
    const host = await open(url);
    const initHost = await nextMessage(host);
    send(host, {
      type: "join",
      room: "secret-room-2",
      roomSecret: "topsecret",
    });
    await nextMessage(host);

    const guest = await open(url);
    await nextMessage(guest);
    send(guest, {
      type: "join",
      room: "secret-room-2",
      roomSecret: "topsecret",
    });
    const joinedGuest = await nextMessage(guest);
    expect(joinedGuest.type).toBe("joined");
    expect(joinedGuest.otherPeerIds).toContain(initHost.yourPeerId);
    host.close();
    guest.close();
    await waitClose(host);
    await waitClose(guest);
  });

  it("NET-01: existing peers are notified when a new peer joins (mesh broadcast)", async () => {
    // The multiuser e2e caught that a joiner-only `joined` leaves existing
    // peers blind to new members — a 3+ device mesh can never form. The
    // server must broadcast the new room state to every live member,
    // matching RxDB's official signaling server protocol.
    const host = await open(url);
    const initHost = await nextMessage(host);
    send(host, { type: "join", room: "mesh-broadcast-1" });
    await nextMessage(host); // host joined (alone)

    const guest = await open(url);
    const initGuest = await nextMessage(guest);
    send(guest, { type: "join", room: "mesh-broadcast-1" });

    // The joiner sees the full room state…
    const joinedGuest = await nextMessage(guest);
    expect(joinedGuest.type).toBe("joined");
    expect(joinedGuest.otherPeerIds).toContain(initHost.yourPeerId);
    expect(joinedGuest.otherPeerIds).toContain(initGuest.yourPeerId);
    // …and so does the already-present peer (the mesh broadcast).
    const joinedHostUpdate = await nextMessage(host);
    expect(joinedHostUpdate.type).toBe("joined");
    expect(joinedHostUpdate.otherPeerIds).toContain(initHost.yourPeerId);
    expect(joinedHostUpdate.otherPeerIds).toContain(initGuest.yourPeerId);
    host.close();
    guest.close();
    await waitClose(host);
    await waitClose(guest);
  });

  it("NET-01: UTF-8-length-mismatched room secrets are rejected without crashing", async () => {
    const host = await open(url);
    await nextMessage(host);
    send(host, {
      type: "join",
      room: "secret-room-unicode-length",
      roomSecret: "a".repeat(16),
    });
    await nextMessage(host);

    const intruder = await open(url);
    await nextMessage(intruder);
    // Same JavaScript character count as the configured secret, but a
    // different UTF-8 byte length. This must take the guarded mismatch path,
    // not throw from timingSafeEqual and destabilize the server.
    send(intruder, {
      type: "join",
      room: "secret-room-unicode-length",
      roomSecret: "é".repeat(16),
    });
    expect(await expectClosed(intruder)).toBe(true);
    host.close();
    await waitClose(host);

    const health = await fetch("http://127.0.0.1:8799/health");
    expect(health.status).toBe(200);
  });

  it("NET-02: signal is only delivered to a peer in the same room", async () => {
    const a = await open(url);
    const initA = await nextMessage(a);
    send(a, { type: "join", room: "signal-room-1" });
    await nextMessage(a);

    const b = await open(url);
    const initB = await nextMessage(b);
    send(b, { type: "join", room: "signal-room-1" });
    await nextMessage(b);

    send(a, {
      type: "signal",
      senderPeerId: initA.yourPeerId,
      room: "signal-room-1",
      receiverPeerId: initB.yourPeerId,
      data: { sdp: "offer" },
    });
    const sig = await nextMessage(b);
    expect(sig.type).toBe("signal");
    expect(sig.receiverPeerId).toBe(initB.yourPeerId);
    expect(sig.senderPeerId).toBe(initA.yourPeerId);
    a.close();
    b.close();
    await waitClose(a);
    await waitClose(b);
  });

  it("NET-04/format: invalid room id is rejected", async () => {
    const a = await open(url);
    await nextMessage(a);
    send(a, { type: "join", room: ".." });
    const closed = await new Promise<boolean>((resolvePromise) => {
      a.once("close", () => resolvePromise(true));
      a.once("error", () => resolvePromise(true));
      setTimeout(() => resolvePromise(false), 3000);
    });
    expect(closed).toBe(true);
  });

  it("NET-05: signal with a spoofed senderPeerId is disconnected", async () => {
    const a = await open(url);
    const initA = await nextMessage(a);
    send(a, { type: "join", room: "spoof-room" });
    await nextMessage(a);

    // Claim to be some other peer (impersonation attempt) → server must close us.
    send(a, {
      type: "signal",
      senderPeerId: "attacker-fake-id",
      room: "spoof-room",
      receiverPeerId: initA.yourPeerId,
      data: {},
    });
    const closed = await new Promise<boolean>((resolvePromise) => {
      a.once("close", () => resolvePromise(true));
      a.once("error", () => resolvePromise(true));
      setTimeout(() => resolvePromise(false), 3000);
    });
    expect(closed).toBe(true);
  });

  it("NET-05: signal with the connection's own peerId is relayed (no false positive)", async () => {
    const a = await open(url);
    const initA = await nextMessage(a);
    send(a, { type: "join", room: "spoof-room-2" });
    await nextMessage(a);

    const b = await open(url);
    const initB = await nextMessage(b);
    send(b, { type: "join", room: "spoof-room-2" });
    await nextMessage(b);

    send(a, {
      type: "signal",
      senderPeerId: initA.yourPeerId, // its OWN id — allowed
      room: "spoof-room-2",
      receiverPeerId: initB.yourPeerId,
      data: { sdp: "offer" },
    });
    const sig = await nextMessage(b);
    expect(sig.type).toBe("signal");
    expect(sig.senderPeerId).toBe(initA.yourPeerId);
    a.close();
    b.close();
    await waitClose(a);
    await waitClose(b);
  });

  it("NET-06: a second join on the same connection is rejected", async () => {
    const a = await open(url);
    await nextMessage(a);
    send(a, { type: "join", room: "double-join-room" });
    await nextMessage(a);
    send(a, { type: "join", room: "double-join-room-2" });
    const closed = await new Promise<boolean>((resolvePromise) => {
      a.once("close", () => resolvePromise(true));
      a.once("error", () => resolvePromise(true));
      setTimeout(() => resolvePromise(false), 3000);
    });
    expect(closed).toBe(true);
  });
});

// ─── Signaling log privacy ───────────────────────────────────────────────
// The server may use the client address for rate limiting, but operational
// logs must contain only the salted, truncated fingerprint. Exercise the real
// child process and inspect both stdout and stderr so a new logging path cannot
// accidentally reintroduce a raw address.
describe.skipIf(!serverEntryExists)("Signaling server — log IP privacy", () => {
  it("never writes an unhashed client IP to signaling logs", async () => {
    const port = 8822;
    const rawClientIp = "198.51.100.77";
    const salt = "signaling-log-privacy-test-salt";
    const server = await startServer(port, {
      HOST: "0.0.0.0",
      TRUST_PROXY: "1",
      SIGNALING_IP_HASH_SALT: salt,
      JOIN_LIMIT: "1",
      JOIN_WINDOW_MS: "60000",
      MAX_CONNECTIONS: "64",
    });
    const sockets: WebSocket[] = [];

    try {
      const accepted = await open(server.url, {
        headers: { "x-forwarded-for": rawClientIp },
      });
      sockets.push(accepted);
      await nextMessage(accepted);
      send(accepted, { type: "join", room: "log-privacy-room" });
      await nextMessage(accepted);

      const rejected = await open(server.url, {
        headers: { "x-forwarded-for": rawClientIp },
      });
      sockets.push(rejected);
      await nextMessage(rejected);
      send(rejected, { type: "join", room: "log-privacy-rejected-room" });
      expect(await expectClosed(rejected)).toBe(true);
      await waitForServerLog(server.logs, "signaling_join_rate_limited");

      const output = server.logs.join("");
      const expectedIpHash = createHash("sha256")
        .update(`${salt}:${rawClientIp}`)
        .digest("hex")
        .slice(0, 24);
      expect(output).not.toContain(rawClientIp);
      expect(output).toContain(expectedIpHash);
    } finally {
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) socket.close();
        await waitClose(socket);
      }
      server.proc.kill("SIGTERM");
    }
  });
});

// Rejection-path log privacy: exercise each high-value overload/auth branch
// against a real child process and assert the raw forwarded address never
// appears in stdout/stderr. The server logs only the salted ipHash.
describe.skipIf(!serverEntryExists)("Signaling server — rejection log IP privacy", () => {
  async function assertRejectedLogIsPrivate(options: {
    port: number;
    env: Record<string, string>;
    rawIp: string;
    trigger: (url: string, logs: string[], sockets: WebSocket[]) => Promise<void>;
    marker: string;
  }): Promise<void> {
    const salt = `rejection-log-${options.port}`;
    const server = await startServer(options.port, {
      TRUST_PROXY: "1",
      SIGNALING_IP_HASH_SALT: salt,
      MAX_PAYLOAD_BYTES: "1048576",
      JOIN_LIMIT: "100",
      MAX_CONNECTIONS: "64",
      ...options.env,
    });
    const sockets: WebSocket[] = [];
    try {
      await options.trigger(server.url, server.logs, sockets);
      await waitForServerLog(server.logs, options.marker);
      const output = server.logs.join("");
      const expectedIpHash = createHash("sha256")
        .update(`${salt}:${options.rawIp}`)
        .digest("hex")
        .slice(0, 24);
      expect(output).toContain(options.marker);
      expect(output).not.toContain(options.rawIp);
      expect(output).toContain(expectedIpHash);
    } finally {
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) socket.close();
        await waitClose(socket);
      }
      server.proc.kill("SIGTERM");
    }
  }

  it("redacts the IP in room-full rejection logs", async () => {
    const rawIp = "198.51.100.81";
    await assertRejectedLogIsPrivate({
      port: 8831,
      rawIp,
      marker: "signaling_room_full",
      env: { MAX_PEERS_PER_ROOM: "1" },
      trigger: async (url, _logs, sockets) => {
        const host = await open(url, { headers: { "x-forwarded-for": rawIp } });
        sockets.push(host);
        await nextMessage(host);
        send(host, { type: "join", room: "full-log-room" });
        await nextMessage(host);

        const guest = await open(url, { headers: { "x-forwarded-for": rawIp } });
        sockets.push(guest);
        await nextMessage(guest);
        send(guest, { type: "join", room: "full-log-room" });
        expect(await expectClosed(guest)).toBe(true);
      },
    });
  });

  it("redacts the IP in invalid-HMAC rejection logs", async () => {
    const rawIp = "198.51.100.82";
    await assertRejectedLogIsPrivate({
      port: 8832,
      rawIp,
      marker: "signaling_invalid_hmac",
      env: {},
      trigger: async (url, _logs, sockets) => {
        const sender = await open(url, { headers: { "x-forwarded-for": rawIp } });
        sockets.push(sender);
        const init = await nextMessage(sender);
        send(sender, {
          type: "join",
          room: "hmac-log-room",
          roomSecret: "log-secret",
        });
        await nextMessage(sender);
        send(sender, {
          type: "signal",
          senderPeerId: init.yourPeerId,
          receiverPeerId: "receiver-peer",
          data: { sdp: "offer" },
          signalAuth: "0".repeat(64),
        });
        expect(await expectClosed(sender)).toBe(true);
      },
    });
  });

  it("redacts the IP in connection-overload rejection logs", async () => {
    const rawIp = "198.51.100.83";
    await assertRejectedLogIsPrivate({
      port: 8833,
      rawIp,
      marker: "signaling_connection_rejected_overload",
      env: { MAX_CONNECTIONS: "1" },
      trigger: async (url, _logs, sockets) => {
        const first = await open(url, { headers: { "x-forwarded-for": rawIp } });
        sockets.push(first);
        await nextMessage(first);
        const second = await open(url, { headers: { "x-forwarded-for": rawIp } });
        sockets.push(second);
        expect(await expectClosed(second)).toBe(true);
      },
    });
  });
});

// A connection that the server rejects (connection cap) may never complete its
// handshake — the client sees neither 'open' nor 'error', it just stalls.
// Resolve null when the socket fails to open within the timeout.
function openOrNull(url: string, ms = 1500): Promise<WebSocket | null> {
  return new Promise((resolvePromise) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      resolvePromise(null);
    }, ms);
    ws.on("open", () => {
      clearTimeout(timer);
      resolvePromise(ws);
    });
    ws.on("error", () => {
      clearTimeout(timer);
      resolvePromise(null);
    });
  });
}

describe.skipIf(!serverEntryExists)("Signaling server — DoS hardening (env limits)", () => {
  let proc: ChildProcess;
  let url: string;
  const port = 8801;

  beforeAll(async () => {
    // MAX_CONNECTIONS is generous here on purpose: the rate-limit test needs
    // several concurrent sockets; the connection cap is tested separately
    // below with a dedicated server (MAX_CONNECTIONS=1).
    const started = await startServer(port, {
      MAX_PAYLOAD_BYTES: "1024",
      JOIN_LIMIT: "2",
      MAX_CONNECTIONS: "64",
    });
    proc = started.proc;
    url = started.url;
  }, 15000);

  afterAll(() => {
    proc?.kill("SIGTERM");
  });

  it("NET-07: oversized payload is rejected (maxPayload)", async () => {
    const a = await open(url);
    await nextMessage(a);
    send(a, { type: "join", room: "big-payload-room" });
    await nextMessage(a);
    // > 1024 bytes → server closes the connection (maxPayload).
    a.send(JSON.stringify({ type: "signal", data: "x".repeat(4096) }));
    const closed = await new Promise<boolean>((resolvePromise) => {
      a.once("close", () => resolvePromise(true));
      a.once("error", () => resolvePromise(true));
      setTimeout(() => resolvePromise(false), 3000);
    });
    expect(closed).toBe(true);
    await waitClose(a);
  });

  it("NET-07: an oversized room secret is rejected before room allocation", async () => {
    const a = await open(url);
    await nextMessage(a);
    send(a, {
      type: "join",
      room: "oversized-secret-room",
      roomSecret: "x".repeat(129),
    });
    expect(await expectClosed(a)).toBe(true);
    await waitClose(a);
  });

  it("NET-07: join rate limit kicks in after JOIN_LIMIT joins (dedicated server)", async () => {
    // Dedicated server: a fresh join window, so the previous test's join
    // cannot consume any of the JOIN_LIMIT budget.
    const rlPort = 8803;
    const rlServer = await startServer(rlPort, {
      MAX_PAYLOAD_BYTES: "1048576",
      JOIN_LIMIT: "2",
      JOIN_WINDOW_MS: "60000",
      MAX_CONNECTIONS: "64",
    });
    const rlUrl = rlServer.url;
    try {
      const a = await open(rlUrl);
      await nextMessage(a);
      send(a, { type: "join", room: "rl-room-1" });
      await nextMessage(a);

      const b = await open(rlUrl);
      await nextMessage(b);
      send(b, { type: "join", room: "rl-room-2" });
      await nextMessage(b);

      // Third join from the same IP (JOIN_LIMIT=2) must be rejected: the
      // connection is closed without ever receiving a "joined" message.
      const c = await open(rlUrl);
      await nextMessage(c);
      send(c, { type: "join", room: "rl-room-3" });
      const closed = await new Promise<boolean>((resolvePromise) => {
        c.once("close", () => resolvePromise(true));
        c.once("error", () => resolvePromise(true));
        setTimeout(() => resolvePromise(false), 3000);
      });
      expect(closed).toBe(true);
      a.close();
      b.close();
      await waitClose(a);
      await waitClose(b);
      await waitClose(c);
    } finally {
      rlServer.proc?.kill("SIGTERM");
    }
  });

  it("NET-07: spoofed x-forwarded-for cannot bypass the rate limit by default", async () => {
    // TRUST_PROXY is OFF: the server must use req.socket.remoteAddress, so
    // two connections claiming different XFF IPs still share the same real
    // IP and exhaust the single-join budget together.
    const spPort = 8804;
    const spServer = await startServer(spPort, {
      MAX_PAYLOAD_BYTES: "1048576",
      JOIN_LIMIT: "1",
      JOIN_WINDOW_MS: "60000",
      MAX_CONNECTIONS: "64",
    });
    const spUrl = spServer.url;
    try {
      // Route through open(): it installs the message queue at socket
      // creation, so the server's init frame can never race the listener
      // registration and hang nextMessage until the 60s timeout (the
      // legacy queue-less path this helper used to take in CI).
      const openWithHeader = (xff: string) =>
        open(spUrl, { headers: { "x-forwarded-for": xff } });

      const a = await openWithHeader("203.0.113.1");
      await nextMessage(a);
      send(a, { type: "join", room: "spoof-rl-1" });
      await nextMessage(a);

      // Different spoofed XFF → but same real socket IP → join must be refused.
      const b = await openWithHeader("203.0.113.2");
      await nextMessage(b);
      send(b, { type: "join", room: "spoof-rl-2" });
      const closed = await new Promise<boolean>((resolvePromise) => {
        b.once("close", () => resolvePromise(true));
        b.once("error", () => resolvePromise(true));
        setTimeout(() => resolvePromise(false), 3000);
      });
      expect(closed).toBe(true);
      a.close();
      await waitClose(a);
      await waitClose(b);
    } finally {
      spServer.proc?.kill("SIGTERM");
    }
  });

  it("NET-07: invalid numeric limits fail closed to safe defaults", async () => {
    const configPort = 8809;
    const configServer = await startServer(configPort, {
      MAX_CONNECTIONS: "0",
      MAX_ROOMS: "-1",
      MAX_PEERS_PER_ROOM: "not-a-number",
      MAX_PAYLOAD_BYTES: "NaN",
      JOIN_LIMIT: "0",
      JOIN_WINDOW_MS: "-500",
    });
    try {
      // MAX_CONNECTIONS=0 would reject even the first socket if the raw
      // environment value reached the admission check. The bounded parser
      // must restore the documented safe default instead.
      const a = await open(configServer.url);
      const init = await nextMessage(a);
      expect(init.type).toBe("init");
      send(a, { type: "join", room: "invalid-config-room" });
      expect((await nextMessage(a)).type).toBe("joined");
      a.close();
      await waitClose(a);
    } finally {
      configServer.proc?.kill("SIGTERM");
    }
  });

  it("NET-07: connection cap rejects excess connections (dedicated server)", async () => {
    const capPort = 8802;
    const capServer = await startServer(capPort, {
      MAX_CONNECTIONS: "1",
      MAX_PAYLOAD_BYTES: "1048576",
      JOIN_LIMIT: "100",
    });
    const capUrl = capServer.url;
    try {
      // First connection fills the single slot.
      const a = await openOrNull(capUrl);
      expect(a).not.toBeNull();
      await nextMessage(a!);
      // Second connection must be refused. `ws.close()` is graceful: the
      // handshake may complete (client fires 'open') before the close frame
      // arrives, so accept EITHER a refused handshake (null) or a socket
      // that closes right away.
      const b = await openOrNull(capUrl);
      if (b) {
        const closed = await new Promise<boolean>((resolvePromise) => {
          b.once("close", () => resolvePromise(true));
          b.once("error", () => resolvePromise(true));
          setTimeout(() => resolvePromise(false), 2000);
        });
        expect(closed).toBe(true);
      } else {
        expect(b).toBeNull();
      }
      a?.close();
      if (a) {await waitClose(a);}
    } finally {
      capServer.proc?.kill("SIGTERM");
    }
  });
});

// ─── Heartbeat sweep (dead-socket reaping) ─────────────────────────────
// A connection that vanishes without a FIN (suspend, network drop) would
// stay in the rooms maps forever. The server pings periodically and
// terminates sockets that miss one round-trip. A real ws client auto-pongs,
// so to simulate a dead peer we pause the client's underlying socket: the
// incoming ping frames stop being processed and no pong is ever emitted.
describe.skipIf(!serverEntryExists)("Signaling server — heartbeat sweep", () => {
  it("NET-08: a socket that stops answering pings is terminated and removed from its room", async () => {
    const hbPort = 8806;
    const hbServer = await startServer(hbPort, {
      HEARTBEAT_INTERVAL_MS: "1000",
      MAX_PAYLOAD_BYTES: "1048576",
      JOIN_LIMIT: "100",
    });
    const hbUrl = hbServer.url;
    try {
      const a = await open(hbUrl);
      const initA = await nextMessage(a);
      send(a, { type: "join", room: "hb-room-1" });
      await nextMessage(a);

      // Silence the client: no pong can be emitted for the server pings.
      const socket = (a as unknown as { _socket: { pause(): void } })._socket;
      socket.pause();

      // Two sweep rounds (ping, then terminate on the missed pong) plus slack.
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 3200));

      // A fresh peer joining the same room proves the dead socket was removed
      // from the room map; the public health endpoint intentionally exposes no
      // room/connection counters.
      const b = await open(hbUrl);
      const initB = await nextMessage(b);
      send(b, { type: "join", room: "hb-room-1" });
      const joinedB = await nextMessage(b);
      expect(joinedB.type).toBe("joined");
      expect(joinedB.otherPeerIds).not.toContain(initA.yourPeerId);
      expect(joinedB.otherPeerIds).toContain(initB.yourPeerId);
      b.close();
      await waitClose(b);
      a.terminate();
    } finally {
      hbServer.proc?.kill("SIGTERM");
    }
  }, 15000);
});

// ─── HMAC signal authentication (audit #4) ─────────────────────────────
//
// Mirrors server/src/index.ts deriveSignalKey + verifySignalAuth: the signal
// key is HMAC-SHA256(roomSecret, "bookmarkforge-signal-auth:" + roomId) and
// the canonical payload is JSON.stringify({ type: "signal", senderPeerId,
// receiverPeerId, data }) with the same normalization the server applies.
function signalAuthHex(
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

function expectClosed(ws: WebSocket, ms = 3000): Promise<boolean> {
  return new Promise((resolvePromise) => {
    ws.once("close", () => resolvePromise(true));
    ws.once("error", () => resolvePromise(true));
    setTimeout(() => resolvePromise(false), ms);
  });
}

describe.skipIf(!serverEntryExists)("Signaling server — HMAC signal auth (default ON)", () => {
  let proc: ChildProcess;
  let url: string;
  const port = 8805;

  beforeAll(async () => {
    // No ENFORCE_SIGNAL_HMAC env → server enforces HMAC by default.
    const started = await startServer(port, {
      MAX_PAYLOAD_BYTES: "1048576",
      JOIN_LIMIT: "100",
      MAX_CONNECTIONS: "64",
    });
    proc = started.proc;
    url = started.url;
  }, 15000);

  afterAll(() => {
    proc?.kill("SIGTERM");
  });

  it("signal WITHOUT signalAuth in a secret room is disconnected", async () => {
    const a = await open(url);
    const initA = await nextMessage(a);
    send(a, { type: "join", room: "hmac-room-1", roomSecret: "s3cret" });
    await nextMessage(a);

    const b = await open(url);
    const initB = await nextMessage(b);
    send(b, { type: "join", room: "hmac-room-1", roomSecret: "s3cret" });
    await nextMessage(b);

    send(a, {
      type: "signal",
      senderPeerId: initA.yourPeerId,
      receiverPeerId: initB.yourPeerId,
      data: { sdp: "offer" },
    });
    expect(await expectClosed(a)).toBe(true);
    b.close();
    await waitClose(b);
  });

  it("signal WITH a valid signalAuth is relayed", async () => {
    const a = await open(url);
    const initA = await nextMessage(a);
    send(a, { type: "join", room: "hmac-room-2", roomSecret: "s3cret" });
    await nextMessage(a);

    const b = await open(url);
    const initB = await nextMessage(b);
    send(b, { type: "join", room: "hmac-room-2", roomSecret: "s3cret" });
    await nextMessage(b);

    send(a, {
      type: "signal",
      senderPeerId: initA.yourPeerId,
      receiverPeerId: initB.yourPeerId,
      data: { sdp: "offer" },
      signalAuth: signalAuthHex(
        "s3cret",
        "hmac-room-2",
        initA.yourPeerId,
        initB.yourPeerId,
        { sdp: "offer" },
      ),
    });
    const sig = await nextMessage(b);
    expect(sig.type).toBe("signal");
    expect(sig.senderPeerId).toBe(initA.yourPeerId);
    expect(sig.receiverPeerId).toBe(initB.yourPeerId);
    a.close();
    b.close();
    await waitClose(a);
    await waitClose(b);
  });

  it("suppresses exact duplicate signal relays during the handshake window", async () => {
    const a = await open(url);
    const initA = await nextMessage(a);
    send(a, { type: "join", room: "hmac-room-dedupe", roomSecret: "s3cret" });
    await nextMessage(a);

    const b = await open(url);
    const initB = await nextMessage(b);
    send(b, { type: "join", room: "hmac-room-dedupe", roomSecret: "s3cret" });
    await nextMessage(b);

    const signal = {
      type: "signal",
      senderPeerId: initA.yourPeerId,
      receiverPeerId: initB.yourPeerId,
      data: { sdp: "offer", candidate: "same-frame" },
      signalAuth: signalAuthHex(
        "s3cret",
        "hmac-room-dedupe",
        initA.yourPeerId,
        initB.yourPeerId,
        { sdp: "offer", candidate: "same-frame" },
      ),
    };
    send(a, signal);
    expect((await nextMessage(b)).type).toBe("signal");
    send(a, signal);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    expect(messageQueues.get(b)?.buffered ?? []).toHaveLength(0);

    a.close();
    b.close();
    await waitClose(a);
    await waitClose(b);
  });

  it("re-allows an identical signal after the bounded replay window", async () => {
    const replayPort = 8810;
    const replayServer = await startServer(replayPort, {
      SIGNAL_REPLAY_WINDOW_MS: "1000",
      MAX_PAYLOAD_BYTES: "1048576",
      JOIN_LIMIT: "100",
      MAX_CONNECTIONS: "64",
    });
    try {
      const a = await open(replayServer.url);
      const initA = await nextMessage(a);
      send(a, { type: "join", room: "hmac-room-expiry", roomSecret: "s3cret" });
      await nextMessage(a);

      const b = await open(replayServer.url);
      const initB = await nextMessage(b);
      send(b, { type: "join", room: "hmac-room-expiry", roomSecret: "s3cret" });
      await nextMessage(b);

      const signal = {
        type: "signal",
        senderPeerId: initA.yourPeerId,
        receiverPeerId: initB.yourPeerId,
        data: { sdp: "offer", candidate: "after-window" },
        signalAuth: signalAuthHex(
          "s3cret",
          "hmac-room-expiry",
          initA.yourPeerId,
          initB.yourPeerId,
          { sdp: "offer", candidate: "after-window" },
        ),
      };
      send(a, signal);
      await nextMessage(b);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1150));
      send(a, signal);
      expect((await nextMessage(b)).data).toEqual(signal.data);

      a.close();
      b.close();
      await waitClose(a);
      await waitClose(b);
    } finally {
      replayServer.proc?.kill("SIGTERM");
    }
  });

  it("does not consume a signal duplicate key while the target has not joined", async () => {
    const a = await open(url);
    const initA = await nextMessage(a);
    send(a, { type: "join", room: "hmac-room-late-target", roomSecret: "s3cret" });
    await nextMessage(a);

    // The target has an assigned peer id but is not in room.peers yet.
    const b = await open(url);
    const initB = await nextMessage(b);
    const signal = {
      type: "signal",
      senderPeerId: initA.yourPeerId,
      receiverPeerId: initB.yourPeerId,
      data: { sdp: "offer", candidate: "retry-after-join" },
      signalAuth: signalAuthHex(
        "s3cret",
        "hmac-room-late-target",
        initA.yourPeerId,
        initB.yourPeerId,
        { sdp: "offer", candidate: "retry-after-join" },
      ),
    };
    send(a, signal);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));

    send(b, {
      type: "join",
      room: "hmac-room-late-target",
      roomSecret: "s3cret",
    });
    await nextMessage(b);
    send(a, signal);
    expect((await nextMessage(b)).data).toEqual(signal.data);

    a.close();
    b.close();
    await waitClose(a);
    await waitClose(b);
  });

  it("signal WITH an invalid signalAuth is disconnected", async () => {
    const a = await open(url);
    const initA = await nextMessage(a);
    send(a, { type: "join", room: "hmac-room-3", roomSecret: "s3cret" });
    await nextMessage(a);

    const b = await open(url);
    const initB = await nextMessage(b);
    send(b, { type: "join", room: "hmac-room-3", roomSecret: "s3cret" });
    await nextMessage(b);

    send(a, {
      type: "signal",
      senderPeerId: initA.yourPeerId,
      receiverPeerId: initB.yourPeerId,
      data: {},
      signalAuth: "deadbeef",
    });
    expect(await expectClosed(a)).toBe(true);
    b.close();
    await waitClose(b);
  });

  it("signal data above the protocol bound is disconnected before HMAC work", async () => {
    const a = await open(url);
    const initA = await nextMessage(a);
    send(a, { type: "join", room: "hmac-room-large-data", roomSecret: "s3cret" });
    await nextMessage(a);

    const b = await open(url);
    const initB = await nextMessage(b);
    send(b, { type: "join", room: "hmac-room-large-data", roomSecret: "s3cret" });
    await nextMessage(b);

    send(a, {
      type: "signal",
      senderPeerId: initA.yourPeerId,
      receiverPeerId: initB.yourPeerId,
      data: "x".repeat(256 * 1024 + 1),
    });
    expect(await expectClosed(a)).toBe(true);
    b.close();
    await waitClose(b);
  });

  it("signalAuth signed with a WRONG room secret is disconnected", async () => {
    const a = await open(url);
    const initA = await nextMessage(a);
    send(a, { type: "join", room: "hmac-room-4", roomSecret: "s3cret" });
    await nextMessage(a);

    const b = await open(url);
    const initB = await nextMessage(b);
    send(b, { type: "join", room: "hmac-room-4", roomSecret: "s3cret" });
    await nextMessage(b);

    send(a, {
      type: "signal",
      senderPeerId: initA.yourPeerId,
      receiverPeerId: initB.yourPeerId,
      data: { sdp: "offer" },
      signalAuth: signalAuthHex(
        "WRONG-SECRET",
        "hmac-room-4",
        initA.yourPeerId,
        initB.yourPeerId,
        { sdp: "offer" },
      ),
    });
    expect(await expectClosed(a)).toBe(true);
    b.close();
    await waitClose(b);
  });

  it("public room (no secret) signals are relayed without signalAuth", async () => {
    const a = await open(url);
    const initA = await nextMessage(a);
    send(a, { type: "join", room: "hmac-public-room" });
    await nextMessage(a);

    const b = await open(url);
    const initB = await nextMessage(b);
    send(b, { type: "join", room: "hmac-public-room" });
    await nextMessage(b);

    send(a, {
      type: "signal",
      senderPeerId: initA.yourPeerId,
      receiverPeerId: initB.yourPeerId,
      data: { sdp: "offer" },
    });
    const sig = await nextMessage(b);
    expect(sig.type).toBe("signal");
    a.close();
    b.close();
    await waitClose(a);
    await waitClose(b);
  });
});

describe.skipIf(!serverEntryExists)("Signaling server — production HMAC opt-out guard", () => {
  let proc: ChildProcess;
  let url: string;
  const port = 8806;

  beforeAll(async () => {
    const started = await startServer(port, {
      NODE_ENV: "production",
      AI_SESSION_ORIGINS: "http://127.0.0.1",
      ENFORCE_SIGNAL_HMAC: "0",
      MAX_PAYLOAD_BYTES: "1048576",
      JOIN_LIMIT: "100",
      MAX_CONNECTIONS: "64",
    });
    proc = started.proc;
    url = started.url;
  }, 15000);

  afterAll(() => {
    proc?.kill("SIGTERM");
  });

  it("rejects unsigned signals when production requests the opt-out", async () => {
    // The server's WS verifyClient allows any origin when WS_ALLOWED_ORIGINS
    // is empty (default). This test server therefore allows all connections.
    const allowedOrigin = { headers: { origin: "http://127.0.0.1" } };
    const a = await open(url, allowedOrigin);
    const initA = await nextMessage(a);
    send(a, { type: "join", room: "production-optout-room", roomSecret: "s3cret" });
    await nextMessage(a);

    const b = await open(url, allowedOrigin);
    const initB = await nextMessage(b);
    send(b, { type: "join", room: "production-optout-room", roomSecret: "s3cret" });
    await nextMessage(b);

    send(a, {
      type: "signal",
      senderPeerId: initA.yourPeerId,
      receiverPeerId: initB.yourPeerId,
      data: { sdp: "offer" },
    });
    expect(await expectClosed(a)).toBe(true);
    b.close();
    await waitClose(b);
  });
});

describe.skipIf(!serverEntryExists)("Signaling server — TURN REST credentials (audit #1)", () => {
  it("init includes ephemeral coturn REST iceServers when configured", async () => {
    const turnPort = 8807;
    const turnServer = await startServer(turnPort, {
      TURN_RELAY_HOST: "turn.example.com",
      TURN_STATIC_AUTH_SECRET: "turn-secret",
      TURN_PORT: "3478",
      TURN_TLS_PORT: "5349",
      TURN_TTL: "3600",
      MAX_PAYLOAD_BYTES: "1048576",
      JOIN_LIMIT: "100",
      MAX_CONNECTIONS: "64",
    });
    try {
      const a = await open(turnServer.url);
      const init = await nextMessage(a);
      expect(init.type).toBe("init");
      expect(Array.isArray(init.iceServers)).toBe(true);
      const ice = init.iceServers as Array<{
        urls: string | string[];
        username?: string;
        credential?: string;
      }>;
      expect(ice.length).toBe(1);
      const urls = Array.isArray(ice[0]!.urls) ? ice[0]!.urls : [ice[0]!.urls];
      expect(urls).toContain("turn:turn.example.com:3478?transport=udp");
      expect(urls).toContain("turn:turn.example.com:3478?transport=tcp");
      expect(urls).toContain("turns:turn.example.com:5349?transport=tcp");

      const username = ice[0]!.username ?? "";
      expect(username).toMatch(/^\d+:turn$/);
      const expiry = Number(username.split(":")[0]);
      const now = Math.floor(Date.now() / 1000);
      expect(expiry).toBeGreaterThan(now);
      expect(expiry).toBeLessThanOrEqual(now + 3600);

      const expected = createHmac("sha1", "turn-secret")
        .update(username)
        .digest("base64");
      expect(ice[0]!.credential).toBe(expected);
      a.close();
      await waitClose(a);
    } finally {
      turnServer.proc?.kill("SIGTERM");
    }
  });

  it("init carries NO iceServers when TURN is not configured", async () => {
    const noTurnPort = 8808;
    const noTurnServer = await startServer(noTurnPort, {
      MAX_PAYLOAD_BYTES: "1048576",
      JOIN_LIMIT: "100",
      MAX_CONNECTIONS: "64",
    });
    try {
      const a = await open(noTurnServer.url);
      const init = await nextMessage(a);
      expect(init.type).toBe("init");
      expect(init.iceServers).toBeUndefined();
      a.close();
      await waitClose(a);
    } finally {
      noTurnServer.proc?.kill("SIGTERM");
    }
  });
});

describe.skipIf(!serverEntryExists)("Signaling server — CSP report abort resilience", () => {
  let proc: ChildProcess;
  let port: number;

  beforeAll(async () => {
    port = 8821;
    const started = await startServer(port, {
      CSP_REPORT_BODY_MAX_BYTES: "16384",
    });
    proc = started.proc;
  }, 15000);

  afterAll(() => {
    proc?.kill("SIGTERM");
  });

  async function healthCheck(): Promise<boolean> {
    return await new Promise((resolvePromise) => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/health" },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolvePromise(res.statusCode === 200));
        },
      );
      req.on("error", () => resolvePromise(false));
    });
  }

  // Regression: a client that destroys the socket mid-body (RST after the
  // headers were parsed) used to leave the CSP handler without an error/abort
  // listener. In Node, an 'error' on an IncomingMessage with no listener is
  // an uncaught exception that kills the whole signaling server. The handler
  // now settles and destroys the response instead, so the process survives.
  it("survives a mid-body socket destroy on /csp-report", async () => {
    await new Promise<void>((resolvePromise) => {
      const req = http.request({
        host: "127.0.0.1",
        port,
        path: "/csp-report",
        method: "POST",
        headers: {
          "Content-Type": "application/csp-report",
          "Transfer-Encoding": "chunked",
        },
      });
      req.on("error", () => resolvePromise());
      req.flushHeaders();
      // Send a partial body, then destroy the socket mid-upload.
      req.write("{\"csp-report\":{\"blocked-uri\":\"https://evil");
      setTimeout(() => {
        req.destroy(new Error("client aborted mid-body"));
        resolvePromise();
      }, 50);
    });

    // Give the server a beat to process the abort, then confirm it is alive.
    await new Promise((r) => setTimeout(r, 200));
    expect(await healthCheck()).toBe(true);
  });

  it("health endpoint still answers after an aborted report (server not crashed)", async () => {
    expect(await healthCheck()).toBe(true);
  });
});

describe.skipIf(!serverEntryExists)("Signaling server — bounded join-window cardinality", () => {
  it("rejects a new identity when the join-window map is saturated", async () => {
    const port = 8810;
    const started = await startServer(port, {
      TRUST_PROXY: "1",
      MAX_JOIN_RATE_ENTRIES: "1",
      JOIN_LIMIT: "100",
      JOIN_WINDOW_MS: "60000",
      MAX_CONNECTIONS: "64",
      MAX_ROOMS: "64",
    });
    const sockets: WebSocket[] = [];
    try {
      // open() attaches the message queue at socket creation — same race
      // guard as every other socket in this file (see the queue comment).
      const openWithHeader = (xff: string) =>
        open(started.url, { headers: { "x-forwarded-for": xff } });

      const first = await openWithHeader("203.0.113.10");
      sockets.push(first);
      const initFirst = await nextMessage(first);
      send(first, { type: "join", room: "join-cap-room-1" });
      await nextMessage(first);

      const second = await openWithHeader("203.0.113.11");
      sockets.push(second);
      await nextMessage(second);
      send(second, { type: "join", room: "join-cap-room-2" });
      expect(await expectClosed(second)).toBe(true);
      expect(initFirst.yourPeerId).toBeTypeOf("string");
    } finally {
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) socket.close();
        await waitClose(socket);
      }
      started.proc.kill("SIGTERM");
    }
  });
});
