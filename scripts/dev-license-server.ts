#!/usr/bin/env tsx
/**
 * scripts/dev-license-server.ts — E2E/dev adapter for the license function.
 *
 * The license/entitlement server surface was retired from the companion on
 * 2026-10-19 (see `server/src/route-table.ts` and the `PAID_PATH_PREFIXES`
 * tripwire in `check-pro-routes`), so nothing in the E2E stack answers
 * `/api/license/*` any more and Pro activation died with a 426 catch-all.
 * Re-mounting the routes in `server/src/index.ts` would reopen a paid surface
 * without an enforcement point, so this adapter runs the REAL serverless
 * handler (`api/license/[action].ts`) on its own loopback port instead and the
 * Vite test proxy points at it (`VITE_LICENSE_PROXY_TARGET`).
 *
 * DEV ONLY, fail closed:
 *   - refuses to start when NODE_ENV=production;
 *   - binds a loopback host only (default 127.0.0.1, LICENSE_DEV_HOST);
 *   - `/__health` answers 200 for Playwright readiness without touching the
 *     signing key; `/api/license/health` still reports `not_configured` (503)
 *     when WHOP_API_KEY or the signing key is missing.
 *
 * The signing key is loaded by the handler itself (LICENSE_SIGNING_PRIVATE_KEY_
 * PKCS8 -> LICENSE_SIGNING_PRIVATE_KEY_FILE -> server/.license-signing-key.
 * pkcs8). Without a key matching `src/services/licenseKeys.ts` the handler
 * fails closed with 503; for local Pro-seeding rotate both sides with
 * `node scripts/generate-license-keys.mjs --write`.
 */
import { createServer } from "node:http";
import { isIP } from "node:net";
import licenseHandler from "../api/license/[action].js";
import { loadSigningPrivateKey } from "../api/license/_license-signing.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

if (process.env.NODE_ENV === "production") {
  console.error("[dev-license] refusing to start: this adapter is dev/test only");
  process.exit(1);
}

const host = (process.env.LICENSE_DEV_HOST ?? "127.0.0.1").trim();
if (!LOOPBACK_HOSTS.has(host) && isIP(host) !== 0 && !host.startsWith("127.")) {
  console.error(`[dev-license] refusing to bind non-loopback host "${host}"`);
  process.exit(1);
}

const port = Number(process.env.LICENSE_DEV_PORT ?? 8788);
const hasSigningKey = loadSigningPrivateKey() !== null;
const hasProviderKey = Boolean(process.env.WHOP_API_KEY);
const providerUrl = process.env.WHOP_LICENSE_API_URL ?? "(whop default)";

const server = createServer((req, res) => {
  // Readiness probe: Playwright must not depend on the signing key being
  // present, otherwise a missing key turns into a 120 s webServer timeout
  // instead of the explicit 503 the handler returns.
  if (req.method === "GET" && req.url === "/__health") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({
        status: "ok",
        signingKey: hasSigningKey ? "present" : "missing",
        providerKey: hasProviderKey ? "present" : "missing",
      }),
    );
    return;
  }

  void licenseHandler(req, res);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`[dev-license] port ${port} is already in use`);
  } else {
    console.error(`[dev-license] server error: ${error.code ?? "unknown"}`);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(
    `[dev-license] api/license adapter on http://${host}:${port} ` +
      `(signing key: ${hasSigningKey ? "present" : "missing"}, ` +
      `provider key: ${hasProviderKey ? "present" : "missing"}, upstream: ${providerUrl})`,
  );
  if (!hasSigningKey) {
    console.warn(
      "[dev-license] no signing key: activation will fail closed with 503. " +
        "Generate one with: node scripts/generate-license-keys.mjs --write",
    );
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
