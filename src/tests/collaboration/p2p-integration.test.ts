import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { WebSocketServer, WebSocket as WsSocket } from "ws";
import { createServer } from "http";
import type { Server } from "http";

describe("P2P WebSocket Integration", () => {
  let server: ReturnType<typeof createServer>;
  let wss: WebSocketServer;
  let port: number;

  function createWSS(skipDefaultHandler = false): Promise<number> {
    return new Promise((resolve) => {
      server = createServer();
      wss = new WebSocketServer({ server });

      if (!skipDefaultHandler) {
        wss.on("connection", (ws) => {
          ws.on("message", (data) => {
            wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === WsSocket.OPEN) {
                client.send(data.toString());
              }
            });
          });
        });
      }

      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve(port);
      });
    });
  }

  beforeEach(async () => {
    await createWSS();
  });

  afterEach(() => {
    wss.close();
    server.close();
  });

  it("two clients can exchange messages via the server", async () => {
    const receivedA: string[] = [];
    const receivedB: string[] = [];

    const wsA = new WsSocket(`ws://127.0.0.1:${port}`);
    const wsB = new WsSocket(`ws://127.0.0.1:${port}`);

    await Promise.all([
      new Promise<void>((resolve) => wsA.on("open", () => resolve())),
      new Promise<void>((resolve) => wsB.on("open", () => resolve())),
    ]);

    wsA.on("message", (data) => receivedA.push(data.toString()));
    wsB.on("message", (data) => receivedB.push(data.toString()));

    wsA.send(JSON.stringify({ type: "hello", from: "A" }));
    wsB.send(JSON.stringify({ type: "hello", from: "B" }));

    await new Promise((r) => setTimeout(r, 300));

    expect(receivedA.length).toBeGreaterThanOrEqual(1);
    expect(receivedB.length).toBeGreaterThanOrEqual(1);
    const msgA = JSON.parse(receivedA.find((m) => m.includes("hello")) || "{}");
    const msgB = JSON.parse(receivedB.find((m) => m.includes("hello")) || "{}");
    expect(msgA.from).toBe("B");
    expect(msgB.from).toBe("A");

    wsA.close();
    wsB.close();
  });

  it("server echoes presence events to other clients", async () => {
    const receivedB: string[] = [];

    const wsA = new WsSocket(`ws://127.0.0.1:${port}`);
    const wsB = new WsSocket(`ws://127.0.0.1:${port}`);

    await Promise.all([
      new Promise<void>((resolve) => wsA.on("open", () => resolve())),
      new Promise<void>((resolve) => wsB.on("open", () => resolve())),
    ]);

    wsB.on("message", (data) => receivedB.push(data.toString()));

    wsA.send(JSON.stringify({ type: "presence", users: ["alice"] }));

    await new Promise((r) => setTimeout(r, 300));

    const presenceMsg = receivedB.find((m) => m.includes("presence"));
    expect(presenceMsg).toBeTruthy();
    const parsed = JSON.parse(presenceMsg || "{}");
    expect(parsed.type).toBe("presence");

    wsA.close();
    wsB.close();
  });

  it("server broadcasts message from one client to all others", async () => {
    const receivedB: string[] = [];
    const receivedC: string[] = [];

    const wsA = new WsSocket(`ws://127.0.0.1:${port}`);
    const wsB = new WsSocket(`ws://127.0.0.1:${port}`);
    const wsC = new WsSocket(`ws://127.0.0.1:${port}`);

    await Promise.all([
      new Promise<void>((resolve) => wsA.on("open", () => resolve())),
      new Promise<void>((resolve) => wsB.on("open", () => resolve())),
      new Promise<void>((resolve) => wsC.on("open", () => resolve())),
    ]);

    wsB.on("message", (data) => receivedB.push(data.toString()));
    wsC.on("message", (data) => receivedC.push(data.toString()));

    wsA.send(JSON.stringify({ type: "broadcast", text: "hello everyone" }));

    await new Promise((r) => setTimeout(r, 300));

    expect(receivedB.some((m) => m.includes("broadcast"))).toBe(true);
    expect(receivedC.some((m) => m.includes("broadcast"))).toBe(true);

    wsA.close();
    wsB.close();
    wsC.close();
  });

  it("client reconnection after disconnect", async () => {
    const ws = new WsSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    let disconnected = false;
    ws.on("close", () => {
      disconnected = true;
    });

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(disconnected).toBe(true);

    const ws2 = new WsSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws2.on("open", () => resolve()));
    expect(ws2.readyState).toBe(WsSocket.OPEN);

    ws2.close();
  });

  it("server handles multiple concurrent connections", async () => {
    const numClients = 10;
    const clients: WsSocket[] = [];
    const openPromises: Promise<void>[] = [];

    for (let i = 0; i < numClients; i++) {
      const ws = new WsSocket(`ws://127.0.0.1:${port}`);
      clients.push(ws);
      openPromises.push(
        new Promise((resolve) => ws.on("open", () => resolve())),
      );
    }

    await Promise.all(openPromises);

    const clientStates = clients.map((c) => c.readyState);
    expect(clientStates.every((s) => s === WsSocket.OPEN)).toBe(true);

    for (const c of clients) c.close();
  });

  it("message with room filter is only received by matching clients", async () => {
    wss.close();
    server.close();

    const clientRooms = new WeakMap<WsSocket, string>();

    await new Promise<void>((resolve) => {
      server = createServer();
      wss = new WebSocketServer({ server });

      wss.on("connection", (ws, req) => {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        const roomId = url.searchParams.get("roomId") || "default";
        clientRooms.set(ws, roomId);

        ws.on("message", (data) => {
          wss.clients.forEach((client) => {
            if (client === ws || client.readyState !== WsSocket.OPEN) return;
            const targetRoom = clientRooms.get(client);
            if (targetRoom && targetRoom !== roomId) return;
            client.send(data.toString());
          });
        });
      });

      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });

    const roomAMsgs: string[] = [];
    const roomBMsgs: string[] = [];

    const wsA = new WsSocket(`ws://127.0.0.1:${port}?roomId=alpha`);
    const wsB = new WsSocket(`ws://127.0.0.1:${port}?roomId=alpha`);
    const wsC = new WsSocket(`ws://127.0.0.1:${port}?roomId=beta`);

    await Promise.all([
      new Promise<void>((resolve) => wsA.on("open", () => resolve())),
      new Promise<void>((resolve) => wsB.on("open", () => resolve())),
      new Promise<void>((resolve) => wsC.on("open", () => resolve())),
    ]);

    wsB.on("message", (data) => roomAMsgs.push(data.toString()));
    wsC.on("message", (data) => roomBMsgs.push(data.toString()));

    wsA.send(JSON.stringify({ type: "chat", text: "hello alpha" }));

    await new Promise((r) => setTimeout(r, 300));

    expect(roomAMsgs.length).toBeGreaterThanOrEqual(1);
    expect(roomBMsgs.length).toBe(0);

    wsA.close();
    wsB.close();
    wsC.close();
  });
});
