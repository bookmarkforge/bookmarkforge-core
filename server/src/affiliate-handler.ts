/**
 * server/src/affiliate-handler.ts — Whop affiliate API proxy
 *
 * The browser never holds a Whop credential: it posts to `/api/affiliate/*` on
 * its own origin and this handler adds WHOP_API_KEY server-side. The client
 * sends only its per-install device id.
 *
 * Trust model (every request):
 * - Pro entitlement: `route-table.ts` declares both routes as entitlement routes
 *   under the paid prefix `/api/affiliate`, so `createGuardedDispatcher()` runs
 *   the proof guard before this handler. This handler then REQUIRES the resolved
 *   context — mounted anywhere else (a bare dispatcher, a test harness) it answers
 *   401 instead of trusting its caller. The proof travels inside the same body as
 *   `deviceId`, and the guard owns reading it.
 * - Origin allowlist — `AI_SESSION_ORIGINS` (the same deploy-time allowlist
 *   /api/license/entitlement uses) plus `AFFILIATE_ALLOWED_ORIGINS` when set.
 *   Missing Origin is rejected in production.
 * - Per-IP rate limit.
 * - Bounded request body: the entitlement guard reads it with a 32 KiB proof cap
 *   (400 above it), on top of the shared 256 KiB transport cap, so an oversized
 *   POST can never buffer unbounded memory into the process that also serves
 *   signaling.
 * - Fail closed on a missing WHOP_API_KEY (503, never a fake success).
 *
 * Failure policy: a Whop outage or a malformed upstream response answers
 * `success: false` with a 5xx status. It is never converted into
 * `{ totalReferrals: 0, totalEarnings: "$0" }`, which is indistinguishable from
 * a real zero and hides outages from the user and the operator.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  clientIp,
  createRateLimiter,
  hasValidOrigin,
  sendJson,
} from "./proxy-utils";
import { readEntitlementContext } from "./entitlement-context";
import {
  createEntitlementGuard,
  writeGuardDenial,
  type EntitlementGuard,
} from "./entitlement-guard";

const RATE_LIMIT = 30;
const MAX_DEVICE_ID_LENGTH = 128;
const MAX_AFFILIATE_ID_LENGTH = 128;

interface AffiliateHandlerOptions {
  apiKey?: string;
  companyId?: string;
  proPlanId?: string;
  allowedOrigins?: readonly string[];
  allowMissingOrigin?: boolean;
  trustProxy?: boolean;
  rateLimit?: number;
  fetchImpl?: typeof fetch;
  /**
   * The guard whose verdict this handler requires. Its `enforced` flag is what
   * decides whether an anonymous context (a deployment that opted out of
   * entitlement enforcement) may proceed; the proof itself is verified by the
   * dispatcher guard, and this handler never re-verifies it.
   */
  entitlementGuard?: EntitlementGuard;
}

/** The affiliate record the client needs to share its own checkout link. */
interface AffiliateLink {
  affiliateId: string;
  /** Null when the plan id is not configured — never a fabricated URL. */
  affiliateLink: string | null;
}

interface AffiliateStats extends AffiliateLink {
  totalReferrals: number;
  totalEarnings: string;
}

/**
 * Builds the checkout link for an affiliate id. Returns null when the plan id
 * is missing: a link built from an empty plan id would send buyers to a dead
 * checkout while looking valid to the user copying it.
 */
function buildAffiliateLink(planId: string, affiliateId: string): string | null {
  if (!planId || !affiliateId) return null;
  return `https://whop.com/checkout/${encodeURIComponent(planId)}?a=${encodeURIComponent(affiliateId)}`;
}

/**
 * Extracts the affiliate id from the Whop response without inventing one. Whop
 * answers with a single affiliate object for `user_identifier` lookups and with
 * a collection for list shapes; anything else yields null so the caller answers
 * an honest "no link yet" instead of a guessed id.
 */
function extractAffiliateId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const candidates = [
    record.id,
    Array.isArray(record.data) ? (record.data[0] as Record<string, unknown> | undefined)?.id : undefined,
    Array.isArray(record.affiliates)
      ? (record.affiliates[0] as Record<string, unknown> | undefined)?.id
      : undefined,
    (record.data as Record<string, unknown> | undefined)?.id,
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      candidate.length > 0 &&
      candidate.length <= MAX_AFFILIATE_ID_LENGTH
    ) {
      return candidate;
    }
  }
  return null;
}

function readCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function readMoney(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "$0";
}

/**
 * Reads and validates the device id from the body the guard parsed. Answers 400
 * and returns null when it is missing or unusable. The body is deliberately NOT
 * read here: the entitlement guard consumed the stream, and a second read would
 * see an empty one (the transport caps live in the guard for the same reason).
 */
function readDeviceIdFrom(payload: unknown, res: ServerResponse): string | null {
  const parsed =
    typeof payload === "object" && payload !== null
      ? (payload as { deviceId?: unknown })
      : {};

  const deviceId = typeof parsed.deviceId === "string" ? parsed.deviceId.trim() : "";
  if (!deviceId) {
    sendJson(res, 400, { success: false, error: "deviceId required" });
    return null;
  }
  if (deviceId.length > MAX_DEVICE_ID_LENGTH || /[\u0000-\u001f\u007f-\u009f]/.test(deviceId)) {
    sendJson(res, 400, { success: false, error: "deviceId invalid" });
    return null;
  }
  return deviceId;
}

/**
 * Builds the two affiliate handlers. Exported as a factory so the guards are
 * testable with injected options; `index.ts` uses the default-bound pair below.
 */
export function createAffiliateHandlers(options: AffiliateHandlerOptions = {}) {
  const apiKey = options.apiKey ?? process.env.WHOP_API_KEY ?? "";
  const companyId = options.companyId ?? process.env.WHOP_COMPANY_ID ?? "";
  const proPlanId = options.proPlanId ?? process.env.WHOP_PRO_PLAN_ID ?? "";
  // Deploy-time allowlist, same source as /api/license/entitlement. Both env
  // vars are comma-separated; the dedicated one can narrow the licensing list.
  const configuredOrigins = options.allowedOrigins ?? [
    ...(process.env.AFFILIATE_ALLOWED_ORIGINS ?? "").split(","),
    ...(process.env.AI_SESSION_ORIGINS ?? "").split(","),
  ];
  const allowedOrigins = new Set(
    configuredOrigins.map((origin) => origin.trim()).filter(Boolean),
  );
  const allowMissingOrigin = options.allowMissingOrigin ?? process.env.NODE_ENV !== "production";
  const trustProxy =
    options.trustProxy ?? (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true");
  const allowRequest = createRateLimiter({ rateLimit: options.rateLimit ?? RATE_LIMIT });
  const doFetch = options.fetchImpl ?? fetch;
  const guard = options.entitlementGuard ?? createEntitlementGuard();

  /**
   * Shared preflight: method, origin, rate limit, then the entitlement verdict
   * the dispatcher resolved plus the device id carried by that same body.
   */
  async function admit(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<string | null> {
    if (!apiKey) {
      sendJson(res, 503, { success: false, error: "Whop API not configured" });
      return null;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { success: false, error: "Method not allowed" });
      return null;
    }
    if (!hasValidOrigin(req, allowedOrigins, allowMissingOrigin)) {
      sendJson(res, 403, { success: false, error: "origin not allowed" });
      return null;
    }
    if (!allowRequest(clientIp(req, trustProxy))) {
      sendJson(res, 429, { success: false, error: "rate limited" });
      return null;
    }

    const context = readEntitlementContext(req);
    if (!context) {
      // Reached without the guarded dispatcher. This is a paid route
      // (route-table.ts), so an unresolved request is refused on the spot
      // instead of being served on the caller's word.
      writeGuardDenial(res, {
        status: 401,
        code: "LICENSE_REQUIRED",
        message: "license proof required",
      });
      return null;
    }
    if (guard.enforced && context.via !== "proof") {
      // Enforcement is on and the request carries no verified proof. The
      // dispatcher never lets this through; the check stays as defense in depth
      // so the handler's own contract does not depend on where it is mounted.
      writeGuardDenial(res, {
        status: 401,
        code: "LICENSE_REQUIRED",
        message: "license proof required",
      });
      return null;
    }
    return readDeviceIdFrom(context.proof, res);
  }

  /** POST /api/affiliate/create — creates the caller's Whop affiliate record. */
  async function handleCreateAffiliate(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const deviceId = await admit(req, res);
    if (deviceId === null) return;

    try {
      const upstream = await doFetch("https://api.whop.com/api/v1/affiliates", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ company_id: companyId, user_identifier: deviceId }),
      });

      if (!upstream.ok) {
        // Status only: the upstream body can echo the request payload.
        console.error(
          JSON.stringify({ event: "affiliate_create_failed", status: upstream.status }),
        );
        sendJson(res, 502, { success: false, error: "Whop API error" });
        return;
      }

      const affiliateId = extractAffiliateId(await upstream.json());
      sendJson(res, 200, {
        success: true,
        affiliateId,
        affiliateLink: affiliateId ? buildAffiliateLink(proPlanId, affiliateId) : null,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "affiliate_create_error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      sendJson(res, 502, { success: false, error: "Internal server error" });
    }
  }

  /**
   * POST /api/affiliate/stats — the caller's referral counters AND its share
   * link. The link travels here so the UI never needs a template placeholder:
   * one round trip answers "what is my link, and how is it doing?".
   */
  async function handleGetAffiliateStats(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const deviceId = await admit(req, res);
    if (deviceId === null) return;

    try {
      const upstream = await doFetch(
        `https://api.whop.com/api/v1/affiliates?company_id=${encodeURIComponent(companyId)}&user_identifier=${encodeURIComponent(deviceId)}`,
        { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } },
      );

      if (upstream.status === 404) {
        // Legitimate empty state: this device has no affiliate yet. Zeros are
        // the truth here, not a masked failure.
        sendJson(res, 200, emptyStats());
        return;
      }
      if (!upstream.ok) {
        console.error(
          JSON.stringify({ event: "affiliate_stats_failed", status: upstream.status }),
        );
        sendJson(res, 502, { success: false, error: "Whop API error" });
        return;
      }

      const payload = (await upstream.json()) as Record<string, unknown>;
      const affiliateId = extractAffiliateId(payload);
      const stats: AffiliateStats = {
        affiliateId: affiliateId ?? "",
        affiliateLink: affiliateId ? buildAffiliateLink(proPlanId, affiliateId) : null,
        totalReferrals: readCount(payload.total_referrals ?? payload.totalReferrals),
        totalEarnings: readMoney(payload.total_earnings ?? payload.totalEarnings),
      };
      sendJson(res, 200, { success: true, ...stats });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "affiliate_stats_error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      sendJson(res, 502, { success: false, error: "Internal server error" });
    }
  }

  return { handleCreateAffiliate, handleGetAffiliateStats };
}

function emptyStats(): { success: true } & AffiliateStats {
  return {
    success: true,
    affiliateId: "",
    affiliateLink: null,
    totalReferrals: 0,
    totalEarnings: "$0",
  };
}

const defaultHandlers = createAffiliateHandlers();

export const handleCreateAffiliate = defaultHandlers.handleCreateAffiliate;
export const handleGetAffiliateStats = defaultHandlers.handleGetAffiliateStats;
