import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "../../../server/src/index.ts");
const serverEntryExists = fs.existsSync(SERVER_ENTRY);

/**
 * Route-composition regression: the companion server's HTTP router must
 * actually mount every endpoint the browser calls (text generation, TTS,
 * image) plus the proxy diagnostics. Unit tests exercise handlers in
 * isolation; this file spawns the REAL server and proves the router wiring,
 * which previously only shipped `/api/services/ai/generate` while the
 * client called `/generate-tts` and `/generate-image` into the void.
 */
describe.skipIf(!serverEntryExists)(
  "companion server HTTP route composition",
  () => {
    let proc: ChildProcess;
    let base: string;
    const port = 8822;

    beforeAll(async () => {
      base = await new Promise<string>((resolvePromise, reject) => {
        const tsxBin = resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
        proc = spawn(process.execPath, [tsxBin, SERVER_ENTRY], {
          env: {
            ...process.env,
            PORT: String(port),
            HOST: "127.0.0.1",
            NODE_ENV: "test",
            GEMINI_API_KEY: "server-key",
            GEMINI_API_BASE: "http://127.0.0.1:1/v1beta/models",
            WHOP_LICENSE_API_URL: "http://127.0.0.1:1/license",
            WHOP_API_KEY: "license-key",
            LICENSE_PROVIDER_ALLOW_HTTP: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const timeout = setTimeout(
          () => reject(new Error("server start timeout")),
          8000,
        );
        proc.stdout?.on("data", (d: Buffer) => {
          if (d.toString().includes("Server running")) {
            clearTimeout(timeout);
            resolvePromise(`http://127.0.0.1:${port}`);
          }
        });
        proc.on("error", reject);
      });
    }, 15000);

    afterAll(() => {
      proc?.kill("SIGTERM");
    });

    it("routes text generation, TTS and image through the AI proxy", async () => {
      const headers = { "content-type": "application/json" };
      const generate = await fetch(`${base}/api/services/ai/generate`, {
        method: "POST",
        body: JSON.stringify({ prompt: "x" }),
        headers,
      });
      expect(generate.status).toBe(401);

      const tts = await fetch(`${base}/api/services/ai/generate-tts`, {
        method: "POST",
        body: JSON.stringify({ text: "x" }),
        headers,
      });
      expect(tts.status).toBe(401);

      const image = await fetch(`${base}/api/services/ai/generate-image`, {
        method: "POST",
        body: JSON.stringify({ prompt: "x" }),
        headers,
      });
      expect(image.status).toBe(401);

      // Bootstrap the same-origin session used by the browser. The session
      // route is deliberately the only auth path in the real router.
      const session = await fetch(`${base}/api/services/ai/session`, {
        method: "POST",
        body: "{}",
        headers,
      });
      expect(session.status).toBe(200);
      const csrf = (await session.json() as { csrfToken: string }).csrfToken;
      const setCookie = session.headers.get("set-cookie") ?? "";
      const cookie = setCookie
        .split(/,(?=[^;=]+=)/)
        .map((part) => part.split(";")[0]?.trim())
        .filter((part): part is string => Boolean(part))
        .join("; ");
      const authed = await fetch(`${base}/api/services/ai/generate-tts`, {
        method: "POST",
        body: JSON.stringify({ text: "x" }),
        headers: { ...headers, cookie, "x-csrf-token": csrf },
      });
      expect(authed.status).toBe(502);
    });

    it("serves the proxy admin and metrics routes", async () => {
      const admin = await fetch(`${base}/api/services/ai/admin`);
      expect(admin.status).toBe(503); // disabled without AI_PROXY_ADMIN_TOKEN

      const metrics = await fetch(`${base}/api/services/ai/metrics`);
      expect(metrics.status).toBe(405); // collector not configured
    });

    it("keeps /health and returns 426 for unknown routes", async () => {
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);

      const unknown = await fetch(`${base}/nope`);
      expect(unknown.status).toBe(426);
    });
  },
);
