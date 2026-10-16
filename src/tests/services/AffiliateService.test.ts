/**
 * The referral API is called SAME-ORIGIN by default and reports failures
 * honestly. Both properties were broken before this suite existed:
 *
 *   - the client posted to a `VITE_COMPANION_URL` (or `http://localhost:8787`)
 *     origin that the shipped CSP `connect-src 'self'` blocks, and
 *   - a failed request was converted into `{ totalReferrals: 0,
 *     totalEarnings: "$0" }`, which is indistinguishable from a real zero and
 *     hid outages from the user.
 *
 * `firewalledFetch` is mocked rather than global fetch so the suite also pins
 * that the referral call goes THROUGH the user's network firewall.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetch, mockEnv } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockEnv: { companionUrl: undefined as string | undefined },
}));

// Partial mock: the shared test setup imports `setFirewallDisabled` from this
// module, so only the fetch shim is replaced.
vi.mock("../../utils/networkFirewall", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../utils/networkFirewall")>();
  return { ...actual, firewalledFetch: mockFetch };
});
// Partial mock: sibling modules (e.g. the network firewall) import the env
// parsers from here, so only the resolved registry object is swapped.
vi.mock("../../env.config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../env.config")>();
  return { ...actual, env: mockEnv as unknown as typeof actual.env };
});

import {
  createProAffiliate,
  getAffiliateStats,
  sanitizeAffiliateLink,
} from "../../services/AffiliateService";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const DEVICE_ID = "3f1a1f6e-6a1e-4d1e-9a1e-1b2c3d4e5f60";

describe("AffiliateService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.companionUrl = undefined;
  });

  it("calls /api/affiliate on the app origin by default", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ success: true, totalReferrals: 0, totalEarnings: "$0" }),
    );

    await getAffiliateStats(DEVICE_ID);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/affiliate/stats",
      expect.objectContaining({ method: "POST" }),
      "AffiliateService",
    );
  });

  it("honours an explicit companion origin as the base", async () => {
    mockEnv.companionUrl = "https://signal.example.com/";
    mockFetch.mockResolvedValue(jsonResponse({ success: true }));

    await getAffiliateStats(DEVICE_ID);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://signal.example.com/api/affiliate/stats",
      expect.objectContaining({ method: "POST" }),
      "AffiliateService",
    );
  });

  it("returns the counters and the server-provided share link", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        success: true,
        totalReferrals: 7,
        totalEarnings: "$392",
        affiliateId: "aff_123",
        affiliateLink: "https://whop.com/checkout/plan_abc?a=aff_123",
      }),
    );

    const result = await getAffiliateStats(DEVICE_ID);

    expect(result).toEqual({
      ok: true,
      data: {
        totalReferrals: 7,
        totalEarnings: "$392",
        affiliateId: "aff_123",
        referralLink: "https://whop.com/checkout/plan_abc?a=aff_123",
      },
    });
  });

  it("reports a provider failure instead of inventing zero counters", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ success: false, error: "Whop API error" }, 502),
    );

    const result = await getAffiliateStats(DEVICE_ID);

    expect(result).toEqual({ ok: false, error: "server" });
  });

  it("maps a deployment without a Whop credential to not_configured", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ success: false, error: "Whop API not configured" }, 503),
    );

    await expect(getAffiliateStats(DEVICE_ID)).resolves.toEqual({
      ok: false,
      error: "not_configured",
    });
  });

  it("reports a firewall-blocked or offline request as a network failure", async () => {
    mockFetch.mockRejectedValue(new Error("Origin not whitelisted"));

    await expect(createProAffiliate(DEVICE_ID)).resolves.toEqual({
      ok: false,
      error: "network",
    });
  });

  it("refuses a malformed device id without issuing a request", async () => {
    await expect(getAffiliateStats("bad\u0000id")).resolves.toEqual({
      ok: false,
      error: "invalid_device_id",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("provisions the affiliate record and exposes its link", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        success: true,
        affiliateId: "aff_9",
        affiliateLink: "https://whop.com/checkout/plan_abc?a=aff_9",
      }),
    );

    await expect(createProAffiliate(DEVICE_ID)).resolves.toEqual({
      ok: true,
      data: {
        affiliateId: "aff_9",
        referralLink: "https://whop.com/checkout/plan_abc?a=aff_9",
      },
    });
  });

  it("drops a share link that is not an https whop.com URL", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        success: true,
        affiliateId: "aff_1",
        affiliateLink: "https://evil.example/checkout?a=aff_1",
      }),
    );

    const result = await getAffiliateStats(DEVICE_ID);

    expect(result.ok && result.data.referralLink).toBeNull();
  });

  describe("sanitizeAffiliateLink", () => {
    it("accepts whop.com checkout links", () => {
      expect(sanitizeAffiliateLink("https://whop.com/checkout/plan_a?a=1")).toBe(
        "https://whop.com/checkout/plan_a?a=1",
      );
    });

    it("rejects another host, a non-https scheme and embedded credentials", () => {
      expect(sanitizeAffiliateLink("https://evil.example/x")).toBeNull();
      expect(sanitizeAffiliateLink("http://whop.com/checkout/plan_a")).toBeNull();
      expect(sanitizeAffiliateLink("javascript:alert(1)")).toBeNull();
      expect(sanitizeAffiliateLink("https://user:pw@whop.com/checkout")).toBeNull();
      expect(sanitizeAffiliateLink(undefined)).toBeNull();
    });

    it("rejects a look-alike host that merely contains whop.com", () => {
      expect(sanitizeAffiliateLink("https://whop.com.evil.example/x")).toBeNull();
    });
  });
});
