/**
 * server/src/entitlement-endpoint.ts — POST /api/license/entitlement.
 *
 * The server-authoritative answer to "is this client Pro?". The client sends
 * the license proof it already holds (`{ payload, signature }`), the server
 * verifies it with the committed public key and answers with the resolved
 * plan. Two things this buys over the previous design, where the client
 * decided on its own:
 *
 *   - it needs no license key (the key lives in SecureStorage, unavailable
 *     while the vault is locked) and no signing private key, so it works on
 *     any deployment that only serves the app + proxies;
 *   - an explicit "free" answer is authoritative: expired, revoked or
 *     unverifiable proof downgrades the client instead of being absorbed by
 *     the offline grace window.
 *
 * Status codes are part of the contract:
 *   200 { plan: "pro" | "free" }  — a definitive answer (free carries a reason)
 *   400 malformed body · 403 origin · 405 method · 413 oversized · 429 rate
 *   503 SIGNING_KEY_INVALID — the deployment's key is unusable. This is NOT a
 *       downgrade: a misconfigured server must never revoke a paying user, so
 *       the client keeps its verified offline state.
 */
import { createPublicKey } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  applySecurityHeaders,
  clientIp,
  createRateLimiter,
  readBody,
  sendJson,
  hasValidOrigin,
} from "./proxy-utils";
import { createEntitlementGuard, type EntitlementGuard } from "./entitlement-guard";

const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT = 120;

export interface EntitlementEndpointOptions {
  now?: () => number;
  /** Overrides the committed public key (tests, key rotation). */
  licensePublicKeySpki?: string;
  /** Share the deployment's guard (the router does) instead of building one. */
  guard?: EntitlementGuard;
  allowedOrigins?: string[];
  allowMissingOrigin?: boolean;
  trustProxy?: boolean;
  rateLimit?: number;
}

export type EntitlementHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>;

export function createEntitlementHandler(
  options: EntitlementEndpointOptions = {},
): EntitlementHandler {
  // Verification is delegated to the shared guard: this endpoint answers a
  // *plan*, but the proof verification and the 503-vs-deny decision must be the
  // same code the paid routes use, or a client could be told "pro" here and be
  // refused there.
  const guard =
    options.guard ??
    createEntitlementGuard({
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(options.licensePublicKeySpki !== undefined
        ? { publicKeySpki: options.licensePublicKeySpki }
        : {}),
    });
  const publicKeySpki = guard.publicKeySpki;
  const allowedOrigins = new Set(
    (
      options.allowedOrigins ??
      (process.env.AI_SESSION_ORIGINS ?? "").split(",")
    )
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  const allowMissingOrigin =
    options.allowMissingOrigin ?? process.env.NODE_ENV !== "production";
  const trustProxy =
    options.trustProxy ??
    (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true");
  const allowIp = createRateLimiter({ rateLimit: options.rateLimit ?? RATE_LIMIT });

  // Fail fast in the logs (the runtime answer stays 503 so a key rotation
  // mistake never takes the whole API down): an unparseable key would
  // otherwise look like "everyone lost their license".
  try {
    createPublicKey({ key: Buffer.from(publicKeySpki, "base64"), format: "der", type: "spki" });
  } catch {
    console.error(
      "[entitlement] the configured license public key does not parse — /entitlement will answer 503 until LICENSE_PUBLIC_KEY_SPKI is fixed (run `node scripts/generate-license-keys.mjs --check`)",
    );
  }

  return async function handleEntitlementRequest(req, res) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "method not allowed" } });
      return;
    }
    if (!hasValidOrigin(req, allowedOrigins, allowMissingOrigin)) {
      sendJson(res, 403, { error: { code: "CSRF_ORIGIN", message: "browser origin is not allowed" } });
      return;
    }
    if (!allowIp(clientIp(req, trustProxy))) {
      sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "too many requests" } });
      return;
    }

    let proof: unknown;
    try {
      const raw = await readBody(req);
      if (raw.length > MAX_BODY_BYTES) {
        sendJson(res, 413, { error: { code: "INVALID_REQUEST", message: "entitlement proof is too large" } });
        return;
      }
      proof = JSON.parse(raw) as unknown;
    } catch {
      sendJson(res, 400, { error: { code: "INVALID_REQUEST", message: "entitlement proof is invalid" } });
      return;
    }

    const verification = guard.verifyProof(proof);
    if (!verification.ok) {
      const { denial } = verification;
      // An unusable key is an operator problem, not a customer problem.
      if (denial.status === 503) {
        console.error(
          "[entitlement] the configured license public key is unusable — check LICENSE_PUBLIC_KEY_SPKI",
        );
        sendJson(res, 503, {
          error: {
            code: "SIGNING_KEY_INVALID",
            message: "license verification is misconfigured",
            reason: denial.reason,
          },
        });
        return;
      }
      applySecurityHeaders(res);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          plan: "free",
          source: "none",
          reason: denial.reason,
          message: denial.message,
        }),
      );
      return;
    }

    const { entitlement } = verification.context;
    applySecurityHeaders(res);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        plan: "pro",
        source: "license",
        deviceId: entitlement.deviceId,
        validatedAt: entitlement.validatedAt,
        // The quota identity digest is deliberately not returned: it is an
        // internal key, and echoing it would let a caller probe the bucket.
        ...(entitlement.expiresAt !== undefined ? { expiresAt: entitlement.expiresAt } : {}),
        ...(entitlement.activationsLeft !== undefined
          ? { activationsLeft: entitlement.activationsLeft }
          : {}),
        ...(entitlement.instanceId !== undefined ? { instanceId: entitlement.instanceId } : {}),
      }),
    );
  };
}
