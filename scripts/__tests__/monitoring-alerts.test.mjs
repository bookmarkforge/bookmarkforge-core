import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseClientCriticalLog,
  checkClientCritical,
  parseRetryDegradedLog,
  checkRetryDegraded,
  checkApiDegradado,
  shouldRunClientCriticalAction,
  integrityMatches,
  verifyBundleSri,
  checkMonitoringActivo,
  readApiHistory,
  writeApiHistory,
  summarizeApiHistory,
} from "../monitoring-alerts.mjs";

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const line = (timestamp, criticalClients = 3) => JSON.stringify({
  event: "client_events_critical_threshold",
  timestamp,
  criticalClients,
  threshold: 3,
  windowMs: 600000,
});
const retryLine = (timestamp, newDropped = 2) => JSON.stringify({
  event: "client_events_retry_degraded",
  timestamp,
  newDropped,
  attempts: 3,
  coalesced: 1,
  dropped: 5,
});

describe("SRI verification", () => {
  it("accepts an intact resource", () => {
    const body = Buffer.from("const healthy = true;");
    const integrity = `sha256-${digestBase64("sha256", body)}`;
    expect(integrityMatches(integrity, body)).toBe(true);
  });

  it("rejects a corrupted resource", () => {
    const expected = Buffer.from("const healthy = true;");
    const corrupted = Buffer.from("const healthy = false;");
    const integrity = `sha256-${digestBase64("sha256", expected)}`;
    expect(integrityMatches(integrity, corrupted)).toBe(false);
  });

  it("accepts a matching hash from a multi-hash integrity attribute", () => {
    const body = Buffer.from("bundle");
    const wrong = Buffer.from("other");
    const integrity = [
      `sha256-${digestBase64("sha256", wrong)}`,
      `sha384-${digestBase64("sha384", body)}`,
    ].join(" ");
    expect(integrityMatches(integrity, body)).toBe(true);
  });

  it("reports missing integrity on a served script", async () => {
    const server = await startSriServer({ html: '<!doctype html><script src="/app.js"></script>' });
    try {
      await expect(verifyBundleSri(server.url)).resolves.toMatchObject({
        mode: "served",
        ok: false,
      });
    } finally {
      await server.close();
    }
  });

  it("verifies an intact served bundle end-to-end", async () => {
    const body = Buffer.from("console.log('ok');");
    const integrity = `sha256-${digestBase64("sha256", body)}`;
    const server = await startSriServer({
      html: `<!doctype html><script src="/app.js" integrity="${integrity}"></script>`,
      body,
    });
    try {
      await expect(verifyBundleSri(server.url)).resolves.toMatchObject({ mode: "served", ok: true });
    } finally {
      await server.close();
    }
  });

  // ADR-028: gate drift — since the marketing/SPA split the SRI bundle is
  // served at /app.html; /index.html is the marketing page with no SRI
  // scripts. The probe must verify the page that actually ships the bundle.
  it("verifies the SPA bundle at /app.html when /index.html is marketing-only", async () => {
    const body = Buffer.from("console.log('spa');");
    const integrity = `sha256-${digestBase64("sha256", body)}`;
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      if (req.url === "/app.js") {
        res.setHeader("content-type", "text/javascript");
        res.end(body);
        return;
      }
      res.setHeader("content-type", "text/html");
      res.end(
        req.url === "/app.html"
          ? `<!doctype html><script src="/app.js" integrity="${integrity}"></script>`
          : "<!doctype html><script src=\"/landing.js\" defer></script>",
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
      await expect(verifyBundleSri(`http://127.0.0.1:${port}`)).resolves.toMatchObject({
        mode: "served",
        ok: true,
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

function digestBase64(algorithm, body) {
  return createHash(algorithm).update(body).digest("base64");
}

async function startSriServer({ html, body = Buffer.from("corrupt") }) {
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html");
    res.end(req.url === "/app.js" ? body : html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe("MONITORING_ACTIVO", () => {
  it("verifies the CSP listener and nginx client-events proxy", async () => {
    const result = await checkMonitoringActivo({ root: process.cwd() });
    expect(result).toMatchObject({
      name: "MONITORING_ACTIVO",
      ok: true,
    });
    expect(result.detail).toContain("csp-violation-spike");
    expect(result.detail).toContain("nginx proxy");
  });

  it("fails when the CSP listener is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bmf-monitor-active-"));
    try {
      const files = [
        ["src/utils/storageMonitor.ts", "startStorageMonitor"],
        ["src/telemetry/productionMonitor.ts", "initProductionMonitor"],
        ["src/utils/bundleIntegrity.ts", "bundle-integrity-failed"],
        ["src/services/clientEventReporter.ts", "csp-violation-spike"],
      ];
      for (const [file, token] of files) {
        const target = join(dir, file);
        mkdirSync(join(target, ".."), { recursive: true });
        writeFileSync(target, token);
      }
      mkdirSync(join(dir, "public"), { recursive: true });
      writeFileSync(join(dir, "public/nginx.conf"), "location = /api/client-events {\n  proxy_pass http://bookmarkforge_api:8787/api/client-events;\n}\n");
      const result = await checkMonitoringActivo({ root: dir });
      expect(result.ok).toBe(true);

      writeFileSync(join(dir, "src/services/clientEventReporter.ts"), "");
      const broken = await checkMonitoringActivo({ root: dir });
      expect(broken.ok).toBe(false);
      expect(broken.detail).toContain("clientEventReporter.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when the nginx client-events proxy is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bmf-monitor-active-"));
    try {
      for (const [file, token] of [
        ["src/utils/storageMonitor.ts", "startStorageMonitor"],
        ["src/telemetry/productionMonitor.ts", "initProductionMonitor"],
        ["src/utils/bundleIntegrity.ts", "bundle-integrity-failed"],
        ["src/services/clientEventReporter.ts", "csp-violation-spike"],
      ]) {
        const target = join(dir, file);
        mkdirSync(join(target, ".."), { recursive: true });
        writeFileSync(target, token);
      }
      mkdirSync(join(dir, "public"), { recursive: true });
      writeFileSync(join(dir, "public/nginx.conf"), "server {}\n");
      const result = await checkMonitoringActivo({ root: dir });
      expect(result.ok).toBe(false);
      expect(result.detail).toContain("proxy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseClientCriticalLog", () => {
  it("surfaces a fresh threshold line as an explicit alert", () => {
    const result = parseClientCriticalLog(
      line("2026-08-27T11:59:30.000Z", 3),
      NOW,
      600_000,
    );

    expect(result).toEqual({
      ok: false,
      clusterEvents: 1,
      maxCriticalClients: 3,
    });
  });

  it("keeps only the newest fresh threshold window to avoid double paging", () => {
    const logs = [
      line("2026-08-27T11:59:00.000Z", 3),
      line("2026-08-27T11:59:30.000Z", 4),
    ].join("\n");

    expect(parseClientCriticalLog(logs, NOW, 600_000)).toEqual({
      ok: false,
      clusterEvents: 1,
      maxCriticalClients: 4,
    });
  });

  it("extracts the highest critical-client count across fresh threshold lines", () => {
    const logs = [
      line("2026-08-27T11:59:00.000Z", 3),
      line("2026-08-27T11:58:00.000Z", 5),
    ].join("\n");

    expect(parseClientCriticalLog(logs, NOW, 600_000)).toEqual({
      ok: false,
      clusterEvents: 1,
      maxCriticalClients: 5,
    });
  });

  it("ignores threshold lines older than the configured monitoring window", () => {
    const stale = line("2026-08-27T11:49:59.999Z", 3); // 10m + 1ms old
    expect(parseClientCriticalLog(stale, NOW, 600_000)).toEqual({
      ok: true,
      clusterEvents: 0,
      maxCriticalClients: 0,
    });
  });

  it("counts a timestamp-less threshold line because LOG_CMD already bounds recency", () => {
    const result = parseClientCriticalLog(
      JSON.stringify({ event: "client_events_critical_threshold", criticalClients: 4 }),
      NOW,
      600_000,
    );

    expect(result).toEqual({
      ok: false,
      clusterEvents: 1,
      maxCriticalClients: 4,
    });
  });

  it("ignores unrelated server log lines", () => {
    const logs = [
      JSON.stringify({ event: "client_event_critical", criticalClients: 3 }),
      JSON.stringify({ event: "health", status: "ok" }),
      "client_event_critical_threshold=false",
    ].join("\n");

    expect(parseClientCriticalLog(logs, NOW, 600_000)).toEqual({
      ok: true,
      clusterEvents: 0,
      maxCriticalClients: 0,
    });
  });
});

describe("parseRetryDegradedLog", () => {
  it("surfaces a fresh degraded-delivery line as an alert with the events lost", () => {
    expect(parseRetryDegradedLog(retryLine("2026-08-27T11:59:30.000Z", 3), NOW, 600_000)).toEqual({
      ok: false,
      degradedEvents: 1,
      maxNewDropped: 3,
    });
  });

  it("takes the max events lost across fresh lines (single alert per tick)", () => {
    const logs = [
      retryLine("2026-08-27T11:59:00.000Z", 2),
      retryLine("2026-08-27T11:59:30.000Z", 5),
    ].join("\n");
    expect(parseRetryDegradedLog(logs, NOW, 600_000)).toEqual({
      ok: false,
      degradedEvents: 1,
      maxNewDropped: 5,
    });
  });

  it("ignores degraded lines older than the monitoring window", () => {
    expect(parseRetryDegradedLog(retryLine("2026-08-27T11:49:59.999Z", 4), NOW, 600_000)).toEqual({
      ok: true,
      degradedEvents: 0,
      maxNewDropped: 0,
    });
  });

  it("counts a timestamp-less degraded line because LOG_CMD bounds recency", () => {
    const result = parseRetryDegradedLog(
      JSON.stringify({ event: "client_events_retry_degraded", newDropped: 1 }),
      NOW,
      600_000,
    );
    expect(result).toEqual({ ok: false, degradedEvents: 1, maxNewDropped: 1 });
  });

  it("ignores unrelated server log lines", () => {
    const logs = [
      JSON.stringify({ event: "client_events_critical_threshold", criticalClients: 3 }),
      // Singular "event" and bare words must NOT match the exact marker.
      JSON.stringify({ event: "client_event_retry_degraded", newDropped: 1 }),
      "retry_degraded=false",
    ].join("\n");
    expect(parseRetryDegradedLog(logs, NOW, 600_000)).toEqual({
      ok: true,
      degradedEvents: 0,
      maxNewDropped: 0,
    });
  });
});

describe("checkRetryDegraded", () => {
  it("surfaces a fresh degraded line from the configured log file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bmf-monitor-retry-"));
    const logFile = join(dir, "server.log");
    try {
      writeFileSync(logFile, retryLine("2026-08-27T11:59:30.000Z", 3));
      await expect(checkRetryDegraded({ logFile, now: NOW, windowMs: 600_000 })).resolves.toEqual({
        name: "RETRY_DEGRADED",
        ok: false,
        detail: "1 degraded delivery signal(s) in 10min — +3 events lost",
        degradedEvents: 1,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes when the log has no degraded lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bmf-monitor-retry-"));
    const logFile = join(dir, "server.log");
    try {
      writeFileSync(logFile, JSON.stringify({ event: "client_event_critical", criticalClients: 3 }));
      await expect(checkRetryDegraded({ logFile, now: NOW, windowMs: 600_000 })).resolves.toMatchObject({
        name: "RETRY_DEGRADED",
        ok: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed when the configured log is unreadable/missing", async () => {
    const result = await checkRetryDegraded({
      logFile: "scripts/__tests__/does-not-exist-retry.log",
      now: NOW,
      windowMs: 600_000,
    });
    expect(result.name).toBe("RETRY_DEGRADED");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("fail-closed");
  });
});

describe("API degradation history", () => {
  it("persists bounded 24h history and summarizes the trend", () => {
    const dir = mkdtempSync(join(tmpdir(), "bmf-api-history-"));
    const file = join(dir, "history.json");
    const now = Date.now();
    try {
      writeApiHistory({ timestamp: now - 1000, ok: true, p95Ms: 100, errorRate: 0, businessErrors: 0, samples: 10, totalProbes: 20 }, file, now);
      writeApiHistory({ timestamp: now, ok: false, p95Ms: 900, errorRate: 0.5, businessErrors: 5, samples: 10, totalProbes: 20 }, file, now);
      const history = readApiHistory(file, now);
      expect(history).toHaveLength(2);
      expect(summarizeApiHistory(history, now)).toMatchObject({ samples: 2, averageP95Ms: 500, maxP95Ms: 900, degradedTicks: 1 });
      expect(summarizeApiHistory(history, now).averageErrorRate).toBe(0.25);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("discards entries older than 24 hours", () => {
    const dir = mkdtempSync(join(tmpdir(), "bmf-api-history-"));
    const file = join(dir, "history.json");
    const now = Date.now();
    try {
      writeFileSync(file, JSON.stringify([{ timestamp: now - 24 * 60 * 60 * 1000 - 1, p95Ms: 1, errorRate: 0, ok: true }]));
      expect(readApiHistory(file, now)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("checkApiDegradado", () => {
  async function startDegradableServer({ latencyMs = 0, status = 200 } = {}) {
    const { createServer } = await import("node:http");
    const server = createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", csrfToken: "test-token" }));
      }, latencyMs);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    return {
      url: `http://127.0.0.1:${address.port}`,
      close: () => new Promise((resolve) => server.close(resolve)),
    };
  }

  it("passes on a fast healthy api", async () => {
    const server = await startDegradableServer();
    try {
      const result = await checkApiDegradado({
        baseUrl: server.url,
        samples: 5,
        timeoutMs: 2000,
        latencyThresholdMs: 500,
        errorRateThreshold: 0.2,
      });
      expect(result.name).toBe("API_DEGRADADO");
      expect(result.ok).toBe(true);
      expect(result.errorRate).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("fails when p95 exceeds the latency threshold", async () => {
    const server = await startDegradableServer({ latencyMs: 300 });
    try {
      const result = await checkApiDegradado({
        baseUrl: server.url,
        samples: 5,
        timeoutMs: 2000,
        latencyThresholdMs: 100,
        errorRateThreshold: 0.2,
      });
      expect(result.ok).toBe(false);
      expect(result.p95Ms).toBeGreaterThanOrEqual(300);
      expect(result.detail).toContain("DEGRADED");
    } finally {
      await server.close();
    }
  });

  it("fails when the error rate exceeds the threshold", async () => {
    const server = await startDegradableServer({ status: 500 });
    try {
      const result = await checkApiDegradado({
        baseUrl: server.url,
        samples: 5,
        timeoutMs: 2000,
        latencyThresholdMs: 1000,
        errorRateThreshold: 0.2,
      });
      expect(result.ok).toBe(false);
      expect(result.errorRate).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("fails when the api is unreachable (100% errors) — no hang", async () => {
    const result = await checkApiDegradado({
      baseUrl: "http://127.0.0.1:9",
      samples: 3,
      timeoutMs: 500,
      latencyThresholdMs: 1000,
      errorRateThreshold: 0.2,
    });
    expect(result.ok).toBe(false);
    expect(result.errorRate).toBe(1);
  });
});

describe("API_DEGRADADO end-to-end", () => {
  it("fails, pages, and recovers as real API latency changes", async () => {
    const { createServer } = await import("node:http");
    const dir = mkdtempSync(join(tmpdir(), "bmf-monitor-api-e2e-"));
    let latencyMs = 250;
    const server = createServer((_req, res) => {
      const respond = () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", csrfToken: "test-token" }));
      };
      // A 0ms latency must answer synchronously: a setTimeout(0) hop adds
      // measurable wall-clock jitter that flakes the recovery assertions
      // under parallel CI load.
      if (latencyMs === 0) respond();
      else setTimeout(respond, latencyMs);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      writeFileSync(join(dir, "events.log"), "");
      const degraded = await checkApiDegradado({ baseUrl, samples: 3, timeoutMs: 1000, latencyThresholdMs: 50, errorRateThreshold: 0.2 });
      expect(degraded.ok).toBe(false);
      expect(degraded.p95Ms).toBeGreaterThanOrEqual(200);
      expect(degraded.detail).toContain("DEGRADED");
      expect(degraded.totalProbes).toBe(6);

      latencyMs = 0;
      // Recovery threshold stays far below the degraded regime (~250ms) but
      // well above realistic load-induced jitter, so a single slow probe
      // cannot flip p95 (the max of the 6 probes) — that was the flaky bit.
      const recovered = await checkApiDegradado({ baseUrl, samples: 3, timeoutMs: 1000, latencyThresholdMs: 150, errorRateThreshold: 0.2 });
      expect(recovered.ok).toBe(true);
      expect(recovered.errorRate).toBe(0);
      expect(recovered.p95Ms).toBeLessThan(degraded.p95Ms);
      expect(recovered.detail).toContain("health+business");
      // The business probe must hit a route the companion server really serves.
      expect(recovered.businessPath).toBe("/api/license/entitlement");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("checkClientCritical", () => {
  it("applies the configured window when reading the server log", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bmf-monitor-alerts-"));
    const logFile = join(dir, "server.log");
    try {
      writeFileSync(logFile, [
        // Stale event: must not surface an alert.
        line("2026-08-27T11:49:59.999Z", 9),
        // Fresh event: must surface one explicit CLIENT_CRITICAL alert.
        line("2026-08-27T11:59:30.000Z", 4),
      ].join("\n"));

      await expect(checkClientCritical({
        logFile,
        now: NOW,
        windowMs: 600_000,
      })).resolves.toEqual({
        name: "CLIENT_CRITICAL",
        ok: false,
        detail: "1 cluster event(s) in 10min — criticalClients>=4",
        clusterEvents: 1,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed when the configured server log is unreadable/missing", async () => {
    const result = await checkClientCritical({
      logFile: "scripts/__tests__/does-not-exist-server.log",
      now: NOW,
      windowMs: 600_000,
    });
    expect(result.name).toBe("CLIENT_CRITICAL");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("fail-closed");
  });
});

describe("CLIENT_CRITICAL cooldown dedup", () => {
  const actionAt = NOW;

  it("suppresses repeated actions within the cooldown, including the boundary", () => {
    expect(shouldRunClientCriticalAction(actionAt, actionAt + 599_999, 600_000)).toBe(false);
    expect(shouldRunClientCriticalAction(actionAt, actionAt + 600_000, 600_000)).toBe(false);
  });

  it("allows a new page/rollback after the cooldown expires", () => {
    expect(shouldRunClientCriticalAction(actionAt, actionAt + 600_001, 600_000)).toBe(true);
  });

  it("treats a missing previous action as immediately eligible", () => {
    expect(shouldRunClientCriticalAction(0, NOW, 600_000)).toBe(true);
  });
});

describe("process exit — Windows libuv crash regression", () => {
  it("shutdownExit sets process.exitCode and drains undici cleanly", async () => {
    const mod = await import("../monitoring-alerts.mjs");
    const prev = process.exitCode;
    try {
      await mod.shutdownExit(7);
      expect(process.exitCode).toBe(7);
    } finally {
      process.exitCode = prev;
      // Cancel the unref'd 5s process.exit failsafe so it cannot fire
      // mid-suite (vitest treats a late process.exit as an unhandled error).
      mod.cancelShutdownFailsafe?.();
      // shutdownExit closes undici's GLOBAL dispatcher — restore a fresh one
      // so later tests in this process can still fetch (the API_DEGRADADO and
      // SRI tests probe ephemeral HTTP servers via fetch).
      try {
        const { Agent, setGlobalDispatcher } = await import("undici");
        setGlobalDispatcher(new Agent());
      } catch { /* undici unavailable — nothing to restore */ }
    }
  });

  it("spawned monitor exits 0/1 with parseable JSON (no native crash)", () => {
    // Regresión del crash de Windows: process.exit() con sockets keep-alive de
    // undici abiertos disparaba un abort nativo de libuv (exit 0xC0000409 /
    // "Assertion failed ... src\\win\\async.c"). El monitor debe salir con
    // 0 o 1 (sano) y emitir JSON parseable aunque APP_CAIDA falle.
    const dir = mkdtempSync(join(tmpdir(), "bmf-monitor-exit-"));
    const logFile = join(dir, "events.log");
    writeFileSync(logFile, "");
    const r = spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts", "monitoring-alerts.mjs"), "--json"],
      {
        encoding: "utf8",
        timeout: 90_000,
        env: {
          ...process.env,
          // Puerto muerto: APP_CAIDA falla rapido; el probe SRI Docker-free
          // ejercita fetch (el vector del crash) contra el server efimero.
          PROD_BASE_URL: "http://127.0.0.1:9",
          CLIENT_EVENTS_LOG_FILE: logFile,
        },
      },
    );
    rmSync(dir, { recursive: true, force: true });
    expect([0, 1]).toContain(r.status);
    const parsed = JSON.parse((r.stdout ?? "").trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.results.some((x) => x.name === "APP_CAIDA" && x.ok === false)).toBe(true);
  });
});

