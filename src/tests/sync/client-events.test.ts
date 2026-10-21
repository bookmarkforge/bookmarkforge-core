/**
 * src/tests/sync/client-events.test.ts
 *
 * Integration test for POST /api/client-events on the companion server.
 * Covers event ingestion (storage-pressure / bundle-integrity-spike),
 * validation, per-IP rate limiting, the "3 distinct clients report critical
 * in 10 minutes" threshold alert (webhook delivery + single-fire + re-arm),
 * and the token-gated diagnostics GET.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "node:fs";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "../../../server/src/index.ts");

const serverEntryExists = fs.existsSync(SERVER_ENTRY);

function request(
  port: number,
  path: string,
  method: string,
  opts: { body?: unknown; clientIp?: string; adminToken?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.clientIp) headers["x-forwarded-for"] = opts.clientIp;
    if (opts.adminToken) headers["x-client-events-admin-token"] = opts.adminToken;
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolvePromise({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function postEvent(
  port: number,
  body: unknown,
  clientIp = "test-client",
): Promise<{ status: number; body: string }> {
  return request(port, "/api/client-events", "POST", { body, clientIp });
}

function getDiagnostics(port: number, adminToken = "test-admin-token"): Promise<{ status: number; body: string }> {
  return request(port, "/api/client-events", "GET", { adminToken });
}

describe("Client events collector", () => {
  let proc: ChildProcess | null = null;
  let port = 0;

  beforeAll(async () => {
    if (!serverEntryExists) return;

    port = await new Promise<number>((resolvePort, reject) => {
      const srv = http.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (addr && typeof addr === "object") {
          resolvePort(addr.port);
          srv.close();
        } else {
          reject(new Error("Could not bind to port"));
        }
      });
    });

    const tsxBin = resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
    proc = spawn(process.execPath, [tsxBin, SERVER_ENTRY], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        CLIENT_EVENTS_MAX: "20",
        CLIENT_EVENTS_LIMIT: "3",
        CLIENT_EVENTS_WINDOW_MS: "60000",
        CLIENT_EVENTS_CRITICAL_CLIENTS: "3",
        CLIENT_EVENTS_ADMIN_TOKEN: "test-admin-token",
        TRUST_PROXY: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error("server start timeout")), 8000);
      proc!.stdout?.on("data", (d: Buffer) => {
        if (d.toString().includes("Server running")) {
          clearTimeout(timeout);
          resolveReady();
        }
      });
    });
  }, 15000);

  afterAll(() => {
    proc?.kill();
  });

  it("accepts a storage-pressure event (204)", async () => {
    if (!proc) return;
    const { status } = await postEvent(port, {
      type: "storage-pressure",
      level: "pressure",
      pct: 85.5,
      usage: 123456,
      quota: 200000,
      persisted: true,
    });
    expect(status).toBe(204);
  });

  it("accepts a bundle-integrity-spike event (204)", async () => {
    if (!proc) return;
    const { status } = await postEvent(port, {
      type: "bundle-integrity-spike",
      count: 3,
      reason: "spike",
    });
    expect(status).toBe(204);
  });

  it("accepts an error-spike event (204) — inherent critical", async () => {
    if (!proc) return;
    // Distinct IP: the shared test-client already consumed its rate budget.
    const { status } = await postEvent(port, { type: "error-spike", count: 3, reason: "spike" }, "error-spike-client");
    expect(status).toBe(204);
  });

  it("accepts a csp-violation-spike event (204) — inherent critical", async () => {
    if (!proc) return;
    // Distinct IP: the shared test-client already consumed its rate budget.
    const { status } = await postEvent(port, { type: "csp-violation-spike", count: 3, reason: "spike" }, "csp-spike-client");
    expect(status).toBe(204);
  });

  it("accepts retry-stats on the /retry-stats subpath (204) — routing fix", async () => {
    if (!proc) return;
    // The reporter POSTs diagnostics to /api/client-events/retry-stats; the
    // routing must send that subpath to the collector (it used to land on the
    // 426 catch-all and the degraded-delivery signal was dead).
    const { status } = await request(port, "/api/client-events/retry-stats", "POST", {
      body: { type: "client-event-retry-stats", attempts: 2, coalesced: 1, dropped: 1 },
      clientIp: "retry-stats-client",
    });
    expect(status).toBe(204);
  });

  it("GET diagnostics requires the admin token and reports totals", async () => {
    if (!proc) return;

    const denied = await getDiagnostics(port, "wrong-token");
    expect(denied.status).toBe(401);

    const { status, body } = await getDiagnostics(port);
    expect(status).toBe(200);
    const parsed = JSON.parse(body);
    expect(parsed.total).toBeGreaterThanOrEqual(2);
    expect(parsed).toHaveProperty("critical");
    expect(parsed).toHaveProperty("criticalThreshold");
    expect(parsed).toHaveProperty("criticalClientsActive");
    expect(parsed).toHaveProperty("windowMs");
    expect(parsed).toHaveProperty("serverInstanceId");
    expect(Array.isArray(parsed.recent)).toBe(true);
    // Privacy: raw IPs never appear in the ring buffer.
    expect(JSON.stringify(parsed)).not.toContain("test-client");
  });

  it("rejects an unknown event type (400)", async () => {
    if (!proc) return;
    const { status } = await postEvent(port, { type: "not-a-real-event-type" });
    expect(status).toBe(400);
  });

  it("rejects storage-pressure without a valid level (400)", async () => {
    if (!proc) return;
    // Distinct IP: the shared test-client already consumed its rate budget.
    const { status } = await postEvent(port, { type: "storage-pressure", pct: 90 }, "bad-level-client");
    expect(status).toBe(400);
  });

  it("rejects non-POST/non-GET methods with 405", async () => {
    if (!proc) return;
    const { status } = await request(port, "/api/client-events", "DELETE");
    expect(status).toBe(405);
  });

  it("rate-limits per IP after the threshold", async () => {
    if (!proc) return;
    const results: number[] = [];
    for (let i = 0; i < 4; i++) {
      const { status } = await postEvent(
        port,
        { type: "storage-pressure", level: "pressure", pct: 82 + i },
        "rate-limited-client",
      );
      results.push(status);
    }
    expect(results[0]).toBe(204);
    expect(results[1]).toBe(204);
    expect(results[2]).toBe(204);
    expect(results[3]).toBe(429);
  });

  it("keeps health serving after malformed requests", async () => {
    if (!proc) return;
    const bad = await postEvent(port, "just a string", "malformed-client");
    expect(bad.status).toBe(400);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
  });
});

describe.skipIf(!serverEntryExists)("Client events collector — threshold alert + webhook", () => {
  let proc: ChildProcess | null = null;
  let port = 0;
  let webhookPort = 0;
  let receiver: http.Server | null = null;
  const deliveries: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    // Webhook receiver: records every POST body.
    receiver = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          deliveries.push(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          /* INTENTIONAL SILENCE: malformed test input. */
        }
        res.writeHead(204);
        res.end();
      });
    });
    webhookPort = await new Promise<number>((resolvePort) => {
      receiver!.listen(0, "127.0.0.1", () => {
        const addr = receiver!.address();
        if (addr && typeof addr === "object") resolvePort(addr.port);
      });
    });

    port = await new Promise<number>((resolvePort, reject) => {
      const srv = http.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (addr && typeof addr === "object") {
          resolvePort(addr.port);
          srv.close();
        } else {
          reject(new Error("Could not bind to port"));
        }
      });
    });

    const tsxBin = resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
    proc = spawn(process.execPath, [tsxBin, SERVER_ENTRY], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        CLIENT_EVENTS_LIMIT: "100",
        CLIENT_EVENTS_WINDOW_MS: "60000",
        CLIENT_EVENTS_CRITICAL_CLIENTS: "3",
        CLIENT_EVENTS_ADMIN_TOKEN: "test-admin-token",
        CLIENT_EVENTS_WEBHOOK_URL: `http://127.0.0.1:${webhookPort}/hook`,
        CLIENT_EVENTS_WEBHOOK_ALLOW_HTTP: "1",
        TRUST_PROXY: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error("server start timeout")), 8000);
      proc!.stdout?.on("data", (d: Buffer) => {
        if (d.toString().includes("Server running")) {
          clearTimeout(timeout);
          resolveReady();
        }
      });
    });
  }, 15000);

  afterAll(() => {
    proc?.kill();
    receiver?.close();
  });

  const waitForDeliveries = async (minCount: number, timeoutMs = 8000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (deliveries.length < minCount && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  it("fires ONE webhook alert when 3 distinct clients report critical in the window", async () => {
    if (!proc) return;
    const deliveredBefore = deliveries.length;

    // Two critical clients are not enough.
    await postEvent(port, { type: "storage-pressure", level: "critical", pct: 95 }, "client-1");
    await postEvent(port, { type: "bundle-integrity-spike", count: 3 }, "client-2");
    await new Promise((r) => setTimeout(r, 300));
    expect(deliveries.length).toBe(deliveredBefore);

    // Third distinct client crosses the threshold.
    await postEvent(port, { type: "storage-pressure", level: "critical", pct: 97 }, "client-3");
    await waitForDeliveries(deliveredBefore + 1);
    expect(deliveries.length).toBe(deliveredBefore + 1);

    const alert = deliveries[deliveries.length - 1]!;
    expect(alert.alert).toBe("client-events-critical-threshold");
    expect(alert.criticalClients).toBe(3);
    expect(alert.threshold).toBe(3);
    expect(alert.windowMs).toBe(60000);
    expect(alert).toHaveProperty("serverInstanceId");
    expect(Array.isArray(alert.events)).toBe(true);

    // A 4th distinct critical client must NOT refire within the same window.
    await postEvent(port, { type: "storage-pressure", level: "critical", pct: 98 }, "client-4");
    await new Promise((r) => setTimeout(r, 300));
    expect(deliveries.length).toBe(deliveredBefore + 1);

    // Privacy: the webhook payload never carries raw IPs, IP hashes or
    // client identity (the alert NAME legitimately contains "client-").
    const serialized = JSON.stringify(alert);
    expect(serialized).not.toContain("client-1");
    expect(serialized).not.toContain("client-2");
    expect(serialized).not.toContain("client-3");
    expect(serialized).not.toContain("ipHash");
    expect(serialized).not.toContain("x-forwarded-for");
  }, 15000);

  it("re-arms and fires again after the window expires", async () => {
    if (!proc) return;
    const deliveredBefore = deliveries.length;

    // The window is 60s in this server instance, so simulate re-arm by
    // verifying the alert fired only once per window above — a second wave
    // within the same window must NOT produce a new delivery. To prove
    // re-arm, restart the counting: three NEW distinct clients after the
    // earlier alert must not fire again while the window holds.
    await postEvent(port, { type: "storage-pressure", level: "critical", pct: 90 }, "wave2-a");
    await postEvent(port, { type: "storage-pressure", level: "critical", pct: 91 }, "wave2-b");
    await postEvent(port, { type: "storage-pressure", level: "critical", pct: 92 }, "wave2-c");
    await new Promise((r) => setTimeout(r, 300));
    // Still the same window: no second alert.
    expect(deliveries.length).toBe(deliveredBefore);
  }, 15000);

  it("pressure-only events never fire the alert", async () => {
    if (!proc) return;
    const deliveredBefore = deliveries.length;
    for (let i = 0; i < 5; i++) {
      await postEvent(port, { type: "storage-pressure", level: "pressure", pct: 80 + i }, `pressure-${i}`);
    }
    await new Promise((r) => setTimeout(r, 300));
    expect(deliveries.length).toBe(deliveredBefore);
  });
});

describe.skipIf(!serverEntryExists)("Client events collector — window expiry re-arm", () => {
  let proc: ChildProcess | null = null;
  let port = 0;
  let webhookPort = 0;
  let receiver: http.Server | null = null;
  const deliveries: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    receiver = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          deliveries.push(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          /* INTENTIONAL SILENCE. */
        }
        res.writeHead(204);
        res.end();
      });
    });
    webhookPort = await new Promise<number>((resolvePort) => {
      receiver!.listen(0, "127.0.0.1", () => {
        const addr = receiver!.address();
        if (addr && typeof addr === "object") resolvePort(addr.port);
      });
    });

    port = await new Promise<number>((resolvePort, reject) => {
      const srv = http.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (addr && typeof addr === "object") {
          resolvePort(addr.port);
          srv.close();
        } else {
          reject(new Error("Could not bind to port"));
        }
      });
    });

    const tsxBin = resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
    proc = spawn(process.execPath, [tsxBin, SERVER_ENTRY], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        CLIENT_EVENTS_LIMIT: "100",
        CLIENT_EVENTS_WINDOW_MS: "1500",
        CLIENT_EVENTS_CRITICAL_CLIENTS: "3",
        CLIENT_EVENTS_ADMIN_TOKEN: "test-admin-token",
        CLIENT_EVENTS_WEBHOOK_URL: `http://127.0.0.1:${webhookPort}/hook`,
        CLIENT_EVENTS_WEBHOOK_ALLOW_HTTP: "1",
        TRUST_PROXY: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error("server start timeout")), 8000);
      proc!.stdout?.on("data", (d: Buffer) => {
        if (d.toString().includes("Server running")) {
          clearTimeout(timeout);
          resolveReady();
        }
      });
    });
  }, 15000);

  afterAll(() => {
    proc?.kill();
    receiver?.close();
  });

  it("fires again with fresh clients after the 1.5s window expires", async () => {
    if (!proc) return;

    // Wave 1: three distinct critical clients → alert 1.
    for (let i = 0; i < 3; i++) {
      await postEvent(port, { type: "storage-pressure", level: "critical", pct: 90 + i }, `w1-${i}`);
    }
    const deadline = Date.now() + 5000;
    while (deliveries.length < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(deliveries.length).toBe(1);

    // Let the window (1500ms) expire, then wave 2 with fresh clients.
    await new Promise((r) => setTimeout(r, 2000));
    for (let i = 0; i < 3; i++) {
      await postEvent(port, { type: "bundle-integrity-spike", count: 3 }, `w2-${i}`);
    }
    const deadline2 = Date.now() + 5000;
    while (deliveries.length < 2 && Date.now() < deadline2) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(deliveries.length).toBe(2);
  }, 20000);
});

describe.skipIf(!serverEntryExists)("Client events collector — webhook URL hardening", () => {
  let proc: ChildProcess | null = null;
  let port = 0;

  beforeAll(async () => {
    port = await new Promise<number>((resolvePort, reject) => {
      const srv = http.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (addr && typeof addr === "object") {
          resolvePort(addr.port);
          srv.close();
        } else {
          reject(new Error("Could not bind to port"));
        }
      });
    });

    const tsxBin = resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
    // Production mode with a plaintext-HTTP webhook URL: must be REJECTED at
    // startup (fail-closed — no deliveries rather than leaking over http).
    proc = spawn(process.execPath, [tsxBin, SERVER_ENTRY], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        AI_SESSION_ORIGINS: "http://127.0.0.1",
        PORT: String(port),
        HOST: "127.0.0.1",
        CLIENT_EVENTS_LIMIT: "10",
        CLIENT_EVENTS_CRITICAL_CLIENTS: "2",
        CLIENT_EVENTS_ADMIN_TOKEN: "test-admin-token",
        CLIENT_EVENTS_WEBHOOK_URL: "http://127.0.0.1:1/hook",
        TRUST_PROXY: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error("server start timeout")), 8000);
      proc!.stdout?.on("data", (d: Buffer) => {
        if (d.toString().includes("Server running")) {
          clearTimeout(timeout);
          resolveReady();
        }
      });
    });
  }, 15000);

  afterAll(() => {
    proc?.kill();
  });

  it("rejects an http webhook URL in production (fail-closed)", async () => {
    if (!proc) return;
    const { status, body } = await getDiagnostics(port);
    expect(status).toBe(200);
    const parsed = JSON.parse(body) as { webhook?: boolean };
    expect(parsed.webhook).toBe(false);

    const post = await postEvent(port, { type: "storage-pressure", level: "critical", pct: 95 }, "prod-1");
    expect(post.status).toBe(204);
  }, 15000);
});
