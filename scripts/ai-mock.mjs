#!/usr/bin/env node
/**
 * Ephemeral Gemini-compatible upstream for local dry-run / staging smoke tests.
 * Never expose this server to the public network or use it as production AI.
 */
import { createServer } from "node:http";

const port = Number(process.env.AI_MOCK_PORT ?? 8081);
const expectedKey = process.env.AI_MOCK_KEY ?? "ai-mock-key";

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { status: "ok" });
  }
  if (req.method !== "POST" || !req.url?.includes("/v1beta/models/")) {
    return json(res, 404, { error: { message: "not found" } });
  }
  if (req.headers["x-goog-api-key"] !== expectedKey) {
    return json(res, 401, { error: { message: "unauthorized" } });
  }

  // Read the request body so media endpoints can be told apart by their
  // payload (the AI proxy forwards the exact upstream contract).
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) {
      return json(res, 413, { error: { message: "too large" } });
    }
  }

  // Imagen-compatible image generation (used by /api/services/ai/generate-image).
  if (req.url.includes(":predict")) {
    return json(res, 200, { predictions: [{ bytesBase64: "aW1hZ2UtbW9jaw==" }] });
  }

  // Gemini audio modality (used by /api/services/ai/generate-tts).
  if (req.url.includes(":generateContent") && body.includes('"AUDIO"')) {
    return json(res, 200, {
      candidates: [
        { content: { parts: [{ inlineData: { mimeType: "audio/mpeg", data: "bW9jaw==" } }] } },
      ],
    });
  }

  const isStream = req.url.includes(":streamGenerateContent");
  if (!isStream) {
    return json(res, 200, {
      candidates: [{ content: { parts: [{ text: "ai-mock-ok" }] } }],
    });
  }

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
  console.log(`ai-mock listening on ${port}`);
});
