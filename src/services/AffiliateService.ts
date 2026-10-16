/**
 * Affiliate Service — the browser side of the referral (Whop affiliate) API.
 *
 * ## Same-origin by default
 *
 * The referral API lives at `/api/affiliate/*` on the APP's own origin, exactly
 * like the license signing service (LICENSE_CONFIG.signingServiceBaseUrl). That
 * is what makes the call legal under the shipped CSP (`connect-src 'self'`,
 * public/_headers) and routable on every host: the Docker/nginx topology proxies
 * `location ^~ /api/affiliate/` to the companion server, and any other host can
 * proxy the same two paths. A self-hoster may point it at a different origin
 * with VITE_COMPANION_URL — that override must then ALSO be present in the
 * host's `connect-src`, because the browser enforces the policy, not this code.
 *
 * ## The proof travels with the request
 *
 * `/api/affiliate` is a paid surface (`PAID_PATH_PREFIXES` in
 * `server/src/route-table.ts`), so the companion verifies a Pro license proof
 * before it spends the deployment's Whop credential. The signed
 * `{ payload, signature }` goes in the same JSON body as `deviceId`, and the
 * server refuses a device id that does not match the one bound into the signed
 * payload — a caller cannot ask for another install's referral record.
 *
 * A 401 is therefore a legitimate answer ("this install is not Pro"), not an
 * outage: it maps to `not_entitled` and the panel shows its honest fallback.
 *
 * ## Honest results, no invented data
 *
 * Every path returns a discriminated result. The previous implementation
 * answered `{ totalReferrals: 0, totalEarnings: "$0" }` when the request failed,
 * which is indistinguishable from a real zero and silently hid outages and
 * misconfiguration. Callers now see `ok: false` with a reason and decide what to
 * show; a missing link is `referralLink: null`, never a template placeholder.
 *
 * ## Privacy
 *
 * Requests go through `firewalledFetch`, so the user's network firewall applies
 * (unknown origins are refused and redirects are not followed). Only the
 * per-install device id is sent; no vault content and no credential is.
 */

import { env } from "../env.config";
import { logger } from "../utils/logger";
import { firewalledFetch } from "../utils/networkFirewall";
import { cancelResponseBody, readBoundedResponseJson } from "./ai/utils";

/** Bearer-free base path of the referral API: same-origin unless overridden. */
function affiliateBase(): string {
  const override = env.companionUrl?.trim();
  if (!override) return "/api/affiliate";
  return `${override.replace(/\/+$/, "")}/api/affiliate`;
}

const MAX_RESPONSE_CHARS = 64 * 1024;
const MAX_DEVICE_ID_CHARS = 128;

/** Why a referral call did not produce data. */
export type AffiliateFailure =
  | "invalid_device_id"
  /** The deployment enforces Pro and this install presented no valid proof. */
  | "not_entitled"
  | "not_configured"
  | "network"
  | "server";

/** The signed license proof the companion verifies before spending Whop credit. */
export interface AffiliateProof {
  payload: unknown;
  signature: string;
}

export type AffiliateResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AffiliateFailure };

export interface AffiliateStats {
  totalReferrals: number;
  totalEarnings: string;
  /** Whop affiliate id, or "" when the device has no affiliate record yet. */
  affiliateId: string;
  /** Share link for this affiliate, or null when it cannot be built yet. */
  referralLink: string | null;
}

export interface AffiliateLink {
  affiliateId: string;
  referralLink: string | null;
}

/**
 * Accepts only an https Whop checkout link. The link is rendered in an input and
 * written to the user's clipboard, so a misconfigured or compromised endpoint
 * must not be able to hand the app an arbitrary URL to copy or open.
 */
export function sanitizeAffiliateLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== "whop.com" && !host.endsWith(".whop.com")) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function readCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function readMoney(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "$0";
}

interface AffiliateResponseShape {
  success?: boolean;
  error?: string;
  affiliateId?: unknown;
  affiliateLink?: unknown;
  totalReferrals?: unknown;
  totalEarnings?: unknown;
}

/**
 * POSTs to the referral API and maps the answer onto a discriminated result.
 * A non-2xx answer is a failure with a reason — it is never read as data.
 */
async function postAffiliate(
  action: "create" | "stats",
  deviceId: string,
  proof: AffiliateProof | null,
): Promise<AffiliateResult<AffiliateResponseShape>> {
  if (
    typeof deviceId !== "string" ||
    deviceId.trim().length === 0 ||
    deviceId.length > MAX_DEVICE_ID_CHARS ||
    /[\u0000-\u001f\u007f-\u009f]/.test(deviceId)
  ) {
    logger.warn("[AffiliateService] Refusing a malformed device id");
    return { ok: false, error: "invalid_device_id" };
  }

  let response: Response;
  try {
    response = await firewalledFetch(
      `${affiliateBase()}/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Built key by key, never spread from the caller: an unexpected key in
        // a proof object must not be able to rewrite the request.
        body: JSON.stringify(
          proof
            ? { deviceId, payload: proof.payload, signature: proof.signature }
            : { deviceId },
        ),
      },
      "AffiliateService",
    );
  } catch (error) {
    logger.warn("[AffiliateService] Referral request blocked or failed", {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "network" };
  }

  let payload: AffiliateResponseShape | null = null;
  try {
    payload = await readBoundedResponseJson<AffiliateResponseShape>(
      response,
      MAX_RESPONSE_CHARS,
    );
  } catch (error) {
    await cancelResponseBody(response);
    logger.warn("[AffiliateService] Unreadable referral response", {
      action,
      status: response.status,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: response.status === 503 ? "not_configured" : "server" };
  }

  if (response.status === 503) {
    // The deployment has no Whop credential wired up. Fail closed and say so.
    logger.info("[AffiliateService] Referral API not configured on this deployment", {
      action,
    });
    return { ok: false, error: "not_configured" };
  }
  if (response.status === 401) {
    // The paid-route guard refused the request: no proof, or a proof for
    // another install. An expected answer, so it is logged as information.
    logger.info("[AffiliateService] Referral API requires a Pro license proof", {
      action,
    });
    return { ok: false, error: "not_entitled" };
  }
  if (!response.ok || payload?.success !== true) {
    logger.warn("[AffiliateService] Referral API rejected the request", {
      action,
      status: response.status,
    });
    return { ok: false, error: "server" };
  }
  return { ok: true, data: payload };
}

/**
 * Creates the caller's Whop affiliate record (idempotent server-side) and
 * returns its share link when the deployment can build one.
 */
export async function createProAffiliate(
  deviceId: string,
  proof: AffiliateProof | null,
): Promise<AffiliateResult<AffiliateLink>> {
  const result = await postAffiliate("create", deviceId, proof);
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      affiliateId:
        typeof result.data.affiliateId === "string" ? result.data.affiliateId : "",
      referralLink: sanitizeAffiliateLink(result.data.affiliateLink),
    },
  };
}

/**
 * Reads the caller's referral counters and share link in one round trip — the
 * link is what the Settings panel displays, so it never needs a placeholder.
 */
export async function getAffiliateStats(
  deviceId: string,
  proof: AffiliateProof | null,
): Promise<AffiliateResult<AffiliateStats>> {
  const result = await postAffiliate("stats", deviceId, proof);
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      totalReferrals: readCount(result.data.totalReferrals),
      totalEarnings: readMoney(result.data.totalEarnings),
      affiliateId:
        typeof result.data.affiliateId === "string" ? result.data.affiliateId : "",
      referralLink: sanitizeAffiliateLink(result.data.affiliateLink),
    },
  };
}
