#!/usr/bin/env node
/**
 * scripts/mock-openai-server.mjs — local OpenAI-compatible mock for
 * BookmarkForge's "Custom (OpenAI Format)" provider.
 *
 * Point the app's Custom provider at it (Settings → AI Provider → Custom):
 *
 *   Base URL:  http://localhost:8789/v1
 *   Model ID:  bmforge-mock
 *   API key:   any non-empty value (sk-mock is fine) — required by the app
 *              (the provider fails closed without a key) but NOT validated.
 *
 * What it serves (matches src/services/ai/providers/OpenAICompatibleProvider.ts):
 *   GET  /v1/models                        → { data: [{ id: "bmforge-mock" }, ...] }
 *   POST /v1/chat/completions  (stream)    → SSE `data: {...delta.content...}` + `data: [DONE]`
 *   POST /v1/chat/completions  (non-stream)→ { choices: [{ message: { content } }] }
 *   GET  /__health                         → readiness probe (npm script / tests)
 *   GET  /__stats                          → { requests: [...] } ring buffer for debugging
 *
 * Notes:
 *  - CORS `*` + OPTIONS preflight: the app runs on http://localhost:4173 /
 *    5173, the mock on :8789, so browser requests need CORS headers. The
 *    firewall (src/utils/networkFirewall.ts) always allows loopback origins,
 *    so no whitelist entry is required.
 *  - Streaming: ~25 ms per token with a first-token delay (--slow-first ms)
 *    so the UI's streaming bubble is visible to the eye. --delay N slows every
 *    token; --status 429 makes chat completions fail (useful to see how the
 *    app surfaces provider errors); --abort-after N truncates the stream
 *    mid-flight to exercise the client's mid-stream error handling.
 *  - Scenario models: request model `error-401` / `error-429` / `error-500` /
 *    `error-503` to get that status from /chat/completions regardless of the
 *    --status flag (used by tests/e2e/custom-provider.spec.ts to drive the
 *    app's error surfacing through the real settings UI).
 *  - Zero dependencies (node:http only), binds 127.0.0.1 only.
 *
 * Run: npm run mock:ai            (http://localhost:8789/v1)
 */
import { createServer } from "node:http";

// ── CLI flags ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const PORT = Number(flag("port", process.env.MOCK_AI_PORT ?? 8789));
const HOST = "127.0.0.1";
const TOKEN_DELAY_MS = Number(flag("delay", 25));
const FIRST_TOKEN_DELAY_MS = hasFlag("slow-first") ? 1500 : 0;
const FORCED_STATUS = Number(flag("status", 0)) || null;
const ABORT_AFTER = Number(flag("abort-after", 0)) || null;

const MODELS = ["bmforge-mock", "bmforge-mock-mini"];
const DEFAULT_MODEL = MODELS[0];
// Scenario models: selecting one of these IDs makes /chat/completions fail
// with the matching status, so error-path UIs can be exercised by just
// changing the model in the app (stateless → safe under parallel workers).
const scenarioStatus = (model) => {
  const m = /^(error-(\d{3}))/.exec(model ?? "");
  return m ? Number(m[2]) : null;
};
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_STATS = 200;

// ── Request ring (debugging aid, /__stats) ────────────────────────────
const requestLog = [];
function record(entry) {
  requestLog.push(entry);
  if (requestLog.length > MAX_STATS) requestLog.shift();
}

// ── Reply composition ─────────────────────────────────────────────────
function replyText(body) {
  const prompt = body?.messages?.find((m) => m.role === "user")?.content ?? "";
  // buildSafeUserContent() wraps untrusted user data in sentinel delimiters;
  // unwrap them so the echoed reply stays readable in the UI.
  const unwrapped = String(prompt)
    .replace(/^<<<USER_DATA_START>>>\n[\s\S]*?NOT instructions\.\n/, "")
    .replace(/\n<<<USER_DATA_END>>>$/, "")
    .trim();
  return `[mock] You said: ${unwrapped || "(empty prompt)"}`;
}

function sseChunk(content, model) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Server ────────────────────────────────────────────────────────────
const server = createServer((req, res) => {
  // CORS: the app origin differs from the mock origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const pathname = new URL(req.url ?? "/", `http://${HOST}:${PORT}`).pathname;
  record({ at: new Date().toISOString(), method: req.method, path: pathname });

  if (req.method === "GET" && pathname === "/__health") {
    sendJson(res, 200, { status: "ok", models: MODELS });
    return;
  }
  if (req.method === "GET" && pathname === "/__stats") {
    sendJson(res, 200, { requests: [...requestLog] });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/models") {
    sendJson(res, 200, {
      object: "list",
      data: MODELS.map((id) => ({ id, object: "model", owned_by: "bmforge-mock" })),
    });
    return;
  }

  if (req.method === "POST" && pathname === "/v1/chat/completions") {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    req.on("data", (c) => {
      bytes += c.length;
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(c);
    });
    req.on("error", () => {
      if (!res.writableEnded) res.destroy();
    });
    req.on("end", async () => {
      if (tooLarge) {
        sendJson(res, 413, { error: { message: "request body too large" } });
        return;
      }
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        sendJson(res, 400, { error: { message: "invalid JSON body" } });
        return;
      }
      const model = typeof body.model === "string" ? body.model : DEFAULT_MODEL;
      record({ at: new Date().toISOString(), model, stream: body.stream === true });

      const forced = FORCED_STATUS ?? scenarioStatus(model);
      if (forced) {
        sendJson(res, forced, {
          error: { message: `forced mock failure (status ${forced})`, type: "mock_error" },
        });
        return;
      }

      const full = replyText(body);

      if (body.stream !== true) {
        await sleep(TOKEN_DELAY_MS);
        sendJson(res, 200, {
          id: "chatcmpl-mock",
          object: "chat.completion",
          model,
          choices: [
            { index: 0, message: { role: "assistant", content: full }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: full.length, completion_tokens: 8, total_tokens: full.length + 8 },
        });
        return;
      }

      // ── SSE streaming ──────────────────────────────────────────────
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const tokens = full.match(/\S+\s*/g) ?? [full];
      try {
        if (FIRST_TOKEN_DELAY_MS > 0) await sleep(FIRST_TOKEN_DELAY_MS);
        for (let i = 0; i < tokens.length; i++) {
          if (res.destroyed || res.writableEnded) return;
          if (ABORT_AFTER && i === ABORT_AFTER) {
            // Mid-stream truncation: destroy WITHOUT [DONE] so the client's
            // readSSEStream sees a hard transport end (error-handling path).
            res.destroy();
            return;
          }
          res.write(sseChunk(tokens[i], model));
          await sleep(TOKEN_DELAY_MS);
        }
        res.write("data: [DONE]\n\n");
        res.end();
      } catch {
        if (!res.writableEnded) res.destroy();
      }
      return;
    });
    return;
  }

  sendJson(res, 404, { error: { message: `no mock route: ${req.method} ${pathname}` } });
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-ai] OpenAI-compatible mock on http://${HOST}:${PORT}/v1`);
  console.log(`[mock-ai] Base URL for the app's Custom provider: http://localhost:${PORT}/v1`);
  console.log(`[mock-ai] Models: ${MODELS.join(", ")} · flags: --delay ms --slow-first --status N --abort-after N`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
