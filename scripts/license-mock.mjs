#!/usr/bin/env node
/**
 * Ephemeral Whop-compatible license adapter for local dry-run / staging only.
 * It issues no real entitlements and must never be exposed publicly.
 */
import { createServer } from "node:http";

const port = Number(process.env.LICENSE_MOCK_PORT ?? 8082);
const expectedKey = process.env.LICENSE_MOCK_KEY ?? "license-mock-key";

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16 * 1024) throw new Error("body_too_large");
  }
  return JSON.parse(body || "{}");
}

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
  if (req.method !== "POST" || !req.url?.startsWith("/license/")) {
    return json(res, 404, { error: "not found" });
  }
  if (req.headers.authorization !== `Bearer ${expectedKey}`) {
    return json(res, 401, { error: "license key invalid" });
  }

  try {
    const input = await readJson(req);
    if (input.license_key === "INVALID") {
      return json(res, 200, { valid: false, error: "license key invalid" });
    }
    if (req.url.endsWith("/deactivate")) {
      return json(res, 200, { ok: true, deactivated: true, status: "deactivated" });
    }
    if (!input.license_key || (!input.instance_name && !input.instance_id)) {
      return json(res, 400, { error: "license key invalid" });
    }
    const active = req.url.endsWith("/activate") ? { activated: true } : { valid: true };
    return json(res, 200, {
      ...active,
      instance: { id: input.instance_id ?? `staging-${input.instance_name}` },
      license: { status: "active", activations: 1, limit: 5 },
    });
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : "invalid request" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`license-mock listening on ${port}`);
});
