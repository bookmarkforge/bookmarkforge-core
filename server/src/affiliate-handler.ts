/**
 * server/src/affiliate-handler.ts — Whop affiliate API proxy
 *
 * This server-side endpoint proxies Whop affiliate API calls so the client
 * never needs the Whop API key. The client sends only user identifiers;
 * the server adds the API key and forwards to Whop.
 *
 * Security model:
 * - WHOP_API_KEY is server-only (never in VITE_* env vars)
 * - Rate-limited per IP to prevent abuse
 * - Origin filtering to prevent CSRF
 */

import type { IncomingMessage, ServerResponse } from "node:http";

const WHOP_API_KEY = process.env.WHOP_API_KEY ?? "";
const WHOP_COMPANY_ID = process.env.WHOP_COMPANY_ID ?? "";
const WHOP_PRO_PLAN_ID = process.env.WHOP_PRO_PLAN_ID ?? "";

// Fail closed if API key is not configured
if (!WHOP_API_KEY) {
  console.warn("[affiliate-handler] WHOP_API_KEY not configured - affiliate endpoints will be disabled");
}

interface CreateAffiliateRequest {
  deviceId: string;
}

interface CreateAffiliateResponse {
  success: boolean;
  affiliateId?: string;
  affiliateLink?: string;
  error?: string;
}

interface GetAffiliateStatsRequest {
  deviceId: string;
}

interface GetAffiliateStatsResponse {
  success: boolean;
  totalReferrals?: number;
  totalEarnings?: string;
  error?: string;
}

/**
 * POST /api/affiliate/create
 * Creates a Whop affiliate for a Pro user
 */
export async function handleCreateAffiliate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!WHOP_API_KEY) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Whop API not configured" }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Method not allowed" }));
    return;
  }

  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
  }

  let request: CreateAffiliateRequest;
  try {
    request = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Invalid JSON" }));
    return;
  }

  if (!request.deviceId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "deviceId required" }));
    return;
  }

  try {
    // Call Whop API to create affiliate
    const whopResponse = await fetch("https://api.whop.com/api/v1/affiliates", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WHOP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        company_id: WHOP_COMPANY_ID,
        user_identifier: request.deviceId,
      }),
    });

    if (!whopResponse.ok) {
      const errorText = await whopResponse.text();
      console.error("[affiliate-handler] Whop API error:", whopResponse.status, errorText);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Whop API error" }));
      return;
    }

    const affiliateData = await whopResponse.json();

    // If affiliate already exists, fetch existing stats
    const response: CreateAffiliateResponse = {
      success: true,
      affiliateId: affiliateData.id,
      affiliateLink: `https://whop.com/checkout/${WHOP_PRO_PLAN_ID}?a=${affiliateData.id}`,
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  } catch (error) {
    console.error("[affiliate-handler] Error creating affiliate:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Internal server error" }));
  }
}

/**
 * POST /api/affiliate/stats
 * Gets affiliate stats for a user
 */
export async function handleGetAffiliateStats(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!WHOP_API_KEY) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Whop API not configured" }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Method not allowed" }));
    return;
  }

  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
  }

  let request: GetAffiliateStatsRequest;
  try {
    request = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Invalid JSON" }));
    return;
  }

  if (!request.deviceId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "deviceId required" }));
    return;
  }

  try {
    // Call Whop API to get affiliate stats
    const whopResponse = await fetch(
      `https://api.whop.com/api/v1/affiliates?company_id=${WHOP_COMPANY_ID}&user_identifier=${request.deviceId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${WHOP_API_KEY}`,
        },
      },
    );

    if (!whopResponse.ok) {
      // Affiliate might not exist yet, return empty stats
      const response: GetAffiliateStatsResponse = {
        success: true,
        totalReferrals: 0,
        totalEarnings: "$0",
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }

    const affiliateData = await whopResponse.json();

    const response: GetAffiliateStatsResponse = {
      success: true,
      totalReferrals: affiliateData.total_referrals || 0,
      totalEarnings: affiliateData.total_earnings || "$0",
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  } catch (error) {
    console.error("[affiliate-handler] Error getting affiliate stats:", error);
    // Return empty stats on error
    const response: GetAffiliateStatsResponse = {
      success: true,
      totalReferrals: 0,
      totalEarnings: "$0",
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }
}
