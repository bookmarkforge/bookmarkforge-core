#!/usr/bin/env node
/**
 * scripts/load-test-server.mjs — Prueba de carga del companion server.
 *
 * Arranca un servidor aislado (companion server + mock upstream de IA) y
 * valida los presupuestos alineados con los SLO de docs/operations.md:
 *
 *   Señalización:
 *     - p95 join (conexión → joined)        < 500 ms   (SLO p95 señalización)
 *     - p95 relay de señales en sala        < 500 ms
 *     - Saturación: el servidor rechaza con 1013 por encima de MAX_CONNECTIONS
 *       y sigue vivo (/health 200 tras la ráfaga).
 *   Proxy IA (contra mock upstream local):
 *     - p95 de /api/services/ai/generate    < 3000 ms  (SLO p95 proxy IA)
 *     - tasa de éxito ≥ 99 % y cero 5xx del propio proxy.
 *
 * El rate limiting anti-abuso (join por IP, rate limits del proxy) se eleva a
 * propósito para medir capacidad/latencia, no el throttling — esa parte la
 * cubren los tests unitarios del servidor. El HMAC de señalización se
 * desactiva (NODE_ENV=test) porque el objetivo es la ruta de reenvío.
 *
 * Uso:
 *   npm run test:load                        # informe (exit 0/1)
 *   node scripts/load-test-server.mjs --json
 *   node scripts/load-test-server.mjs --connections 256 --mock-latency-ms 80
 *
 * Flags:
 *   --connections <n>   MAX_CONNECTIONS del servidor de prueba (default 128)
 *   --concurrency <n>   ráfagas simultáneas de clientes WS (default 32)
 *   --mock-latency-ms   latencia simulada del upstream de IA (default 50)
 *   --timeout-ms        tope global del run (default 90 000)
 *   --json              imprime resumen JSON al final
 *
 * Exit: 0 = PASS, 1 = FAIL (fail-closed: cualquier presupuesto roto falla).
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
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
const MOCK_LATENCY_MS = Math.max(0, getArg("--mock-latency-ms", 50));
const TIMEOUT_MS = Math.max(10_000, getArg("--timeout-ms", 90_000));

// ── Presupuestos (SLO docs/operations.md) ───────────────────────────
const BUDGETS = {
  joinP95Ms: 500,          // p95 señalización (join) < 500 ms
  relayP95Ms: 500,         // reenvío de señales en sala
  generateP95Ms: 3_000,    // p95 proxy IA < 3 s
  generateSuccessPct: 99,  // ≥ 99 % de generaciones OK
  healthOk: true,          // /health responde 200 bajo carga
  saturationRejected: 1,   // ≥ 1 conexión rechazada con 1013 por encima del límite
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

// ── Mock upstream de IA (Gemini generateContent) ────────────────────
function startMockUpstream() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "POST" && (req.url ?? "").includes(":generateContent")) {
        // Drain the body so keep-alive reuse is clean.
        req.resume();
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: "mock" }] } }],
            }),
          );
        }, MOCK_LATENCY_MS);
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

// ── Companion server (proceso aislado) ──────────────────────────────
function startCompanionServer(port, mockPort) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      // Límites del servidor bajo prueba (el test valida contra estos).
      MAX_CONNECTIONS: String(MAX_CONNECTIONS),
      MAX_ROOMS: "512",
      MAX_PEERS_PER_ROOM: "64",
      // Anti-abuso elevado a propósito: aquí se mide capacidad, no throttling.
      JOIN_LIMIT: "100000",
      HEARTBEAT_INTERVAL_MS: "2000",
      // HMAC de señalización fuera (cubierto por tests unitarios).
      ENFORCE_SIGNAL_HMAC: "0",
      // Proxy IA contra el mock local (http permitido en NODE_ENV=test).
      // La API key es ficticia: el proxy la exige (503 si falta) pero el mock
      // upstream no la valida — aquí se mide la ruta, no la autenticación.
      GEMINI_API_BASE: `http://127.0.0.1:${mockPort}/v1beta/models`,
      GEMINI_API_KEY: "load-test-fake-key",
      AI_PROXY_IP_RATE_LIMIT: "100000",
      AI_PROXY_IDENTITY_RATE_LIMIT: "100000",
      AI_SESSION_ORIGINS: "",
      AI_SESSION_REQUIRE_LICENSE: "0",
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
      reject(new Error("companion server no arrancó (timeout 15s)"));
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
      reject(new Error(`companion server salió con código ${code}: ${err.slice(-800)}`));
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

// ── Fase señalización ───────────────────────────────────────────────
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
      // El servidor asigna el peerId y lo comunica en `init`; enviar un
      // senderPeerId ajeno se trata como suplantación (close 1008).
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

/** Ráfaga de N operaciones con límite de concurrencia; devuelve resultados en orden. */
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
    `\n[señalización] ${target} clientes concurrentes (70% de MAX_CONNECTIONS=${MAX_CONNECTIONS})`,
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
    `join p95 ${joinP95} ms < ${BUDGETS.joinP95Ms} ms (${joined.length} clientes)`,
    joinP95 < BUDGETS.joinP95Ms,
  );

  // Relay: sala con 8 peers, 7 envían una señal a peer 0 con timestamp.
  // El `receiverPeerId` debe ser el peerId real asignado por el servidor
  // (yourPeerId del init); `senderPeerId` se omite (el servidor lo rellena
  // con el peerId autenticado del socket).
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

  // Saturación: por encima de MAX_CONNECTIONS → rechazo 1013, servidor vivo.
  // El `open` del cliente dispara antes del close 1013 del servidor, así que
  // una conexión solo cuenta como aceptada si sigue viva al cerrarse la
  // ventana; el close con 1013 dentro de la ventana = rechazada.
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
          // Sigue viva tras la ventana → aceptada (no rechazada).
          done({ rejected: false, code: 0, opened });
        }, SAT_WINDOW_MS).unref();
      }),
  );
  const rejected = satResults.filter((r) => r.rejected && r.code === 1013).length;
  check(
    `saturación: ${rejected} conexión(es) rechazada(s) con 1013 sobre ${MAX_CONNECTIONS}`,
    rejected >= BUDGETS.saturationRejected,
  );

  // El servidor sigue vivo tras la ráfaga.
  const healthAfter = await waitForHealth(wsUrl.replace("ws://", "http://"), 5_000);
  check(`/health responde 200 tras la ráfaga`, healthAfter === true);

  // Liberar las conexiones de la onda principal.
  joined.forEach((r) => r.ws.close());
  return { joinP95, relayP95, rejected };
}

// ── Fase proxy IA ───────────────────────────────────────────────────
async function createAiSession(base) {
  const res = await fetch(`${base}/api/services/ai/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (res.status !== 200) {
    throw new Error(`session create → ${res.status}`);
  }
  const cookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
      : (res.headers.get("set-cookie") ?? "").split(",").map((c) => c.trim().split(";")[0]).join("; ");
  const body = await res.json();
  return { cookies, csrf: body.csrfToken };
}

async function runAiPhase(base, sessionCount, requestsPerSession) {
  console.log(
    `\n[proxy IA] ${sessionCount} sesiones × ${requestsPerSession} generaciones contra mock (latencia simulada ${MOCK_LATENCY_MS} ms)`,
  );

  const sessions = [];
  const sessionLatencies = [];
  for (let i = 0; i < sessionCount; i += 1) {
    const t0 = performance.now();
    sessions.push(await createAiSession(base));
    sessionLatencies.push(performance.now() - t0);
  }
  const sessionP95 = p95Of(sessionLatencies.sort((a, b) => a - b));
  check(`sesión p95 ${sessionP95} ms (${sessions.length} sesiones creadas)`, sessionP95 < 1_000);

  const requests = [];
  for (const s of sessions) {
    for (let n = 0; n < requestsPerSession; n += 1) {
      requests.push(s);
    }
  }
  // mapConcurrent pasa el índice (no el ítem) al callback.
  const results = await mapConcurrent(requests, CONCURRENCY, async (i) => {
    const session = requests[i];
    const t0 = performance.now();
    let status = -1;
    try {
      const res = await fetch(`${base}/api/services/ai/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session.cookies,
          "X-CSRF-Token": session.csrf,
        },
        body: JSON.stringify({ model: "gemini-2.0-flash", prompt: "load test" }),
      });
      status = res.status;
    } catch {
      status = -1;
    }
    return { status, latency: performance.now() - t0 };
  });

  const ok = results.filter((r) => r.status === 200);
  const server5xx = results.filter((r) => r.status >= 500);
  const latencies = ok.map((r) => r.latency).sort((a, b) => a - b);
  const generateP95 = p95Of(latencies);
  const successPct = results.length > 0 ? (ok.length / results.length) * 100 : 0;
  const statusBreakdown = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  check(
    `generate p95 ${generateP95} ms < ${BUDGETS.generateP95Ms} ms (${ok.length}/${results.length} OK)`,
    generateP95 < BUDGETS.generateP95Ms && ok.length > 0,
  );
  check(
    `tasa de éxito ${successPct.toFixed(1)}% ≥ ${BUDGETS.generateSuccessPct}% (5xx: ${server5xx.length})`,
    successPct >= BUDGETS.generateSuccessPct && server5xx.length === 0,
    JSON.stringify(statusBreakdown),
  );
  return { generateP95, successPct, server5xx: server5xx.length };
}

// ── Run principal ───────────────────────────────────────────────────
const startedAt = performance.now();
let companion = null;
let mock = null;
let globalTimer = null;
let failure = null;

try {
  const companionPort = await getFreePort();
  const mock = await startMockUpstream();
  globalTimer = setTimeout(() => {
    companion?.kill("SIGKILL");
    mock?.server.close();
    console.error("\n✗ TIMEOUT GLOBAL — el run excedió " + TIMEOUT_MS + " ms");
    process.exit(1);
  }, TIMEOUT_MS);
  globalTimer.unref();

  console.log("🔬 Prueba de carga — companion server");
  console.log("=".repeat(56));
  console.log(`mock upstream IA en :${mock.port} (latencia ${MOCK_LATENCY_MS} ms)`);

  companion = await startCompanionServer(companionPort, mock.port);
  const wsUrl = `ws://127.0.0.1:${companionPort}`;
  const httpBase = `http://127.0.0.1:${companionPort}`;
  console.log(`companion server en ${wsUrl} (MAX_CONNECTIONS=${MAX_CONNECTIONS})`);

  if (!(await waitForHealth(httpBase))) {
    check("/health responde 200 al arrancar", false);
  } else {
    check("/health responde 200 al arrancar", true);
  }

  const sig = await runSignalingPhase(wsUrl);
  const ai = await runAiPhase(httpBase, 20, 10);

  console.log("\n" + "=".repeat(56));
  console.log(
    `p95 join=${sig.joinP95} ms · p95 relay=${sig.relayP95} ms · ` +
      `p95 generate=${ai.generateP95} ms · éxito IA=${ai.successPct.toFixed(1)}%`,
  );
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  check("ejecución sin errores de infraestructura", false, failure);
} finally {
  if (globalTimer) clearTimeout(globalTimer);
  if (companion) {
    try {
      companion.kill("SIGKILL");
    } catch {
      /* ya terminado */
    }
  }
  if (mock) {
    try {
      mock.server.close();
    } catch {
      /* ya cerrado */
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
