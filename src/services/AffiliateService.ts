/**
 * Affiliate Service - Creates Whop affiliate records for Pro users
 *
 * This service calls the companion server's affiliate endpoints to create
 * Whop affiliate records. The companion server holds the Whop API key;
 * the client only sends device identifiers.
 *
 * Environment variables required (SERVER-ONLY, not VITE_*):
 * - WHOP_API_KEY: Whop API key with affiliate:create permission
 * - WHOP_COMPANY_ID: Your Whop company ID (biz_xxxxxxxxxxxxx)
 * - WHOP_PRO_PLAN_ID: Pro plan ID for commission override
 */

interface AffiliateStats {
  totalReferrals: number;
  totalEarnings: string;
}

/**
 * Get the companion server URL from environment or default
 */
function getCompanionUrl(): string {
  return import.meta.env.VITE_COMPANION_URL || 'http://localhost:8787';
}

/**
 * Create an affiliate record for a Pro user via companion server
 */
export async function createProAffiliate(
  deviceId: string
): Promise<{
  success: boolean;
  affiliateId?: string;
  affiliateLink?: string;
  error?: string;
}> {
  try {
    const response = await fetch(`${getCompanionUrl()}/api/affiliate/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceId }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.warn('[AffiliateService] Failed to create affiliate:', error);
      return { success: false, error };
    }

    const data = await response.json();
    return {
      success: true,
      affiliateId: data.affiliateId,
      affiliateLink: data.affiliateLink,
    };
  } catch (error) {
    console.warn('[AffiliateService] Error creating affiliate:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Get affiliate stats for a user via companion server
 */
export async function getAffiliateStats(deviceId: string): Promise<AffiliateStats | null> {
  try {
    const response = await fetch(`${getCompanionUrl()}/api/affiliate/stats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceId }),
    });

    if (!response.ok) {
      console.warn('[AffiliateService] Failed to get affiliate stats');
      return null;
    }

    const data = await response.json();
    return {
      totalReferrals: data.totalReferrals || 0,
      totalEarnings: data.totalEarnings || '$0',
    };
  } catch (error) {
    console.warn('[AffiliateService] Error getting affiliate stats:', error);
    return null;
  }
}
