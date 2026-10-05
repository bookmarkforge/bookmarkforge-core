#!/usr/bin/env node
/**
 * Production API smoke test for the deployed web/API topology.
 *
 * Validates the same code paths that run in production. It never prints
 * secrets. Run it after:
 *
 *   docker compose -f docker-compose.prod.yml up -d --build
 *   node scripts/production-smoke.mjs
 *
 * The API-surface checks (health, license, client-events, WebSocket signaling)
 * are exported as `runApiSurfaceChecks` and are also driven Docker-free by
 * scripts/local-smoke.mjs, so both paths share the exact same assertions.
 *
 * There are no AI checks left: the server serves no AI route (the browser
 * talks to the user's provider directly), so probing one here would assert
 * that nginx still proxies a surface the companion api answers with 426.
 *
 * Env:
 *   PROD_BASE_URL          (default http://127.0.0.1:8080)
 *   SMOKE_LICENSE_KEY      optional license key for activation checks
 */


function createCheckers() {
  const checks = [];
  const check = (label, condition, detail) => {
    checks.push({ label, condition, detail });
    console.log(`${condition ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  };
  return { checks, check };
}

function makeRequester(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return async (path, init) => {
    // Hard per-request cap so the smoke (and monitoring-alerts, which spawns
    // it) can never hang on a dead/slow upstream. Aborts also trigger the
    // caller's own signal if one was provided.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const signal = init?.signal;
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    let response, text;
    try {
      response = await fetch(`${normalized}${path}`, { ...init, signal: controller.signal });
      text = await response.text();
    } catch (err) {
      // Fail the check fast (status 599) instead of throwing and killing the
      // whole smoke run.
      return {
        response: { status: 599, ok: false, headers: new Headers(), text: async () => String(err) },
        text: String(err),
        body: null,
        error: String(err),
      };
    } finally {
      clearTimeout(timer);
    }
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // SSE and plain-text responses are intentionally left as text.
    }
    return { response, text, body };
  };
}

/**
 * Run the companion-server API checks (health, license, client-events,
 * WebSocket signaling) against `baseUrl`. Shared by the nginx production smoke
 * and the Docker-free local smoke. Returns `{ ok, checks }`.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl       scheme+host[:port] of the api origin
 * @param {boolean} [opts.skipLicense] skip the license checks entirely (no
 *                                    signing key present)
 */
export async function runApiSurfaceChecks({ baseUrl, skipLicense = false }) {
  const normalized = baseUrl.replace(/\/+$/, "");
  const { checks, check } = createCheckers();
  const request = makeRequester(normalized);

  // ── Companion server health ───────────────────────────────────────
  const health = await request("/health");
  check(
    "companion /health",
    health.response.status === 200 && health.body?.status === "ok",
    `HTTP ${health.response.status}`,
  );

  // ── License adapter ──────────────────────────────────────────────
  if (skipLicense || !process.env.SMOKE_LICENSE_KEY) {
    console.log(skipLicense ? "SKIP license checks (signing key absent)" : "SKIP license activation (SMOKE_LICENSE_KEY absent)");
  } else {
    const licenseHealth = await request("/api/license/health");
    check("license health responds", licenseHealth.response.status === 200, `HTTP ${licenseHealth.response.status}`);
    const signingConfigured = licenseHealth.body?.signingConfigured === true;
    console.log(
      `INFO license signing configured: ${signingConfigured} (generate a key with 'node scripts/generate-license-keys.mjs --write')`,
    );

    if (signingConfigured) {
      const activation = await request("/api/license/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },          body: JSON.stringify({ license_key: process.env.SMOKE_LICENSE_KEY, instance_name: `smoke-${Date.now()}` }),
      });
      check(
        "license activation returns signed contract",
        activation.response.status === 200 &&
          activation.body?.payload != null &&
          typeof activation.body?.signature === "string" &&
          typeof activation.body.payload.deviceId === "string",
        `HTTP ${activation.response.status}`,
      );

      const invalid = await request("/api/license/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ license_key: "INVALID", instance_name: `smoke-${Date.now()}` }),
      });
      check("license adapter rejects invalid key", invalid.response.status === 400, `HTTP ${invalid.response.status}`);
    } else {
      console.log("SKIP license activation (signing key absent)");
    }
  }

  // ── Client events pipeline (CSP violation spikes) ────────────────
  // The client dispatches csp-violation-spike (productionMonitor) and
  // clientEventReporter forwards it to /api/client-events, where the collector
  // accepts it as inherently critical (cluster alert via CLIENT_CRITICAL). A
  // 400 here means the deployed api predates the contract — CSP cluster
  // alerting is dead and this check must fail.
  const cspEvent = await request("/api/client-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "csp-violation-spike", count: 1 }),
  });
  check(
    "client-events accepts csp-violation-spike",
    cspEvent.response.status === 204,
    `HTTP ${cspEvent.response.status}`,
  );

  // ── WebSocket signaling ──────────────────────────────────────────
  const wsProto = normalized.startsWith("https:") ? "wss" : "ws";
  const wsUrl = `${wsProto}://${new URL(normalized).host}`;
  const signalingOk = await new Promise((resolve) => {
    // The browser PWA uses wss://<domain>/; nginx proxies the upgrade to the
    // api. Use a dynamic import so this script runs on Node without bundling.
    import("ws")
      .then(({ WebSocket: WS }) => {
        const socket = new WS(wsUrl);
        const timer = setTimeout(() => {
          socket.terminate();
          resolve(false);
        }, 5000);
        socket.on("open", () => socket.send(JSON.stringify({ type: "join", room: "smoke-room" })));
        socket.on("message", (data) => {
          let msg = null;
          try {
            msg = JSON.parse(data.toString());
          } catch {
            return;
          }
          if (msg.type === "init") {
            // keep waiting for `joined`
          } else if (msg.type === "joined") {
            clearTimeout(timer);
            socket.close();
            resolve(true);
          }
        });
        socket.on("error", () => {
          clearTimeout(timer);
          resolve(false);
        });
      })
      .catch(() => resolve(false));
  });
  check("WebSocket signaling handshake", signalingOk, wsUrl);

  return { ok: checks.every(({ condition }) => condition), checks };
}

// ── Main (nginx production path) ─────────────────────────────────────
const isMain =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  const baseUrl = (process.env.PROD_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
  const { checks, check } = createCheckers();
  const request = makeRequester(baseUrl);

  // ── Static frontend + security headers (nginx only) ──────────────
  const root = await request("/");
  check(
    "index.html served",
    root.response.status === 200 && root.text.includes("<div id=\"root\">"),
    `HTTP ${root.response.status}`,
  );
  check(
    "CSP header present",
    typeof root.response.headers.get("content-security-policy") === "string",
    root.response.headers.get("content-security-policy")?.slice(0, 40),
  );
  check(
    "COOP cross-origin isolation",
    root.response.headers.get("cross-origin-opener-policy") === "same-origin",
    root.response.headers.get("cross-origin-opener-policy"),
  );

  // ── Companion server API surface (via nginx proxy) ───────────────
  const api = await runApiSurfaceChecks({ baseUrl });

  const all = [...checks, ...api.checks];
  if (all.some(({ condition }) => !condition)) {
    process.exitCode = 1;
  } else {
    console.log(`All ${all.length} production smoke checks passed.`);
  }
}
