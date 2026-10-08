# Whop Configuration Script

This script automates the configuration of Whop integration for BookmarkForge.

## What This Script Does

- ✅ Validates your Whop API key
- ✅ Retrieves product information from Whop
- ✅ Retrieves plan information from Whop
- ✅ Generates `.env.whop` file with your configuration
- ✅ Tests connection to Whop API

## What This Script CANNOT Do (Manual Steps Required)

The following steps must be done manually in the Whop Dashboard:

- ❌ Create products (manual: Whop Dashboard → Products → Create Product)
- ❌ Create plans (manual: Whop Dashboard → Products → Create Plan)
- ❌ Configure webhooks (manual: Whop Dashboard → Developer → Webhooks)

## Prerequisites

### 1. Create Whop Account

1. Go to https://whop.com and sign up
2. Complete your business profile
3. Verify your email address

### 2. Create Product (Manual)

1. Navigate to **Products** in Whop Dashboard
2. Click **Create Product**
3. Fill in product details:
   - **Name**: BookmarkForge Pro
   - **Description**: Advanced AI-powered knowledge vault with lifetime access
   - **Software Licensing**: Enable (for license key generation)
4. Save the product ID (starts with `prod_`)

### 3. Create LIFETIME Plan (Manual)

1. In your product "BookmarkForge Pro", click **Create Plan**
2. Configure:
   - **Name**: LIFETIME
   - **Price**: $59 (Early Bird) → $79 regular
   - **Billing Cycle**: One-time (lifetime access)
   - **Trial**: Enable 7-day free trial
3. Save the plan ID (starts with `plan_`)

### 4. Generate API Key

1. Navigate to **Developer → API Keys**
2. In **Account API Keys**, click **Create**
3. Configure:
   - **Name**: BookmarkForge API
   - **Permissions**: Read Memberships, Write Memberships, Read Users
4. Copy the API key (starts with `whop_`)

### 5. Configure Webhooks (Optional but Recommended)

1. Navigate to **Developer → Webhooks**
2. Click **Create Webhook**
3. Configure:
   - **URL**: `https://bookmarkforgeapp.com/api/webhook/whop`
   - **Events**: `membership.created`, `membership.updated`, `membership.cancelled`
4. Copy the webhook secret

## Usage

### Step 1: Copy Example File

```bash
cp scripts/whop-config.example.env .env.whop
```

### Step 2: Fill in Your Values

Edit `.env.whop` with your actual Whop credentials:

```env
WHOP_API_KEY=whop_your_actual_api_key_here
WHOP_PRODUCT_ID=prod_your_actual_product_id_here
WHOP_PLAN_LIFETIME=plan_your_actual_plan_id_here
WHOP_WEBHOOK_SECRET=your_actual_webhook_secret_here
```

### Step 3: Run the Script

```bash
node scripts/whop-config.mjs
```

### Step 4: Copy to Production

After the script generates `.env.whop`, copy it to your production environment:

```bash
cp .env.whop .env.production
```

### Step 5: Add to GitHub Secrets (for Deployment)

Add the same values to GitHub Secrets:
- `WHOP_API_KEY`
- `WHOP_PRODUCT_ID`
- `WHOP_PLAN_LIFETIME`
- `WHOP_WEBHOOK_SECRET`

## Script Output

The script will:

1. Test your API key against Whop API
2. Fetch product information (if `WHOP_PRODUCT_ID` is provided)
3. Fetch plan information (if `WHOP_PLAN_LIFETIME` is provided)
4. Generate `.env.whop` file with your configuration
5. Display a summary of the configuration

Example output:

```
🔧 Whop Configuration Script
=================================

📦 API Key: whop_xxxx...xxxx
📦 Product ID: prod_abc123
📦 Plan ID: plan_xyz789
📦 Webhook Secret: Provided

🔍 Testing Whop API key...
✅ API key is valid
   Account: BookmarkForge

📋 Fetching product prod_abc123...
✅ Product found
   Name: BookmarkForge Pro
   ID: prod_abc123

📋 Fetching plan plan_xyz789...
✅ Plan found
   Name: LIFETIME
   ID: plan_xyz789
   Price: $59

✅ Generated .env.whop file at: /path/to/.env.whop

═══════════════════════════════════════════════════════════════
              WHOP CONFIGURATION SUMMARY
═══════════════════════════════════════════════════════════════

API Key:
  ✅ Valid: whop_xxxx...xxxx

Product:
  ✅ Name: BookmarkForge Pro
  ✅ ID: prod_abc123

Plan:
  ✅ Name: LIFETIME
  ✅ ID: plan_xyz789
  ✅ Price: $59

Next Steps:
  1. Copy .env.whop to .env.production
  2. Add the same values to GitHub Secrets (for deployment)
  3. Configure webhooks in Whop Dashboard (optional but recommended)
  4. Test the integration with a test purchase

═══════════════════════════════════════════════════════════════

✅ Whop configuration completed successfully!
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WHOP_API_KEY` | Yes | Your Whop Account API Key |
| `WHOP_PRODUCT_ID` | Yes | Product ID for BookmarkForge Pro |
| `WHOP_PLAN_LIFETIME` | Yes | Plan ID for LIFETIME plan |
| `WHOP_WEBHOOK_SECRET` | No | Webhook secret for verification |

## Security Notes

- ⚠️ **Never commit** `.env.whop` or `.env.production` to git
- ⚠️ **Never expose** `WHOP_API_KEY` to client-side code
- ⚠️ **Store secrets** in GitHub Secrets for deployment
- ⚠️ **Rotate keys** regularly for security

## Troubleshooting

### API Key Validation Failed

- Ensure the API key starts with `whop_`
- Check that the API key has the correct permissions
- Verify the API key is an Account API Key (not a user API key)

### Product Not Found

- Verify the product ID starts with `prod_`
- Ensure the product exists in your Whop Dashboard
- Check that you have access to the product

### Plan Not Found

- Verify the plan ID starts with `plan_`
- Ensure the plan exists under the correct product
- Check that the plan is active

## Integration Testing

After configuration, test the integration:

1. Make a test purchase in Whop Dashboard
2. Validate the license key in your app
3. Verify Pro features are unlocked
4. Test the trial flow (7-day trial)
5. Verify webhooks are received (if configured)

## Documentation

- Full integration guide: `docs/WHOP-INTEGRATION.md`
- Setup runbook: `docs/whop-setup-runbook.md`
- Service implementation: `src/services/WhopService.ts`
