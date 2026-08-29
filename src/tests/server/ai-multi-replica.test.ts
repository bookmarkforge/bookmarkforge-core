import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer, type AddressInfo, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiMediaHandler } from "../../../server/src/ai-media";
import { createGeminiProxyHandler } from "../../../server/src/ai-proxy";
import { createAiSessionManager } from "../../../server/src/ai-session";

const servers: Array<ReturnType<typeof createServer>> = [];
const redisServers: Array<ReturnType<typeof createNetServer>> = [];
const CRLF = String.fromCharCode(13, 10);

async function start(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return;
  (server as ReturnType<typeof createServer> & { closeAllConnections?: () => void }).closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function closeRedisServer(server: ReturnType<typeof createNetServer>): Promise<void> {
  if (!server.listening) return;
  (server as ReturnType<typeof createNetServer> & { destroyClients?: () => void }).destroyClients?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function respBulk(value: string | null): string {
  return value === null ? `$-1${CRLF}` : `$${Buffer.byteLength(value)}${CRLF}${value}${CRLF}`;
}

function startMiniRedis(): Promise<string> {
  const values = new Map<string, string>();
  const sockets = new Set<Socket>();
  const redis = createNetServer((socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let iterations = 0;
      while (iterations < 100) {
        iterations += 1;
        const lineEnd = buffer.indexOf(CRLF);
        if (lineEnd < 0 || buffer[0] !== 42) return;
        const count = Number(buffer.subarray(1, lineEnd).toString());
        let offset = lineEnd + CRLF.length;
        const parts: string[] = [];
        let complete = Number.isInteger(count) && count >= 0 && count <= 100;
        for (let i = 0; complete && i < count; i += 1) {
          const headerEnd = buffer.indexOf(CRLF, offset);
          if (headerEnd < 0 || buffer[offset] !== 36) { complete = false; break; }
          const length = Number(buffer.subarray(offset + 1, headerEnd).toString());
          const start = headerEnd + CRLF.length;
          const end = start + length;
          if (!Number.isInteger(length) || length < 0 || length > 4 * 1024 * 1024 || buffer.length < end + CRLF.length) {
            complete = false;
            break;
          }
          parts.push(buffer.subarray(start, end).toString());
          offset = end + CRLF.length;
        }
        if (!complete) return;
        buffer = buffer.subarray(offset);
        const command = parts[0]?.toUpperCase();
        if (command === "GET") socket.write(respBulk(values.get(parts[1] ?? "") ?? null));
        else if (command === "SET") {
          values.set(parts[1] ?? "", parts[2] ?? "");
          socket.write(`+OK${CRLF}`);
        } else if (command === "DEL") {
          socket.write(`:${values.delete(parts[1] ?? "") ? 1 : 0}${CRLF}`);
        } else if (command === "EVAL") {
          socket.write(`:1${CRLF}`);
        } else if (command === "SCAN") {
          socket.write(`*2${CRLF}$1${CRLF}0${CRLF}*0${CRLF}`);
        } else {
          socket.write(`-ERR unsupported test command${CRLF}`);
        }
      }
    });
  });
  (redis as ReturnType<typeof createNetServer> & { destroyClients?: () => void }).destroyClients = () => {
    for (const socket of sockets) socket.destroy();
  };
  redisServers.push(redis);
  return new Promise<string>((resolve) => {
    redis.listen(0, "127.0.0.1", () => {
      const address = redis.address() as AddressInfo;
      resolve(`redis://127.0.0.1:${address.port}`);
    });
  });
}

function cookieHeader(setCookie: string): string {
  return setCookie
    .split(/,(?=[^;=]+=)/)
    .map((part) => part.split(";")[0]?.trim())
    .filter((part): part is string => Boolean(part))
    .join("; ");
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(redisServers.splice(0).map(closeRedisServer));
});

describe("AI HTTP multi-replica session flow", () => {
  it("creates on replica A and serves text, TTS, and image on replica B", async () => {
    const redisUrl = await startMiniRedis();
    const replicaA = createAiSessionManager({ requireLicense: false, redisUrl });
    const replicaB = createAiSessionManager({ requireLicense: false, redisUrl });
    const upstream = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith(":generateContent") && String(init?.body).includes("responseModalities")) {
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { data: "audio-from-b" } }] } }],
        }), { status: 200 });
      }
      if (url.endsWith(":predict")) {
        return new Response(JSON.stringify({ predictions: [{ bytesBase64: "image-from-b" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "text-from-b" }] } }],
      }), { status: 200 });
    });
    const textHandler = createGeminiProxyHandler({
      apiKey: "server-key",
      sessionManager: replicaB,
      identityRateLimit: 100,
      dailyQuota: 100,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const mediaHandler = createGeminiMediaHandler({
      apiKey: "server-key",
      sessionManager: replicaB,
      accessPolicy: textHandler.accessPolicy,
      fetchImpl: upstream as unknown as typeof fetch,
    });

    const baseA = await start((req, res) => {
      if (req.url === "/api/services/ai/session") {
        void replicaA.createSessionHandler()(req, res);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const baseB = await start((req, res) => {
      if (req.url === "/api/services/ai/generate") {
        void textHandler(req, res);
        return;
      }
      if (req.url === "/api/services/ai/generate-tts" || req.url === "/api/services/ai/generate-image") {
        void mediaHandler(req, res);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const session = await fetch(`${baseA}/api/services/ai/session`, { method: "POST", body: "{}" });
    expect(session.status).toBe(200);
    const csrf = (await session.json() as { csrfToken: string }).csrfToken;
    const cookie = cookieHeader(session.headers.get("set-cookie") ?? "");
    const headers = { "content-type": "application/json", cookie, "x-csrf-token": csrf };

    const text = await fetch(`${baseB}/api/services/ai/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: "hello", model: "gemini-2.0-flash" }),
    });
    expect(text.status).toBe(200);
    expect(await text.json()).toEqual({ text: "text-from-b" });

    const tts = await fetch(`${baseB}/api/services/ai/generate-tts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "hola" }),
    });
    expect(tts.status).toBe(200);
    expect(await tts.json()).toEqual({ audioBase64: "audio-from-b" });

    const image = await fetch(`${baseB}/api/services/ai/generate-image`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: "logo" }),
    });
    expect(image.status).toBe(200);
    expect(await image.json()).toEqual({ imageBase64: "image-from-b" });
    expect(upstream).toHaveBeenCalledTimes(3);
  });
});
