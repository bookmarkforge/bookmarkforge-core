#!/usr/bin/env node
/**
 * scripts/test-upstream-server.mjs — fake Gemini upstream for Playwright E2E.
 *
 * Purpose (replaces the previous "port 9 / guaranteed dead upstream" trick):
 * the companion server's Gemini proxy (server/src/ai-proxy.ts) fetches
 * `${GEMINI_API_BASE}/${model}:generateContent` (or `:streamGenerateContent?alt=sse`)
 * with the server-side API key. By pointing GEMINI_API_BASE at THIS server,
 * E2E specs can exercise the FULL production chain —
 *
 *   browser → GeminiProvider → /api/services/ai/session (CSRF)
 *           → Vite /api proxy → companion entitlement guard
 *           → geminiProxyHandler → THIS upstream
 *
 * — including how the proxy maps upstream failures (4xx/5xx → 502/429 with a
 * sanitized error body) and how it streams SSE, with ZERO production-code
 * changes and no third-party mock library (MSW was evaluated and rejected:
 * see tests/e2e/gemini-upstream-errors.spec.ts header).
 *
 * ── Parallel-safe scenario selection ─────────────────────────────────
 * Playwright runs specs fullyParallel across workers; a shared mutable
 * "current scenario" would race. Instead scenarios are STATELESS and keyed
 * by the model name, which the proxy forwards verbatim
 * (normalizeModel allows `[A-Za-z0-9._-]{1,128}`):
 *
 *   model "gemini-2.0-flash"  → success (unary + stream)
 *   model "scenario-401"      → 401 with a poisoned body (leak sentinel)
 *   model "scenario-429"      → 429
 *   model "scenario-500"      → 500
 *   model "scenario-notext"   → 200 with an empty candidates array
 *   model "scenario-badjson"  → 200 with a non-JSON body
 *
 * Tests request them simply by passing that model to GeminiProvider
 * (AIRequestOptions.model) — no control POST, no cross-worker state.
 *
 * Control surface (not race-sensitive):
 *   GET  /__health → 200 {"status":"ok"} (webServer readiness probe)
 *   GET  /__stats  → { requests: [{ model, action, at }] } (bounded ring)
 *
 * Security: binds 127.0.0.1 only; caps body size; serves nothing else.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.AI_UPSTREAM_PORT ?? 8788);
const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_STATS_ENTRIES = 500;

/** Poison payload embedded in fake upstream error bodies. The proxy must
 * NEVER forward upstream error bodies to the browser — if this sentinel
 * ever reaches a test assertion, that guarantee is broken. */
const LEAK_SENTINEL = "upstream-secret-token-do-not-forward";

const upstreamRequests = [];

function record(model, action) {
  upstreamRequests.push({ model, action, at: Date.now() });
  if (upstreamRequests.length > MAX_STATS_ENTRIES) {
    upstreamRequests.splice(0, upstreamRequests.length - MAX_STATS_ENTRIES);
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

/** Parse `${model}:${action}` out of the Gemini-style path. */
function parseGeminiPath(pathname) {
  const colon = pathname.lastIndexOf(":");
  if (colon <= 0) return null;
  const model = pathname.slice(0, colon).replace(/^.*\/models\//, "");
  const action = pathname.slice(colon + 1);
  if (action !== "generateContent" && action !== "streamGenerateContent") {
    return null;
  }
  return { model, action };
}

function scenarioFor(model) {
  if (model === "scenario-401") return { status: 401 };
  if (model === "scenario-429") return { status: 429 };
  if (model === "scenario-500") return { status: 500 };
  if (model === "scenario-notext") return { noText: true };
  if (model === "scenario-badjson") return { badJson: true };
  if (model === "scenario-stream-abort") return { abortAfter: 2 };
  return { ok: true };
}

function sseChunk(text) {
  return `data: ${JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  })}\n\n`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && url.pathname === "/__health") {
    sendJson(res, 200, { status: "ok", upstream: "bookmarkforge-test-stub" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/__stats") {
    sendJson(res, 200, { requests: [...upstreamRequests] });
    return;
  }

  const gemini = parseGeminiPath(url.pathname);
  if (req.method !== "POST" || !gemini) {
    sendJson(res, 404, { error: { message: `no upstream route for ${req.method} ${url.pathname}` } });
    return;
  }

  // Bounded body read (the proxy sends a JSON generateContent payload).
  const chunks = [];
  let bytes = 0;
  let tooLarge = false;
  req.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      tooLarge = true;
      return;
    }
    chunks.push(chunk);
  });
  req.on("error", () => {
    if (!res.writableEnded) res.destroy();
  });

  req.on("end", () => {
    if (tooLarge) {
      sendJson(res, 413, { error: { message: "body too large" } });
      return;
    }
    record(gemini.model, gemini.action);
    const scenario = scenarioFor(gemini.model);

    if (scenario.status) {
      // Mirrors Gemini error shape; the poisoned field must be dropped by
      // the proxy's error-mapping branch (it sends its own sanitized body).
      sendJson(res, scenario.status, {
        error: {
          code: scenario.status,
          message: `forced upstream ${scenario.status}`,
          details: LEAK_SENTINEL,
        },
      });
      return;
    }

    if (gemini.action === "streamGenerateContent") {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
      if (scenario.badJson) {
        res.write("data: this-is-not-json\n\n");
        res.end();
        return;
      }
      if (scenario.noText) {
        // Stream that ends without ever emitting text.
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [] } }] })}\n\n`);
        res.end();
        return;
      }
      // Erróneo: stream que se corta prematuramente sin [DONE] para
      // verificar que el cliente (readSSEStream) reacciona al fallo de
      // transporte (socket cerrado prematuramente) y no deja sockets huérfanos.
      if (scenario.abortAfter) {
        let emitted = 0;
        // Send a few chunks, then destroy the socket without sending [DONE],
        // simulating an upstream that drops mid-stream.
        function emitNext() {
          if (emitted < scenario.abortAfter) {
            res.write(sseChunk(`chunk-${emitted}`));
            emitted += 1;
            setImmediate(emitNext);
          } else {
            // Premature close — no [DONE], socket destroyed.
            res.destroy();
          }
        }
        emitNext();
        return;
      }
      res.write(sseChunk("Stub "));
      res.write(sseChunk("stream "));
      res.write(sseChunk("reply"));
      res.end();
      return;
    }

    // Unary generateContent.
    if (scenario.badJson) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("<html>not json at all</html>");
      return;
    }
    if (scenario.noText) {
      sendJson(res, 200, { candidates: [{ content: { parts: [] } }] });
      return;
    }
    sendJson(res, 200, {
      candidates: [
        {
          content: { parts: [{ text: "Stub reply from upstream" }] },
          groundingMetadata: { groundingChunks: [] },
        },
      ],
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`AI upstream stub running on http://${HOST}:${PORT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
