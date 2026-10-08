#!/usr/bin/env node
/**
 * scripts/load-test-server.mjs — companion-server load test.
 *
 * Boots an isolated server (companion server only, no mocks) and validates
 * the signaling budgets aligned with the SLOs in docs/operations.md:
 *
 *   Signaling (the surface that scales with users):
 *     - p95 join (connect → joined)         < 500 ms   (p95 signaling SLO)
 *     - p95 in-room signal relay            < 500 ms
 *     - Saturation: the server rejects with 1013 above MAX_CONNECTIONS
 *       and stays alive (/health 200 after the burst).
 *
 * The anti-abuse rate limiting (join per IP) is deliberately raised to
 * measure capacity/latency, not throttling — server unit tests cover that
 * part. Signaling HMAC is disabled (NODE_ENV=test) because the target is the
 * relay path.
 *
 * There is no AI-proxy phase: the server does not proxy AI providers (the
 * browser talks to the user's provider directly), so there is no generation
 * endpoint to measure here.
 *
 * Uso:
 *   npm run test:load                        # informe (exit 0/1)
 *   node scripts/load-test-server.mjs --json
 *   node scripts/load-test-server.mjs --connections 256
 *
 * Flags:
 *   --connections <n>   MAX_CONNECTIONS of the test server (default 128)
 *   --concurrency <n>   simultaneous WS client bursts (default 32)
 *   --timeout-ms        global run cap (default 90 000)
 *   --json              print a JSON summary at the end
 *
 * Exit: 0 = PASS, 1 = FAIL (fail-closed: any broken budget fails).
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";

const ROOT = process.cwd();
const TSX_CLI = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SERVER_ENTRY = join(ROOT, "server", "src", "index.ts");

// ── Args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const getArg = (name, fallback) => {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? Number(args[idx + 1]) : fallback;
};
const MAX_CONNECTIONS = Math.max(16, Math.min(getArg("--connections", 128), 1024));
const CONCURRENCY = Math.max(4, Math.min(getArg("--concurrency", 32), 128));
const TIMEOUT_MS = Math.max(10_000, getArg("--timeout-ms", 90_000));

// ── Presupuestos (SLO docs/operations.md) ───────────────────────────
const BUDGETS = {
  joinP95Ms: 500,          // p95 signaling (join) < 500 ms
  relayP95Ms: 500,         // in-room signal relay
  healthOk: true,          // /health answers 200 under load
  saturationRejected: 1,   // ≥ 1 connection rejected with 1013 above the limit
};

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function percentiles(sorted, ps) {
  if (sorted.length === 0) return ps.map(() => 0);
  return ps.map((p) => {
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return Math.round(sorted[Math.max(0, idx)]);
  });
}
function p95Of(sorted) {
  return percentiles(sorted, [95])[0];
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Companion server (proceso aislado) ──────────────────────────────
function startCompanionServer(port) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      // Limits of the server under test (the test validates against these).
      MAX_CONNECTIONS: String(MAX_CONNECTIONS),
      MAX_ROOMS: "512",
      MAX_PEERS_PER_ROOM: "64",
      // Anti-abuse deliberately raised: this measures capacity, not throttling.
      JOIN_LIMIT: "100000",
      HEARTBEAT_INTERVAL_MS: "2000",
      // Signaling HMAC off (covered by unit tests).
      ENFORCE_SIGNAL_HMAC: "0",
    };
    const child = spawn(process.execPath, [TSX_CLI, SERVER_ENTRY], {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("companion server did not boot (timeout 15s)"));
    }, 15_000);
    timer.unref();
    child.stdout.on("data", (d) => {
      out += String(d);
      if (out.includes("Server running")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`companion server exited with code ${code}: ${err.slice(-800)}`));
    });
  });
}

async function waitForHealth(base, timeoutMs = 5_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.status === 200) return true;
    } catch {
      /* reintentar */
    }
    await sleep(100);
  }
  return false;
}

// ── Signaling phase ───────────────────────────────────────────────
function wsJoinOnce(wsUrl, room, secret) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const ws = new WebSocket(wsUrl);
    let settled = false;
    let yourPeerId = null;
    const timer = setTimeout(() => {
      settled = true;
      ws.terminate();
      reject(new Error(`join timeout (${room})`));
    }, 10_000);
    ws.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    ws.on("message", (raw) => {
      if (settled) return;
      const msg = JSON.parse(raw.toString());
      // The server assigns the peerId and announces it in `init`; sending a
      // foreign senderPeerId is treated as impersonation (close 1008).
      if (msg.type === "init" && typeof msg.yourPeerId === "string") {
        yourPeerId = msg.yourPeerId;
        ws.send(JSON.stringify({ type: "join", room, roomSecret: secret }));
        return;
      }
      if (msg.type === "joined") {
        settled = true;
        clearTimeout(timer);
        resolve({ ws, yourPeerId, latency: performance.now() - started });
      }
    });
  });
}

/** Burst of N operations with a concurrency cap; returns results in order. */
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = idx;
      idx += 1;
      if (i >= items.length) return;
      results[i] = await fn(i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runSignalingPhase(wsUrl) {
  const target = Math.floor(MAX_CONNECTIONS * 0.7);
  console.log(
    `\n[signaling] ${target} concurrent clients (70% of MAX_CONNECTIONS=${MAX_CONNECTIONS})`,
  );

  const rooms = 8;
  const joined = await mapConcurrent(
    Array.from({ length: target }, (_, i) => i),
    CONCURRENCY,
    (i) =>
      wsJoinOnce(wsUrl, `load-room-${i % rooms}`, "load-secret").then((r) => ({
        ...r,
        i,
      })),
  );
  const latencies = joined.map((r) => r.latency).sort((a, b) => a - b);
  const joinP95 = p95Of(latencies);
  check(
    `join p95 ${joinP95} ms < ${BUDGETS.joinP95Ms} ms (${joined.length} clients)`,
    joinP95 < BUDGETS.joinP95Ms,
  );

  // Relay: a room with 8 peers, 7 send a timestamped signal to peer 0.
  // The `receiverPeerId` must be the real peerId assigned by the server
  // (yourPeerId from init); `senderPeerId` is omitted (the server fills it
  // with the socket's authenticated peerId).
  const relayRoom = "load-relay-room";
  const relayPeers = await mapConcurrent(
    Array.from({ length: 8 }, (_, i) => i),
    8,
    () => wsJoinOnce(wsUrl, relayRoom, "relay-secret"),
  );
  const receiver = relayPeers[0].ws;
  const receiverPeerId = relayPeers[0].yourPeerId;
  const relayLatencies = [];
  let delivered = 0;
  let expected = 0;
  receiver.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "signal" && msg.data?.t === "relay-test") {
      delivered += 1;
      relayLatencies.push(performance.now() - msg.data.t0);
    }
  });
  await sleep(100);
  for (let i = 1; i < relayPeers.length; i += 1) {
    const sender = relayPeers[i].ws;
    sender.send(
      JSON.stringify({
        type: "signal",
        room: relayRoom,
        receiverPeerId,
        data: { t: "relay-test", t0: performance.now(), n: i },
      }),
    );
    expected += 1;
  }
  const relayDeadline = performance.now() + 5_000;
  while (delivered < expected && performance.now() < relayDeadline) {
    await sleep(20);
  }
  const relayP95 = p95Of(relayLatencies.sort((a, b) => a - b));
  check(
    `relay p95 ${relayP95} ms < ${BUDGETS.relayP95Ms} ms (${delivered}/${expected} entregadas)`,
    relayP95 < BUDGETS.relayP95Ms && delivered === expected,
  );
  relayPeers.forEach((p) => p.ws.close());

  // Saturation: above MAX_CONNECTIONS → 1013 rejection, server alive.
  // The client's `open` fires before the server's 1013 close, so a connection
  // only counts as accepted when it is still alive when the window closes;
  // a 1013 close within the window = rejected.
  const SAT_WINDOW_MS = 3_000;
  const extra = MAX_CONNECTIONS - joined.length + 3;
  const satResults = await mapConcurrent(
    Array.from({ length: extra }, (_, i) => i),
    CONCURRENCY,
    () =>
      new Promise((resolve) => {
        const ws = new WebSocket(wsUrl);
        let resolved = false;
        let opened = false;
        const done = (r) => {
          if (resolved) return;
          resolved = true;
          resolve(r);
        };
        ws.on("open", () => {
          opened = true;
        });
        ws.on("close", (code) =>
          done({ rejected: code === 1013, code, opened }),
        );
        ws.on("error", () => done({ rejected: true, code: -1, opened }));
        setTimeout(() => {
          ws.terminate();
          // Still alive after the window → accepted (not rejected).
          done({ rejected: false, code: 0, opened });
        }, SAT_WINDOW_MS).unref();
      }),
  );
  const rejected = satResults.filter((r) => r.rejected && r.code === 1013).length;
  check(
    `saturation: ${rejected} connection(s) rejected with 1013 above ${MAX_CONNECTIONS}`,
    rejected >= BUDGETS.saturationRejected,
  );

  // The server stays alive after the burst.
  const healthAfter = await waitForHealth(wsUrl.replace("ws://", "http://"), 5_000);
  check(`/health responds 200 after the burst`, healthAfter === BUDGETS.healthOk);

  // Release the connections from the main wave.
  joined.forEach((r) => r.ws.close());
  return { joinP95, relayP95, rejected };
}

// ── Run principal ───────────────────────────────────────────────────
const startedAt = performance.now();
let companion = null;
let globalTimer = null;
let failure = null;

try {
  const companionPort = await getFreePort();
  globalTimer = setTimeout(() => {
    companion?.kill("SIGKILL");
    console.error("\n✗ GLOBAL TIMEOUT — the run exceeded " + TIMEOUT_MS + " ms");
    process.exit(1);
  }, TIMEOUT_MS);
  globalTimer.unref();

  console.log("🔬 Prueba de carga — companion server");
  console.log("=".repeat(56));

  companion = await startCompanionServer(companionPort);
  const wsUrl = `ws://127.0.0.1:${companionPort}`;
  const httpBase = `http://127.0.0.1:${companionPort}`;
  console.log(`companion server en ${wsUrl} (MAX_CONNECTIONS=${MAX_CONNECTIONS})`);

  if (!(await waitForHealth(httpBase))) {
    check("/health responds 200 at boot", false);
  } else {
    check("/health responds 200 at boot", true);
  }

  const sig = await runSignalingPhase(wsUrl);

  console.log("\n" + "=".repeat(56));
  console.log(
    `p95 join=${sig.joinP95} ms · p95 relay=${sig.relayP95} ms · ` +
      `rechazos 1013=${sig.rejected}`,
  );
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  check("run without infrastructure errors", false, failure);
} finally {
  if (globalTimer) clearTimeout(globalTimer);
  if (companion) {
    try {
      companion.kill("SIGKILL");
    } catch {
      /* ya terminado */
    }
  }
}

const failed = checks.some((c) => !c.ok);
const elapsed = Math.round(performance.now() - startedAt);
console.log(
  `\nResultado: ${checks.filter((c) => c.ok).length}/${checks.length} presupuestos OK (${elapsed} ms)`,
);
if (JSON_OUT) {
  console.log(
    JSON.stringify(
      { ok: !failed, elapsedMs: elapsed, checks, budgets: BUDGETS },
      null,
      2,
    ),
  );
}
if (failure) {
  console.error(`\n✗ FAIL: ${failure}`);
}
process.exit(failed ? 1 : 0);
