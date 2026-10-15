/**
 * Affiliate Service - Creates Whop affiliate records for Pro users
 * 
 * This service automatically creates affiliate records when users activate Pro,
 * configures their commission rate to 50% (member rate), and provides their
 * unique affiliate link.
 * 
 * Environment variables required:
 * - VITE_WHOP_API_KEY: Whop API key with affiliate:create permission
 * - VITE_WHOP_COMPANY_ID: Your Whop company ID (biz_xxxxxxxxxxxxx)
 * - VITE_WHOP_PRO_PLAN_ID: Pro plan ID for commission override
 */

interface AffiliateRecord {
  id: string;
  company_id: string;
  user_id: string;
  status: 'active' | 'archived' | 'deleted';
  total_referrals_count: number;
  total_referral_earnings_usd: string;
  total_revenue_usd: string;
  customer_retention_rate: number;
  created_at: string;
}

interface AffiliateOverride {
  id: string;
  affiliate_id: string;
  override_type: 'standard' | 'rev_share';
  commission_type: 'percentage' | 'flat_fee';
  commission_value: number;
  plan_id?: string;
  applies_to_payments?: 'first_payment' | 'all_payments';
  applies_to_products?: string;
  product_direct_link?: string;
  checkout_direct_link?: string;
  total_referral_earnings_usd: string;
}

const WHOP_API_BASE = 'https://api.whop.com/api/v1';

/**
 * Create an affiliate record for a user
 */
async function createAffiliate(userIdentifier: string): Promise<AffiliateRecord> {
  const apiKey = import.meta.env.VITE_WHOP_API_KEY;
  const companyId = import.meta.env.VITE_WHOP_COMPANY_ID;

  if (!apiKey || !companyId) {
    throw new Error('Missing VITE_WHOP_API_KEY or VITE_WHOP_COMPANY_ID environment variables');
  }

  const response = await fetch(`${WHOP_API_BASE}/affiliates`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      account_id: companyId,
      user_identifier: userIdentifier,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create affiliate: ${error}`);
  }

  return response.json();
}

/**
 * Create a commission override for an affiliate
 */
async function createAffiliateOverride(
  affiliateId: string,
  planId: string,
  commissionRate: number = 50,
  appliesToPayments: 'first_payment' | 'all_payments' = 'first_payment'
): Promise<AffiliateOverride> {
  const apiKey = import.meta.env.VITE_WHOP_API_KEY;

  if (!apiKey) {
    throw new Error('Missing VITE_WHOP_API_KEY environment variable');
  }

  const response = await fetch(`${WHOP_API_BASE}/affiliates/${affiliateId}/overrides`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: affiliateId,
      override_type: 'standard',
      commission_type: 'percentage',
      commission_value: commissionRate,
      plan_id: planId,
      applies_to_payments: appliesToPayments,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create affiliate override: ${error}`);
  }

  return response.json();
}

/**
 * Get affiliate information for a user
 */
async function getAffiliate(userIdentifier: string): Promise<AffiliateRecord | null> {
  const apiKey = import.meta.env.VITE_WHOP_API_KEY;
  const companyId = import.meta.env.VITE_WHOP_COMPANY_ID;

  if (!apiKey || !companyId) {
    return null;
  }

  try {
    const response = await fetch(
      `${WHOP_API_BASE}/affiliates?account_id=${companyId}&user_identifier=${userIdentifier}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data.data && data.data.length > 0) {
      return data.data[0];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create or get affiliate for a Pro user
 * Returns the affiliate record with their unique links
 */
export async function createProAffiliate(
  userEmail: string,
  userId?: string
): Promise<{
  affiliate: AffiliateRecord;
  override?: AffiliateOverride;
  affiliateLink?: string;
}> {
  // Check if affiliate already exists
  const existing = await getAffiliate(userEmail);
  if (existing) {
    return { affiliate: existing };
  }

  // Create new affiliate
  const affiliate = await createAffiliate(userEmail);

  // Configure 50% commission for Pro members
  const proPlanId = import.meta.env.VITE_WHOP_PRO_PLAN_ID;
  if (proPlanId) {
    try {
      const override = await createAffiliateOverride(
        affiliate.id,
        proPlanId,
        50, // 50% for members
        'first_payment'
      );
      return {
        affiliate,
        override,
        affiliateLink: override.checkout_direct_link,
      };
    } catch (error) {
      console.warn('Failed to create affiliate override:', error);
      // Return affiliate without override
      return { affiliate };
    }
  }

  return { affiliate };
}

/**
 * Get affiliate stats for a user
 */
export async function getAffiliateStats(userIdentifier: string) {
  const affiliate = await getAffiliate(userIdentifier);
  if (!affiliate) {
    return null;
  }

  return {
    totalReferrals: affiliate.total_referrals_count,
    totalEarnings: affiliate.total_referral_earnings_usd,
    totalRevenue: affiliate.total_revenue_usd,
    retentionRate: affiliate.customer_retention_rate,
    status: affiliate.status,
  };
}
