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
 * answer all remaining endpoints (license, health, admin, CSP, analytics).
 * Unit tests exercise handlers in isolation; this file spawns the REAL
 * server and proves the router wiring.
 */
describe("companion server HTTP route composition", () => {
  let proc: ChildProcess;
  let base: string;
  const port = 8822;

  beforeAll(async () => {
    if (!serverEntryExists) {
      throw new Error("server/src/index.ts is required for route composition tests");
    }
    base = await new Promise<string>((resolvePromise, reject) => {
      const tsxBin = resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
      proc = spawn(process.execPath, [tsxBin, SERVER_ENTRY], {
        env: {
          ...process.env,
          PORT: String(port),
          HOST: "127.0.0.1",
          NODE_ENV: "test",
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

  it("keeps /health and returns 426 for unknown routes", async () => {
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);

    const unknown = await fetch(`${base}/nope`);
    expect(unknown.status).toBe(426);
  });
});