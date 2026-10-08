# Whop.com Integration Guide

This guide explains how to integrate BookmarkForge with Whop.com for license management and payments.

## Overview

Whop.com provides:
- **License Key Management**: Generate and validate software license keys
- **Lifetime Access**: One-time purchase for perpetual Pro access
- **Free Trial**: 7-day Pro trial for new users
- **Access Control**: Validate user access to premium features
- **Membership API**: Server-side reconciliation of license and trial state

## Prerequisites

1. **Whop Account**: Create an account at https://whop.com
2. **Product Setup**: Create a product for BookmarkForge Pro
3. **API Key**: Generate an account API key

## Setup Steps

### 1. Create Whop Account

1. Go to https://whop.com and sign up
2. Complete your business profile
3. Verify your email address

### 2. Create Product

1. Navigate to **Products** in Whop Dashboard
2. Click **Create Product**
3. Fill in product details:
   - **Name**: BookmarkForge Pro
   - **Description**: Advanced AI-powered knowledge vault with lifetime access
   - **Software Licensing**: Enable (for license key generation)
4. Save the product ID (starts with `prod_`)

### 3. Create Plans

Create a single **Lifetime Plan** for your product:

1. In your product, click **Create Plan**
2. Configure:
   - **Name**: LIFETIME
   - **Price**: $59 (Early Bird — first 200 licenses) → $79 regular
   - **Billing Cycle**: One-time (lifetime access — no recurring billing)
   - **Trial**: Enable 7-day free trial (new users get Pro features for 7 days)
3. Save the plan ID (starts with `plan_`)

### 4. Configure Trial Behavior (Optional but Recommended)

The trial system automatically:
- Grants Pro access for `WHOP_TRIAL_DURATION_DAYS` (default: 7 days) after purchase
- Automatically downgrades the user to Free tier after the trial period
- Preserves user data (vault, bookmarks, notes) across the trial-to-free transition
- Reconciles the downgrade on the next validation call (see §6)

### 5. Generate API Key

1. Navigate to **Developer → API Keys**
2. In **Account API Keys**, click **Create**
3. Configure:
   - **Name**: BookmarkForge API
   - **Permissions**: Read Memberships, Write Memberships, Read Users
4. Copy the API key (starts with `whop_`)
5. **IMPORTANT**: Never commit this key to git!

### 6. Membership Reconciliation (no webhook endpoint)

**BookmarkForge does not expose a Whop webhook endpoint.** There is no inbound
route to configure, and nothing in the companion server listens for membership
events. Membership and trial state are reconciled on the **pull** side: the
server calls Whop's REST memberships endpoint whenever a license is activated
or validated, so `membership.created`, `membership.updated` and
`membership.cancelled` are observed at the next validation rather than pushed.

If a webhook is ever added, it must be declared in `server/src/route-table.ts`
as a `RoutePolicy`. `npm run check:documented-doc-references` fails on any
document naming a concrete API route the server does not dispatch, so the docs
and the route table cannot drift apart silently.

### 7. Environment Variables

Copy the example file:

```bash
cp .env.whop.example .env
```

Edit `.env` with your values:

```env
# Whop Account API Key (Server-side only - never expose to client)
WHOP_API_KEY=whop_xxxxxxxxxxxxxx

# Whop Product ID for BookmarkForge Pro
WHOP_PRODUCT_ID=prod_xxxxxxxxxxxxxx

# Whop Plan ID for BookmarkForge Pro LIFETIME
# Get this from: Whop Dashboard → Products → BookmarkForge Pro → Plans
WHOP_PLAN_LIFETIME=plan_xxxxxxxxxxxxxx

# Whop Trial Duration (days) — new users get Pro features for this many days
WHOP_TRIAL_DURATION_DAYS=7

# Whop Trial Price — 0 for free trial
WHOP_TRIAL_PRICE=0

# Whop Webhook Secret — reserved, UNUSED: no webhook endpoint is served.
# Kept only so an existing .env does not break. See §6.
WHOP_WEBHOOK_SECRET=

# Environment
WHOP_ENVIRONMENT=development
```

## Integration Code

### Service Configuration

The `WhopService.ts` file provides:

```typescript
import { validateAccess, validateLicenseKey, getUserMemberships, getTrialStatus } from "../services/WhopService";

// Validate user access to Pro features (checks lifetime status + trial)
const validation = await validateAccess(whopUserId, productId);
if (validation.has_access) {
  // Grant access to Pro features
}

// Validate a license key
const licenseValidation = await validateLicenseKey(licenseKey, productId);
if (licenseValidation.has_access) {
  // Activate Pro features
}

// Get user's memberships
const memberships = await getUserMemberships(whopUserId);

// NEW: Check trial status
const trial = await getTrialStatus(whopUserId);
if (trial.is_in_trial && trial.days_remaining > 0) {
  // Grant Pro access during trial period
  // Show trial expiry UI
}
```

### Access Control in Components

```typescript
import { validateAccess, getTrialStatus } from "../services/WhopService";

function ProFeature({ userId }: { userId: string }) {
  const [hasAccess, setHasAccess] = useState(false);
  const [trialInfo, setTrialInfo] = useState({
    is_in_trial: false,
    days_remaining: 0,
  });

  useEffect(() => {
    // Check lifetime access
    validateAccess(userId, process.env.WHOP_PRODUCT_ID!)
      .then(result => setHasAccess(result.has_access));
    
    // Check trial status
    getTrialStatus(userId).then(result => {
      setTrialInfo({
        is_in_trial: result.is_in_trial,
        days_remaining: result.days_remaining,
      });
    });
  }, [userId]);

  if (hasAccess || trialInfo.is_in_trial) {
    // If in trial, show days remaining
    if (trialInfo.is_in_trial && trialInfo.days_remaining > 0) {
      return (
        <ProFeatureContent trialDaysRemaining={trialInfo.days_remaining} />
      );
    }
    return <ProFeatureContent />;
  }

  return <UpgradePrompt />;
}
```

### License Key Input

```typescript
import { validateLicenseKey, isLifetimeLicense } from "../services/WhopService";

function LicenseKeyInput() {
  const [licenseKey, setLicenseKey] = useState("");
  const [isValid, setIsValid] = useState(false);
  const [isLifetime, setIsLifetime] = useState(false);

  const handleValidate = async () => {
    const result = await validateLicenseKey(
      licenseKey,
      process.env.WHOP_PRODUCT_ID!
    );
    setIsValid(result.has_access);
    setIsLifetime(isLifetimeLicense(result));
  };

  return (
    <div>
      <input
        value={licenseKey}
        onChange={(e) => setLicenseKey(e.target.value)}
        placeholder="Enter your license key"
      />
      <button onClick={handleValidate}>Validate</button>
      {isValid && (
        <span>
          {isLifetime ? "✓ Valid lifetime license" : "✓ Valid Pro license"}
        </span>
      )}
    </div>
  );
}
```

## Trial System Details

### How the 7-Day Trial Works

1. **Activation**: When a user purchases the LIFETIME plan, if they are a new user (no prior Whop membership), they automatically enter the trial period.
2. **Trial Period**: The user gets Pro features for exactly `WHOP_TRIAL_DURATION_DAYS` (7 days) from the purchase date.
3. **Trial Expiry**: On day 8 (after 7 days), the system automatically:
   - Downgrades the user to Free tier
   - Revokes Pro feature access
   - Preserves all user data (vault, bookmarks, notes)
   - Reconciles the downgrade on the next license validation
4. **Re-trials**: Whop's native system does not allow re-trials for the same user. If a user who already used a trial purchases again, they get lifetime access immediately.

### Membership State the Server Reads

These are the Whop membership fields the server reads during reconciliation.
There is no inbound handler: the values below are the RESPONSE to the
activation/validation calls described in the "Integration Code" section.

| Field | Meaning |
|-------|---------|
| `membership.status` | Active/cancelled state. Anything but an active status denies Pro. |
| `membership.expires_at` | Trial or plan expiry; a past value downgrades to Free. |
| `metadata` | Device-binding payload the server writes on activation. |
| `license.expires_at` | Legacy provider field, read when `membership.expires_at` is absent. |

### Anti-Fraud Measures

The system includes protections against common circumvention techniques:

1. **Date Change Detection**: The trial clock runs on Whop's servers (not the client), so changing the PC clock does NOT extend the trial.

2. **Device Binding**: Each license is bound to the user's device via Whop's native binding mechanism. Moving the license to a different device requires re-verification.

3. **Browser Storage Fingerprint**: The trial start time is fingerprinted at installation. Clearing browser data may reset the trial, but Whop tracks the original installation.

4. **IP & Account Tracking**: Whop tracks the account's purchase history. Users who abuse free trials across multiple accounts may be flagged.

5. **Grace Period on Data Loss**: If a user's trial expires and they lose access, their vault data is preserved. They can re-enter Pro by purchasing another lifetime license or by valid license key activation.

## Penetration Testing

- **Monthly DAST**: `.github/workflows/pen-test.yml` runs OWASP ZAP against staging
- **Pre-production penetration test**: `node scripts/penetration-test.mjs --target <url> --scope full`
- **Reports**: Written to `pen-test-reports/` with JSON and Markdown formats
- **Gate**: All CRITICAL and HIGH findings must be remediated before production deployment

## Security Champions Program

See `.github/SECURITY_CHAMPIONS.md` for the full program documentation, including:
- Checklist per change type
- Incident response scale (P0–P3 with SLAs)
- Quarterly penetration testing requirements

---

## Checkout URL

Configure the checkout link in your environment:

```env
VITE_WHOP_CHECKOUT_URL=https://bookmarkforgeapp.com/checkout
```

Users can purchase BookmarkForge Pro Lifetime at: https://bookmarkforgeapp.com/checkout

---

## Acknowledgments

Special thanks to the community for testing the trial flow and providing feedback on the user experience.