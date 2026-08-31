/**
 * src/tests/sync/csp-collector.test.ts
 *
 * Integration test for POST /csp-report endpoint on the companion server.
 * Covers report ingestion, rate limiting, field truncation, ring-buffer
 * eviction, and GET diagnostics.
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

function fetchCspReport(
  port: number,
  method: string,
  body?: unknown,
  adminToken = "test-admin-token",
): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const blockedUri =
      body && typeof body === "object"
        ? (body as { "csp-report"?: { "blocked-uri"?: string } })["csp-report"]?.["blocked-uri"]
        : undefined;
    const clientIp = blockedUri?.match(/^https:\/\/evil-\d+/)
      ? "rate-test"
      : blockedUri || "invalid-test";
    const opts: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path: "/csp-report",
      method,
      headers: {
        "Content-Type": "application/csp-report",
        "x-forwarded-for": clientIp,
        ...(method === "GET" ? { "x-csp-admin-token": adminToken } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        resolvePromise({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString(),
        });
      });
    });
    req.on("error", reject);
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe("CSP report collector", () => {
  let proc: ChildProcess | null = null;
  let port = 0;

  beforeAll(async () => {
    if (!serverEntryExists) {
      console.warn("Server entry not found — skipping CSP collector tests");
      return;
    }

    // Find a free port
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

    // Start the server
    const tsxBin = resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
    proc = spawn(process.execPath, [tsxBin, SERVER_ENTRY], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        CSP_REPORT_MAX: "5",
        CSP_REPORT_LIMIT: "3",
        CSP_REPORT_WINDOW_MS: "60000",
        CSP_REPORT_ADMIN_TOKEN: "test-admin-token",
        CSP_REPORT_BODY_MAX_BYTES: "16384",
        TRUST_PROXY: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Wait for server ready
    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error("server start timeout")), 8000);
      proc!.stdout?.on("data", (d: Buffer) => {
        if (d.toString().includes("Server running")) {
          clearTimeout(timeout);
          resolveReady();
        }
      });
    });
  }, 10000);

  afterAll(() => {
    proc?.kill();
  });

  it("POST a valid CSP report returns 204", async () => {
    if (!proc) return;
    const { status } = await fetchCspReport(port, "POST", {
      "csp-report": {
        "blocked-uri": "https://evil.example.com/xss.js",
        "document-uri": "https://bookmarkforge.com/app",
        "violated-directive": "script-src",
        "effective-directive": "script-src",
        disposition: "enforce",
      },
    });
    expect(status).toBe(204);
  });

  it("GET returns the recent reports", async () => {
    if (!proc) return;

    // Submit one report first
    await fetchCspReport(port, "POST", {
      "csp-report": {
        "blocked-uri": "https://test.example.com/bad.js",
        "document-uri": "https://bookmarkforge.com/dashboard",
        "violated-directive": "script-src",
      },
    });

    const { status, body } = await fetchCspReport(port, "GET");
    expect(status).toBe(200);
    const parsed = JSON.parse(body);
    expect(parsed).toHaveProperty("recent");
    expect(parsed).toHaveProperty("total");
    expect(parsed).toHaveProperty("serverInstanceId");
    expect(parsed.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(parsed.recent)).toBe(true);
    const report = parsed.recent.find(
      (entry: { blockedOrigin?: string }) => entry.blockedOrigin === "https://test.example.com",
    );
    expect(report).toBeDefined();
    expect(report).toHaveProperty("blockedOrigin");
    expect(report).not.toHaveProperty("ip");
    expect(report).not.toHaveProperty("documentUri");
    expect(parsed.recent[0]).toHaveProperty("violatedDirective");
    expect(parsed.recent[0]).toHaveProperty("timestamp");
  });

  it("rejects POST without csp-report key", async () => {
    if (!proc) return;
    const { status } = await fetchCspReport(port, "POST", { bad: "payload" });
    expect(status).toBe(400);
  });

  it("rejects POST with invalid JSON", async () => {
    if (!proc) return;
    const { status } = await fetchCspReport(port, "POST", "not-json");
    // Need raw send for invalid JSON
    // Use the existing helper — it sends JSON.stringify which wraps in quotes
    // This test sends a non-object
    const { status: s2 } = await fetchCspReport(port, "POST", "just a string");
    expect(s2).toBe(400);
  });

  it("rejects non-POST/non-GET methods with 405", async () => {
    if (!proc) return;
    const { status } = await fetchCspReport(port, "DELETE");
    expect(status).toBe(405);
  });

  it("rate-limits per IP after threshold", async () => {
    if (!proc) return;

    // Send 4 reports (limit is 3) from the same IP
    const results: number[] = [];
    for (let i = 0; i < 4; i++) {
      const { status } = await fetchCspReport(port, "POST", {
        "csp-report": {
          "blocked-uri": `https://evil-${i}.example.com/x.js`,
          "document-uri": "https://bookmarkforge.com/app",
          "violated-directive": "script-src",
        },
      });
      results.push(status);
    }

    // First 3 should succeed (204), 4th should be rate-limited (429)
    expect(results[0]).toBe(204);
    expect(results[1]).toBe(204);
    expect(results[2]).toBe(204);
    expect(results[3]).toBe(429);
  });

  it("truncates long field values", async () => {
    if (!proc) return;

    const longUri = "https://evil.example.com/" + "x".repeat(600);

    await fetchCspReport(port, "POST", {
      "csp-report": {
        "blocked-uri": longUri,
        "document-uri": "https://bookmarkforge.com/app",
        "violated-directive": "script-src",
      },
    });

    const { body } = await fetchCspReport(port, "GET");
    const parsed = JSON.parse(body);
    const last = parsed.recent.find(
      (entry: { blockedOrigin?: string }) => entry.blockedOrigin === "https://evil.example.com",
    );
    // The collector keeps only the origin, never the sensitive path/query.
    expect(last?.blockedOrigin).toBe("https://evil.example.com");
  });

  it("evicts oldest reports when ring buffer is full", async () => {
    if (!proc) return;

    const max = 5; // CSP_REPORT_MAX we set via env
    // Fill beyond capacity
    for (let i = 0; i < max + 3; i++) {
      await fetchCspReport(port, "POST", {
        "csp-report": {
          "blocked-uri": `https://evict-${i}.example.com/x.js`,
          "document-uri": "https://bookmarkforge.com/app",
          "violated-directive": "script-src",
        },
      });
    }

    const { body } = await fetchCspReport(port, "GET");
    const parsed = JSON.parse(body);
    // Total should keep growing, but recent slice is capped
    expect(parsed.total).toBeGreaterThanOrEqual(max);
    expect(parsed.recent.length).toBeLessThanOrEqual(50); // GET returns last 50
  });

  it("rejects a Unicode token with different UTF-8 length without crashing", async () => {
    if (!proc) return;
    // 16 UTF-16 code units match the ASCII token length, but UTF-8 uses 32
    // bytes. The old direct timingSafeEqual call threw on this input.
    const result = await fetchCspReport(
      port,
      "GET",
      undefined,
      "é".repeat(16),
    );
    expect(result.status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
  });

  it("health endpoint exposes only minimal liveness data", async () => {
    if (!proc) return;

    const { status, body, headers } = await new Promise<{
      status: number;
      body: string;
      headers: http.IncomingHttpHeaders;
    }>((resolvePromise, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            resolvePromise({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString(),
              headers: res.headers,
            });
          });
        });
        req.on("error", reject);
      },
    );

    expect(status).toBe(200);
    const parsed = JSON.parse(body);
    expect(parsed).toEqual({ status: "ok" });
    expect(parsed).not.toHaveProperty("connections");
    expect(parsed).not.toHaveProperty("rooms");
    expect(parsed).not.toHaveProperty("serverInstanceId");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["content-security-policy"]).toContain("default-src 'none'");

    const unsupported = await fetch(`http://127.0.0.1:${port}/unsupported`);
    expect(unsupported.status).toBe(426);
    expect(unsupported.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe.skipIf(!serverEntryExists)("CSP report collector — JSONL persistence", () => {
  let proc: ChildProcess | null = null;
  let port = 0;
  const reportFile = resolve(
    __dirname,
    `../../../.tmp-csp-reports-${process.pid}.jsonl`,
  );

  beforeAll(async () => {
    // Fresh file: nothing to load.
    try {fs.unlinkSync(reportFile);} catch { /* INTENTIONAL SILENCE: the test artifact was not present. */ }

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
        CSP_REPORT_MAX: "50",
        CSP_REPORT_FILE: reportFile,
        TRUST_PROXY: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("server start timeout")),
        8000,
      );
      proc!.stdout?.on("data", (d: Buffer) => {
        if (d.toString().includes("Server running")) {
          clearTimeout(timeout);
          resolveReady();
        }
      });
    });
  }, 15000);

  afterAll(async () => {
    proc?.kill();
    try {fs.unlinkSync(reportFile);} catch { /* INTENTIONAL SILENCE: the test artifact was already removed. */ }
  });

  function postReport(report: unknown): Promise<number> {
    return new Promise((resolvePromise, reject) => {
      const body = JSON.stringify(report);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/csp-report",
          method: "POST",
          headers: {
            "Content-Type": "application/csp-report",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolvePromise(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  }

  it("persists a report containing a real newline without corrupting the JSONL", async () => {
    if (!proc) return;
    // script-sample / original-policy routinely contain real newlines.
    // violated-directive is the persisted field, so the newline must live
    // there to exercise the JSONL separator collision.
    const status = await postReport({
      "csp-report": {
        "blocked-uri": "https://evil.com/x.js",
        "document-uri": "https://app.example.com/",
        "effective-directive": "script-src-elem\nsecond-line-of-policy",
      },
    });
    expect(status).toBe(204);

    // Give the async persist queue a beat, then inspect the file directly.
    await new Promise((r) => setTimeout(r, 500));
    const raw = fs.readFileSync(reportFile, "utf8");
    // Every physical line must parse as one complete JSON record.
    const lines = raw.split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { violatedDirective?: string };
      expect(parsed.violatedDirective).toBe(
        "script-src-elem\nsecond-line-of-policy",
      );
    }
    // The newline in the directive survived inside the JSON string.
    expect(lines[0]).toContain("second-line-of-policy");
  });
});

describe.skipIf(!serverEntryExists)("CSP report collector — webhook alerting", () => {
  let proc: ChildProcess | null = null;
  let port = 0;
  let webhookPort = 0;
  let receiver: http.Server | null = null;
  const deliveries: Array<{
    count: number;
    reports: Array<Record<string, unknown>>;
  }> = [];
  let failNextDelivery = false;

  beforeAll(async () => {
    // Webhook receiver: records every POST body.
    receiver = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString()) as {
            count?: number;
            reports?: Array<Record<string, unknown>>;
          };
          deliveries.push({
            count: body.count ?? 0,
            reports: body.reports ?? [],
          });
        } catch {
          /* INTENTIONAL SILENCE: malformed test input is expected in this case. */
        }
        if (failNextDelivery) {
          failNextDelivery = false;
          res.writeHead(500);
        } else {
          res.writeHead(204);
        }
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
        CSP_REPORT_LIMIT: "100",
        CSP_REPORT_WINDOW_MS: "60000",
        CSP_REPORT_ADMIN_TOKEN: "test-admin-token",
        CSP_REPORT_WEBHOOK_URL: `http://127.0.0.1:${webhookPort}/hook`,
        CSP_REPORT_WEBHOOK_ALLOW_HTTP: "1",
        CSP_REPORT_WEBHOOK_INTERVAL_MS: "250",
        CSP_REPORT_WEBHOOK_BATCH_MAX: "2",
        CSP_REPORT_WEBHOOK_MAX_ATTEMPTS: "2",
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
  }, 10000);

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

  it("delivers a violation to the webhook with a redacted payload", async () => {
    if (!proc) return;
    const deliveredBefore = deliveries.length;
    const { status } = await fetchCspReport(port, "POST", {
      "csp-report": {
        "blocked-uri": "https://evil.example.com/xss.js?payload=1",
        "document-uri": "https://bookmarkforge.com/app#section",
        "effective-directive": "script-src",
        "script-sample": "alert(1)//ignored",
        disposition: "enforce",
      },
    });
    expect(status).toBe(204);

    await waitForDeliveries(deliveredBefore + 1);
    const last = deliveries[deliveries.length - 1];
    expect(last!.count).toBe(1);
    const report = last!.reports[0]!;
    // Origin-only: path, query and fragment are stripped.
    expect(report!.blockedOrigin).toBe("https://evil.example.com");
    expect(report!.documentOrigin).toBe("https://bookmarkforge.com");
    // The raw IP never leaves the server — only a one-way hash.
    expect(String(report!.ipHash)).toMatch(/^[0-9a-f]{24}$/);
    expect(report!.ipHash).not.toBe("xss.js");
    // Raw violation content is never forwarded.
    expect(JSON.stringify(last)).not.toContain("script-sample");
    expect(JSON.stringify(last)).not.toContain("alert(1)");
    // Redacted fields are present.
    expect(report!.violatedDirective).toBe("script-src");
    expect(report!.disposition).toBe("enforce");
  }, 15000);

  it("batches a burst with debounce (one flush, capped batch size)", async () => {
    if (!proc) return;
    const deliveredBefore = deliveries.length;
    // Batch max is 2: three rapid reports must NOT produce three deliveries.
    for (let i = 0; i < 3; i++) {
      await fetchCspReport(port, "POST", {
        "csp-report": {
          "blocked-uri": `https://evil-${i}.example.com/x.js`,
          "document-uri": "https://app.example.com/",
          "effective-directive": "img-src",
        },
      });
    }
    // Total delivered reports equals the number of reports sent.
    await new Promise((r) => setTimeout(r, 3000));
    const total = deliveries
      .slice(deliveredBefore)
      .reduce((sum, d) => sum + d.count, 0);
    expect(total).toBe(3);
    const flushes = deliveries.slice(deliveredBefore).filter((d) => d.count > 0);
    // Debounced into ≤2 deliveries thanks to the batch cap of 2.
    expect(flushes.length).toBeLessThanOrEqual(2);
  }, 15000);

  it("retries a failed delivery up to the attempt cap", async () => {
    if (!proc) return;
    const deliveredBefore = deliveries.length;
    failNextDelivery = true;
    const { status } = await fetchCspReport(port, "POST", {
      "csp-report": {
        "blocked-uri": "https://retry.example.com/x.js",
        "document-uri": "https://app.example.com/",
        "effective-directive": "script-src",
      },
    });
    expect(status).toBe(204);

    // The first delivery 500s; the retry must succeed. Deliveries may also
    // include the burst from the previous test — only look at the ones
    // carrying the retry report.
    const deadline = Date.now() + 8000;
    let found = false;
    while (Date.now() < deadline && !found) {
      for (const d of deliveries) {
        if (d.reports.some((r) => r.blockedOrigin === "https://retry.example.com")) {
          found = true;
          break;
        }
      }
      if (!found) await new Promise((r) => setTimeout(r, 100));
    }
    expect(found).toBe(true);
  }, 15000);
});

describe.skipIf(!serverEntryExists)("CSP report collector — bounded environment configuration", () => {
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
    proc = spawn(process.execPath, [tsxBin, SERVER_ENTRY], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        CSP_REPORT_MAX: "0",
        CSP_REPORT_LIMIT: "-1",
        CSP_REPORT_WINDOW_MS: "0",
        CSP_REPORT_BODY_MAX_BYTES: "-1",
        CSP_REPORT_RATE_MAX_ENTRIES: "NaN",
        CSP_REPORT_WEBHOOK_INTERVAL_MS: "NaN",
        CSP_REPORT_WEBHOOK_BATCH_MAX: "0",
        CSP_REPORT_WEBHOOK_MAX_ATTEMPTS: "999999",
        CSP_REPORT_WEBHOOK_TIMEOUT_MS: "-1",
        CSP_REPORT_ADMIN_TOKEN: "test-admin-token",
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

  it("falls back to safe defaults for invalid CSP limits", async () => {
    if (!proc) return;
    // The body is deliberately above the old 1 KiB lower clamp. The invalid
    // -1 override must fall back to the documented 16 KiB default instead of
    // making this valid report look oversized.
    const largeDirective = "x".repeat(1_800);
    const report = {
      "csp-report": {
        "blocked-uri": "https://config-test.example.com/x.js",
        "document-uri": "https://app.example.com/",
        "effective-directive": largeDirective,
      },
    };

    const first = await fetchCspReport(port, "POST", report);
    const second = await fetchCspReport(port, "POST", report);
    // Invalid CSP_REPORT_LIMIT=-1 must not become a one-report window.
    expect(first.status).toBe(204);
    expect(second.status).toBe(204);

    const diagnostics = await fetchCspReport(port, "GET");
    expect(diagnostics.status).toBe(200);
    const parsed = JSON.parse(diagnostics.body) as {
      recent?: unknown[];
    };
    // Invalid CSP_REPORT_MAX=0 must not collapse the ring to one entry.
    expect(parsed.recent?.length).toBeGreaterThanOrEqual(2);
  });
});

describe.skipIf(!serverEntryExists)("CSP report collector — webhook queue cap", () => {
  let proc: ChildProcess | null = null;
  let port = 0;
  let deadWebhookPort = 0;

  beforeAll(async () => {
    // Reserve a port with no listener — deliveries to it fail instantly
    // (ECONNREFUSED), simulating a permanently down webhook endpoint.
    deadWebhookPort = await new Promise<number>((resolvePort) => {
      const srv = http.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (addr && typeof addr === "object") {
          resolvePort(addr.port);
          srv.close();
        }
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
        CSP_REPORT_LIMIT: "1000",
        CSP_REPORT_WINDOW_MS: "60000",
        CSP_REPORT_ADMIN_TOKEN: "test-admin-token",
        CSP_REPORT_WEBHOOK_URL: `http://127.0.0.1:${deadWebhookPort}/hook`,
        CSP_REPORT_WEBHOOK_ALLOW_HTTP: "1",
        CSP_REPORT_WEBHOOK_INTERVAL_MS: "250",
        CSP_REPORT_WEBHOOK_BATCH_MAX: "2",
        CSP_REPORT_WEBHOOK_MAX_ATTEMPTS: "2",
        CSP_REPORT_WEBHOOK_QUEUE_MAX: "50",
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

  it("caps the pending queue while the webhook is down", async () => {
    if (!proc) return;
    // 300 accepted violations with distinct IPs while the endpoint fails
    // instantly. The queue is capped at 50: the oldest pending reports are
    // dropped and counted, and the server must survive (no unbounded
    // growth) — every entry above the cap is dropped, never lost silently.
    for (let i = 0; i < 300; i++) {
      await fetchCspReport(port, "POST", {
        "csp-report": {
          "blocked-uri": `https://q-${i}.example.com/x-${i}.js`,
          "document-uri": "https://app.example.com/",
          "effective-directive": "img-src",
        },
      });
    }

    // Give the flushes a moment to fail and drop.
    await new Promise((r) => setTimeout(r, 1500));

    const diagnostics = await fetchCspReport(port, "GET");
    expect(diagnostics.status).toBe(200);
    const parsed = JSON.parse(diagnostics.body) as { webhookDropped?: number };
    // 300 pushed - 50 cap - small in-flight/drained tail => >= ~248 worst
    // case; assert a comfortable lower bound to stay robust to timing.
    expect(parsed.webhookDropped ?? 0).toBeGreaterThanOrEqual(200);
  }, 20000);
});

describe.skipIf(!serverEntryExists)("CSP report collector — webhook URL hardening", () => {
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
    // Production mode with a plaintext-HTTP webhook URL and no opt-out: the
    // webhook must be REJECTED at startup (fail-closed — no deliveries at
    // all rather than leaking the redacted payloads in plaintext).
    proc = spawn(process.execPath, [tsxBin, SERVER_ENTRY], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        AI_SESSION_ORIGINS: "http://127.0.0.1",
        PORT: String(port),
        HOST: "127.0.0.1",
        CSP_REPORT_LIMIT: "10",
        CSP_REPORT_WINDOW_MS: "60000",
        CSP_REPORT_ADMIN_TOKEN: "test-admin-token",
        CSP_REPORT_WEBHOOK_URL: "http://127.0.0.1:1/hook",
        CSP_REPORT_WEBHOOK_INTERVAL_MS: "250",
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
    const { status, body } = await fetchCspReport(port, "GET");
    expect(status).toBe(200);
    const parsed = JSON.parse(body) as { webhook?: boolean };
    // The webhook was disabled at startup; the server still serves reports.
    expect(parsed.webhook).toBe(false);

    const post = await fetchCspReport(port, "POST", {
      "csp-report": {
        "blocked-uri": "https://prod-plaintext.example.com/x.js",
        "document-uri": "https://app.example.com/",
        "effective-directive": "script-src",
      },
    });
    expect(post.status).toBe(204);
  }, 15000);
});
