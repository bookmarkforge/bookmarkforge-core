#!/usr/bin/env node
/**
 * HTTPS Gemini-compatible upstream for local staging / CI smoke tests.
 * Generates a self-signed cert at startup via openssl — NEVER use in production.
 *
 * Env vars:
 *   AI_MOCK_PORT  — listen port (default 8443)
 *   AI_MOCK_KEY   — expected x-goog-api-key (default "ai-mock-key")
 */
import { createServer } from "node:https";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const port = Number(process.env.AI_MOCK_PORT ?? 8443);
const expectedKey = process.env.AI_MOCK_KEY ?? "ai-mock-key";

// ── Self-signed cert via openssl ─────────────────────────────────────────────
const tmpDir = mkdtempSync(join(tmpdir(), "ai-mock-"));
const keyPath = join(tmpDir, "key.pem");
const certPath = join(tmpDir, "cert.pem");

execSync(
  `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} ` +
  `-days 3650 -nodes -subj "/CN=ai-mock-https" ` +
  `-addext "subjectAltName=DNS:localhost,DNS:bmf-ai-mock-https"`,
  { stdio: "pipe" },
);

const key = readFileSync(keyPath);
const cert = readFileSync(certPath);
rmSync(tmpDir, { recursive: true, force: true });

// ── HTTP handlers (same contract as ai-mock.mjs) ────────────────────────────
function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

const server = createServer({ cert, key }, async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { status: "ok" });
  }
  if (req.method !== "POST" || !req.url?.includes("/v1beta/models/")) {
    return json(res, 404, { error: { message: "not found" } });
  }
  if (req.headers["x-goog-api-key"] !== expectedKey) {
    return json(res, 401, { error: { message: "unauthorized" } });
  }

  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) {
      return json(res, 413, { error: { message: "too large" } });
    }
  }

  // Imagen-compatible image generation
  if (req.url.includes(":predict")) {
    return json(res, 200, { predictions: [{ bytesBase64: "aW1hZ2UtbW9jaw==" }] });
  }

  // Gemini audio modality
  if (req.url.includes(":generateContent") && body.includes('"AUDIO"')) {
    return json(res, 200, {
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/mpeg", data: "bW9jaw==" } }] } }],
    });
  }

  const isStream = req.url.includes(":streamGenerateContent");
  if (!isStream) {
    return json(res, 200, {
      candidates: [{ content: { parts: [{ text: "ai-mock-ok" }] } }],
    });
  }

  // SSE stream
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "ai-mock" }] } }] })}\n\n`);
  setTimeout(() => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "-ok" }] } }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }, 25);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`ai-mock-https listening on ${port} (self-signed TLS)`);
});
