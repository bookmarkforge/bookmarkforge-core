import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket as WsWebSocket } from "ws";
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "node:fs";
import {
  createSignalingSocketFactory,
  canonicalSignalPayload,
  deriveClientSignalKey,
} from "../../services/SyncService";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "../../../server/src/index.ts");
const serverEntryExists = fs.existsSync(SERVER_ENTRY);

// ─── Drift-closing integration test ─────────────────────────────────────
//
// Why this file exists (audit gap):
//   * signaling-server.test.ts verifies the server against a LOCAL mirror of
//     the client's signing (signalAuthHex) — if SyncService changes its
//     canonicalSignalPayload normalization (key order, `?? ""` / `?? null`),
//     the mirror drifts silently and the server tests stay green.
//   * SyncService.test.ts verifies the client against a MockWebSocket — it
//     never touches the real server.
//   → No existing test connects the REAL client signing path to the REAL
//     server verification path. A normalization change on either side that
//     is not mirrored on the other would break P2P sync in production while
//     every unit test passed.
//
// This file closes that gap end-to-end: it spawns the actual server and
// drives it with the actual client factory.

// Lossless message queue per socket. The naive `open()` → `once("message")`
// pattern races on Windows: the server's init frame can be parsed in the same
// tick as the client's `open` event, before the continuation registers its
// listener, dropping the frame and hanging the test (see the same note in
// signaling-server.test.ts). Buffering from socket creation makes delivery
// race-free.
const messageQueues = new WeakMap<WsWebSocket, { buffered: unknown[]; waiters: Array<(m: unknown) => void> }>();

function startServer(
  port: number,
  extraEnv: Record<string, string> = {},
): Promise<{ proc: ChildProcess; url: string }> {
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
    const timeout = setTimeout(
      () => reject(new Error("server start timeout")),
      8000,
    );
    proc.stdout?.on("data", (d: Buffer) => {
      if (d.toString().includes("Server running")) {
        clearTimeout(timeout);
        resolvePromise({ proc, url });
      }
    });
    proc.on("error", reject);
  });
}

function open(url: string): Promise<WsWebSocket> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WsWebSocket(url);
    const queue = { buffered: [], waiters: [] } as {
      buffered: unknown[];
      waiters: Array<(m: unknown) => void>;
    };
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

function nextMessage(ws: WsWebSocket): Promise<any> {
  const queue = messageQueues.get(ws);
  if (!queue) {
    // Sockets not created through open() — safe fallback.
    return new Promise((resolvePromise) => {
      ws.once("message", (d) => resolvePromise(JSON.parse(d.toString())));
    });
  }
  const buffered = queue.buffered.shift();
  if (buffered !== undefined) {return Promise.resolve(buffered);}
  return new Promise((resolvePromise, rejectPromise) => {
    const fail = (err: Error) => rejectPromise(err);
    ws.once("close", () =>
      fail(new Error("socket closed before message was received")),
    );
    ws.once("error", fail);
    queue.waiters.push((msg) => resolvePromise(msg));
  });
}

function waitClose(ws: WsWebSocket): Promise<void> {
  return new Promise((resolvePromise) => {
    if (ws.readyState === ws.CLOSED || ws.readyState === ws.CLOSING) {
      setTimeout(resolvePromise, 10);
      return;
    }
    ws.once("close", () => resolvePromise());
    ws.once("error", () => resolvePromise());
  });
}

describe.skipIf(!serverEntryExists)(
  "Signaling client↔server integration (drift guard)",
  () => {
    let proc: ChildProcess;
    let url: string;
    const port = 8811;

    beforeAll(async () => {
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

    it("REAL client factory joins a secret room and relays a signed signal (no drift)", async () => {
      const roomId = "integration-room-1";
      const roomSecret = "integration-secret";

      // The REAL client signing path: createSignalingSocketFactory injects
      // roomSecret into `join` (this server IS the configured self-hosted one,
      // A-3) and signs every `signal` with the canonical payload that the
      // server re-derives. If SyncService's normalization drifted from the
      // server's, the server would close the sender and the awaited relayed
      // message would never arrive.
      const hostSocket = createSignalingSocketFactory(roomSecret, roomId, {
        webSocketImpl: WsWebSocket as unknown as typeof WebSocket,
        selfHostedSignalingUrl: url,
      })(url);
      const hostWs = hostSocket as unknown as WsWebSocket;
      const hostInit = await nextMessage(hostWs);
      expect(hostInit.type).toBe("init");
      const hostPeerId: string = hostInit.yourPeerId;
      hostWs.send(JSON.stringify({ type: "join", room: roomId }));
      await nextMessage(hostWs); // joined

      const guestSocket = createSignalingSocketFactory(roomSecret, roomId, {
        webSocketImpl: WsWebSocket as unknown as typeof WebSocket,
        selfHostedSignalingUrl: url,
      })(url);
      const guestWs = guestSocket as unknown as WsWebSocket;
      const guestInit = await nextMessage(guestWs);
      const guestPeerId: string = guestInit.yourPeerId;
      guestWs.send(JSON.stringify({ type: "join", room: roomId }));
      await nextMessage(guestWs); // joined

      hostWs.send(
        JSON.stringify({
          type: "signal",
          senderPeerId: hostPeerId,
          receiverPeerId: guestPeerId,
          data: { sdp: "offer", someKey: 42 },
        }),
      );
      const sig = await nextMessage(guestWs);
      expect(sig.type).toBe("signal");
      expect(sig.senderPeerId).toBe(hostPeerId);
      expect(sig.receiverPeerId).toBe(guestPeerId);
      expect(sig.data).toEqual({ sdp: "offer", someKey: 42 });

      hostWs.close();
      guestWs.close();
      await waitClose(hostWs);
      await waitClose(guestWs);
    });

    it("server rejects a signal signed with client utilities but tampered data", async () => {
      // Tamper test using the REAL client utilities (deriveClientSignalKey +
      // canonicalSignalPayload), not the server-test mirror: sign for
      // data A, then send data B. The server must re-derive over B and close
      // the sender — proving the server's verification uses the exact same
      // normalization the client signs with.
      const roomId = "integration-room-2";
      const roomSecret = "integration-secret";

      // Raw socket (no factory) so we control the wire bytes; join manually
      // with the correct secret. Use the server-assigned peerId from init as
      // the sender — otherwise the server's anti-spoofing check (which runs
      // BEFORE the HMAC check) would close the connection and the test would
      // pass for the wrong reason (see reviewer feedback).
      const raw = await open(url);
      const init = await nextMessage(raw); // init
      const peerId: string = init.yourPeerId;
      raw.send(JSON.stringify({ type: "join", room: roomId, roomSecret }));
      await nextMessage(raw); // joined

      const receiverPeerId = "some-other-peer";
      const signedData = { sdp: "offer" };
      const tamperedData = { sdp: "EVIL-EDITED" };

      const key = await deriveClientSignalKey(roomSecret, roomId);
      const payloadForSignedData = canonicalSignalPayload(peerId, {
        receiverPeerId,
        data: signedData,
      });
      const sig = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(payloadForSignedData),
      );
      const signalAuth = Array.from(new Uint8Array(sig), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");

      // Send the auth computed over signedData, but ship tamperedData.
      raw.send(
        JSON.stringify({
          type: "signal",
          senderPeerId: peerId,
          receiverPeerId,
          data: tamperedData,
          signalAuth,
        }),
      );

      const closed = await new Promise<boolean>((resolvePromise) => {
        raw.once("close", () => resolvePromise(true));
        raw.once("error", () => resolvePromise(true));
        setTimeout(() => resolvePromise(false), 3000);
      });
      expect(closed).toBe(true);
      await waitClose(raw);
    });

    it("A-3: a client in public-relay mode sends NO roomSecret and cannot enter a secret room", async () => {
      // The other half of the A-3 contract, verified against the REAL server:
      // withholding the secret must be observable, not merely intended. The
      // host joins with the secret (self-hosted mode), and a client that does
      // not treat this server as its configured self-hosted one joins without
      // it — the server must reject that join, because the room is secret.
      const roomId = "integration-room-3";
      const roomSecret = "integration-secret";

      const hostSocket = createSignalingSocketFactory(roomSecret, roomId, {
        webSocketImpl: WsWebSocket as unknown as typeof WebSocket,
        selfHostedSignalingUrl: url,
      })(url);
      const hostWs = hostSocket as unknown as WsWebSocket;
      await nextMessage(hostWs); // init
      hostWs.send(JSON.stringify({ type: "join", room: roomId }));
      await nextMessage(hostWs); // joined

      // Public-relay semantics: no configured self-hosted server at all.
      const relayModeSocket = createSignalingSocketFactory(roomSecret, roomId, {
        webSocketImpl: WsWebSocket as unknown as typeof WebSocket,
        selfHostedSignalingUrl: null,
      })(url);
      let sentJoin = "";
      const relayModeWs = relayModeSocket as unknown as WsWebSocket;
      const nativeSend = relayModeWs.send.bind(relayModeWs);
      (relayModeWs as unknown as { send: (data: string) => void }).send = (
        data: string,
      ) => {
        sentJoin = data;
        nativeSend(data);
      };
      await nextMessage(relayModeWs); // init
      relayModeWs.send(JSON.stringify({ type: "join", room: roomId }));

      // The wire frame carried no secret…
      expect(JSON.parse(sentJoin)).toEqual({ type: "join", room: roomId });
      expect(sentJoin).not.toContain(roomSecret);

      // …and the server refused the join (the room already holds a secret it
      // cannot produce), closing the socket by policy rather than admitting it.
      await waitClose(relayModeWs);
      expect(relayModeWs.readyState).toBe(relayModeWs.CLOSED);

      hostWs.close();
      await waitClose(hostWs);
    });
  },
);
