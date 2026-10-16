/**
 * Whop.com Integration Service
 *
 * This service handles license management and payments through Whop.com
 * for the BookmarkForge Pro features.
 *
 * Pricing Model: Lifetime License for Major Version (no subscriptions)
 * - Early Bird: $59 (200 licenses FOMO)
 * - Regular v1: $79 (6-12 months after launch)
 * - v2 upgrade: $89 new / $35 v1 owners (60% off)
 *
 * See docs/pricing-decision.md for the complete pricing strategy.
 *
 * This implementation validates license keys through the Whop API
 * for lifetime license validation (not subscription-based).
 */

import { WhopClient } from "@whop/sdk";
import { logger, redactSecrets } from "../utils/logger";

// 2026-10-15 security audit (Finding #4): the Whop ACCOUNT API key is a
// platform credential ("acts on behalf of your account") and account-key
// validation lives SERVER-SIDE — `server/src/license-server.ts` and
// `api/license/_license-server.ts` own the license surface. This module is
// for server-side callers only and fails closed everywhere else:
//   - the key is read from `process.env.WHOP_API_KEY` at CALL time (never at
//     module scope, so a browser bundle cannot capture it at import),
//   - no client build defines WHOP_API_KEY (documented placeholder in
//     scripts/env-direct-reads.baseline.json),
//   - without the key every entry point returns the no-access result.

function getServerApiKey(): string | null {
  if (typeof process === "undefined" || !process.env) {return null;}
  const key = process.env.WHOP_API_KEY;
  return key ? key : null;
}

let whopClient: WhopClient | null = null;

/** Lazily-built Whop client; null when the account key is unavailable. */
function getWhopClient(): WhopClient | null {
  const token = getServerApiKey();
  if (!token) {return null;}
  if (!whopClient) {whopClient = new WhopClient({ token });}
  return whopClient;
}

// 2026-10-15 security audit (Finding #3): license keys and Whop responses
// must never reach logs unredacted — `redactSecrets` covers keyed shapes and
// URLs, and `secret` scrubs the literal key value when it is echoed back.
function redactForLog(input: string, secret?: string): string {
  const redacted = redactSecrets(input);
  return secret ? redacted.split(secret).join("[REDACTED]") : redacted;
}

export interface WhopLicenseValidation {
  has_access: boolean;
  access_level: "customer" | "admin" | "no_access";
  membership_id?: string;
  status?: "active" | "trialing" | "past_due" | "canceled" | "expired" | "completed";
  license_key?: string;
  current_period_end?: string;
}

export interface WhopMembership {
  id: string;
  status: "active" | "trialing" | "past_due" | "canceled" | "expired" | "completed";
  user_id: string | null;
  product_id: string;
  plan_id: string;
  license_key?: string | null;
  cancel_at_period_end: boolean;
  current_period_end?: string | null;
  metadata: Record<string, string>;
  created_at: string;
}

/**
 * Validate that a user has access to a premium product
 *
 * For BookmarkForge's lifetime license model, this checks if the user
 * has an active or completed membership for the Pro product.
 *
 * @param whopUserId - The Whop user ID stored in your database
 * @param productId - The product ID to check access for (from Whop dashboard)
 * @returns Validation result with access status
 */
export async function validateAccess(
  whopUserId: string,
  productId: string
): Promise<WhopLicenseValidation> {
  try {
    if (!getServerApiKey()) {
      logger.warn("[WhopService] WHOP_API_KEY not configured - access validation unavailable");
      return {
        has_access: false,
        access_level: "no_access",
      };
    }

    const memberships = await getUserMemberships(whopUserId);

    // Check if user has an active or completed membership for the product
    const proMembership = memberships.find(
      (m) => m.product_id === productId && (m.status === "active" || m.status === "completed")
    );

    if (proMembership) {
      return {
        has_access: true,
        access_level: "customer",
        membership_id: proMembership.id,
        status: proMembership.status,
        license_key: proMembership.license_key ?? undefined,
        current_period_end: proMembership.current_period_end ?? undefined,
      };
    }

    return {
      has_access: false,
      access_level: "no_access",
    };
  } catch (error) {
    logger.error("[WhopService] Access validation failed:", redactForLog(String(error)));
    return {
      has_access: false,
      access_level: "no_access",
    };
  }
}

/**
 * Validate a license key
 *
 * Validates a lifetime license key through the Whop API for BookmarkForge Pro.
 * This implementation uses the actual Whop API for license key validation.
 *
 * @param licenseKey - The license key to validate
 * @param productId - The product ID the key should be for
 * @param metadata - Optional metadata to bind to the key (e.g., device ID)
 * @returns Validation result with access status
 */
export async function validateLicenseKey(
  licenseKey: string,
  productId: string,
  metadata?: Record<string, string>
): Promise<WhopLicenseValidation> {
  try {
    if (!getServerApiKey()) {
      logger.warn("[WhopService] WHOP_API_KEY not configured - license validation unavailable");
      return {
        has_access: false,
        access_level: "no_access",
      };
    }

    const apiKey = getServerApiKey();
    // Call Whop API to validate the license key. The Whop REST route takes
    // the license key as a path segment — unavoidable upstream, so the
    // mitigation is log redaction below (Finding #3), never echoing the URL.
    const response = await fetch(`https://api.whop.com/api/v1/memberships/license_key/${encodeURIComponent(licenseKey)}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey ?? ""}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("[WhopService] License key validation failed:", response.status, redactForLog(errorText, licenseKey));
      return {
        has_access: false,
        access_level: "no_access",
      };
    }

    const data = await response.json();

    // Check if the membership is for the correct product and is active
    if (data.data && data.data.product_id === productId) {
      const membership = data.data;
      const isActive = membership.status === "active" || membership.status === "completed";

      // Update metadata if provided (e.g., bind device ID)
      if (metadata && Object.keys(metadata).length > 0) {
        await updateMembershipMetadata(membership.id, {
          ...membership.metadata,
          ...metadata,
        });
      }

      return {
        has_access: isActive,
        access_level: isActive ? "customer" : "no_access",
        membership_id: membership.id,
        status: membership.status,
        license_key: membership.license_key ?? undefined,
        current_period_end: membership.current_period_end ?? undefined,
      };
    }

    return {
      has_access: false,
      access_level: "no_access",
    };
  } catch (error) {
    logger.error("[WhopService] License key validation error:", redactForLog(String(error), licenseKey));
    return {
      has_access: false,
      access_level: "no_access",
    };
  }
}

/**
 * Get user's memberships
 * 
 * @param whopUserId - The Whop user ID
 * @returns List of user's memberships
 */
export async function getUserMemberships(
  whopUserId: string
): Promise<WhopMembership[]> {
  try {
    const whop = getWhopClient();
    if (!whop) {
      logger.warn("[WhopService] WHOP_API_KEY not configured - memberships fetch unavailable");
      return [];
    }
    const result = await whop.memberships.list({
      user_id: whopUserId,
    });

    // Whop SDK returns a Page object, we need to extract the data
    const memberships = result.data || [];
    
    return memberships.map((membership) => ({
      id: membership.id,
      status: membership.status as WhopMembership["status"],
      user_id: membership.user_id || "",
      product_id: membership.product_id,
      plan_id: membership.plan_id,
      license_key: membership.license_key || undefined,
      cancel_at_period_end: membership.cancel_at_period_end,
      current_period_end: membership.current_period_end ?? undefined,
      metadata: (membership.metadata as Record<string, string>) || {},
      created_at: membership.created_at,
    }));
  } catch (error) {
    logger.error("[WhopService] Whop memberships fetch failed:", redactForLog(String(error)));
    return [];
  }
}

/**
 * Cancel a membership
 * 
 * @param membershipId - The membership ID to cancel
 * @param atPeriodEnd - Whether to cancel at period end or immediately
 * @returns Success status
 */
export async function cancelMembership(
  membershipId: string,
  atPeriodEnd: boolean = true
): Promise<boolean> {
  try {
    const whop = getWhopClient();
    if (!whop) {return false;}
    await whop.memberships.cancel({
      id: membershipId,
      cancel_at_period_end: atPeriodEnd,
    });
    return true;
  } catch (error) {
    logger.error("[WhopService] Whop membership cancellation failed:", redactForLog(String(error)));
    return false;
  }
}

/**
 * Extend a membership with free days
 * 
 * @param membershipId - The membership ID to extend
 * @param days - Number of free days to add
 * @returns Success status
 */
export async function extendMembership(
  membershipId: string,
  days: number
): Promise<boolean> {
  try {
    const whop = getWhopClient();
    if (!whop) {return false;}
    await whop.memberships.extend({
      id: membershipId,
      days,
    });
    return true;
  } catch (error) {
    logger.error("[WhopService] Whop membership extension failed:", redactForLog(String(error)));
    return false;
  }
}

/**
 * Update membership metadata
 * 
 * @param membershipId - The membership ID to update
 * @param metadata - Key-value pairs to update
 * @returns Success status
 */
export async function updateMembershipMetadata(
  membershipId: string,
  metadata: Record<string, string>
): Promise<boolean> {
  try {
    const whop = getWhopClient();
    if (!whop) {return false;}
    await whop.memberships.update({
      id: membershipId,
      metadata,
    });
    return true;
  } catch (error) {
    logger.error("[WhopService] Whop membership metadata update failed:", redactForLog(String(error)));
    return false;
  }
}

// Lazy client accessor for advanced use cases (server-side callers only).
export { getWhopClient };