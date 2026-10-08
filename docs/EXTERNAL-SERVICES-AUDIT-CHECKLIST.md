# External Services Audit Checklist

> Purpose: Manual verification checklist for Vercel and Whop accounts
> Based on local configuration review on 2026-10-02
> Dashboard items cannot be automated — they require manual verification in
> dashboards; the CLI-assisted audits below cover the configuration side of
> each section. Run the three per-service audits in one pass with
> `npm run audit:external`.

---

## 🔴 CRITICAL: Must Complete Before Production

### Vercel Dashboard Verification

**Access**: https://vercel.com/[your-username]/bookmarkforge

**CLI-assisted audit:** `npm run audit:vercel` (requires the Vercel CLI
installed and `vercel login`; verifies project configuration locally without
sharing credentials). Run it first — it narrows what must be eyeballed below.

#### 1. Project Connection
- [ ] Repository is connected to correct GitHub repo
- [ ] Branch protection is configured (main branch only)
- [ ] Automatic deployments are enabled for main branch
- [ ] Preview deployments are enabled for PRs

#### 2. Environment Variables
**Access**: Settings → Environment Variables

⚠️ **CRITICAL SECURITY CHECK**:
- [ ] NO real secrets in VITE_* variables (VITE_* are inlined in bundle)
- [ ] WHOP_API_KEY is set correctly
- [ ] LICENSE_SIGNING_PRIVATE_KEY_PKCS8 is set (if using Vercel Functions)
- [ ] VITE_BUILD_ENV = "production"
- [ ] VITE_APP_VERSION = "1.0.0"
- [ ] VITE_P2P_SIGNALING_URL = "wss://signal.bookmarkforgeapp.com"
- [ ] AI_SESSION_ORIGINS = "https://bookmarkforgeapp.com"
- [ ] ENFORCE_SIGNAL_HMAC = "1"

#### 3. Domain Configuration
**Access**: Settings → Domains

- [ ] bookmarkforgeapp.com is added
- [ ] www.bookmarkforgeapp.com is added (if using www)
- [ ] DNS is configured correctly (A record or CNAME)
- [ ] SSL certificate is active and auto-renewing
- [ ] Domain is the primary domain (not preview)

#### 4. Build Configuration
**Access**: Settings → General

- [ ] Framework: Vite (detected automatically)
- [ ] Build Command: `npm run build`
- [ ] Output Directory: `dist`
- [ ] Install Command: `npm install`
- [ ] Node.js Version: >=24.17.0

#### 5. Security Headers
**Access**: Settings → Headers

Current headers in vercel.json:
- ✅ X-Content-Type-Options: nosniff
- ✅ X-Frame-Options: DENY
- ✅ X-XSS-Protection: 1; mode=block
- ✅ Referrer-Policy: strict-origin-when-cross-origin
- ✅ Permissions-Policy: geolocation=(), microphone=(), camera=()

**Missing in vercel.json** (verify if using nginx/Netlify for CSP):
- [ ] Content-Security-Policy header is configured (or documented why not)
- [ ] Strict-Transport-Security (HSTS) is configured
- [ ] X-Content-Security-Policy is configured

#### 6. Deployment History
**Access**: Deployments

- [ ] Latest deployment is successful
- [ ] Build time is acceptable (<5 minutes)
- [ ] No failed deployments in last 24 hours
- [ ] Production deployment is green

---

### Whop Dashboard Verification

**Access**: https://whop.com/dashboard

**CLI-assisted audit:** `npm run audit:whop` (requires `WHOP_API_KEY` in the
environment or `.env.local`; fails closed with instructions when absent).

#### 1. Account Setup
- [ ] Business profile is complete
- [ ] Identity verification is complete
- [ ] Email is verified
- [ ] Bank account/Payout method is configured (for receiving payments)

#### 2. Product Configuration
**Access**: Products → BookmarkForge Pro

- [ ] Product exists with correct name: "BookmarkForge Pro"
- [ ] Description is accurate
- [ ] Software Licensing is ENABLED
- [ ] Product ID is noted: `prod_xxxxx`
- [ ] Product is ACTIVE (not draft/archived)

#### 3. Plan Configuration
**Access**: Products → BookmarkForge Pro → Plans

- [ ] Plan "LIFETIME" exists
- [ ] Price is correct: $59 (Early Bird) or $79 (regular)
- [ ] Billing Cycle: One-time (lifetime access)
- [ ] 7-day free trial is ENABLED (if desired)
- [ ] Plan ID is noted: `plan_xxxxx`
- [ ] Plan is ACTIVE

#### 4. API Keys
**Access**: Settings → API Keys

- [ ] Account API key is generated
- [ ] API key is active
- [ ] API key is copied to GitHub Secrets (WHOP_API_KEY)
- [ ] API key has appropriate permissions

#### 5. Webhooks (If Configured)
**Access**: Products → BookmarkForge Pro → Webhooks

- [ ] Webhook URL is configured (if using)
- [ ] Webhook is active
- [ ] Webhook secret is set (if using)
- [ ] Webhook is tested and working

#### 6. Orders
**Access**: Orders

- [ ] No suspicious orders (test with your own account first)
- [ ] Refund policy is clear in product description
- [ ] Order emails are configured

---

## 🟡 IMPORTANT: Should Complete Before Production

### GitHub Secrets Verification

**Access**: GitHub → [your-repo] → Settings → Secrets and variables → Actions

**CLI-assisted audit:** `npm run audit:github-secrets` (requires the `gh` CLI
installed and logged in; lists missing secrets/variables for the workflows).

#### Critical Secrets
- [ ] WHOP_API_KEY is set
- [ ] WHOP_LICENSE_API_URL is set (https://api.whop.com)
- [ ] LICENSE_SIGNING_PRIVATE_KEY_PKCS8 is set (if not using Docker)
- [ ] STAGING_URL is set (if using staging)
- [ ] STAGING_ANALYTICS_ADMIN_TOKEN is set
- [ ] STAGING_SMOKE_TOKEN is set
- [ ] STAGING_SMOKE_ADMIN_TOKEN is set

#### Security Secrets
- [ ] STAGING_DAST_CONTEXT_B64 is set (if doing DAST)
- [ ] STAGING_DAST_CONTEXT_PASSWORD is set (if doing DAST)
- [ ] SLACK_WEBHOOK_URL is set (if using Slack alerts)
- [ ] CSP_REPORT_ADMIN_TOKEN is set
- [ ] SIGNALING_ADMIN_TOKEN is set
- [ ] SIGNALING_IP_HASH_SALT is set

#### Analytics Secrets
- [ ] ANALYTICS_ADMIN_TOKEN is set
- [ ] ANALYTICS_ALERT_WEBHOOK_URL is set (if using)
- [ ] KPI_MIN_DAU is set
- [ ] KPI_MIN_WAU is set
- [ ] KPI_MIN_MAU is set
- [ ] KPI_MIN_D7_PCT is set
- [ ] KPI_MIN_D30_PCT is set

#### Optional Secrets
- [ ] VITE_SENTRY_DSN is set (if using Sentry)
- [ ] DOCKER_REGISTRY_PASSWORD is set (if using Docker registry)
- [ ] GITHUB_TOKEN_PAT is set (if needed for git operations)

---

### Environment Variables Verification

**Access**: GitHub → [your-repo] → Settings → Secrets and variables → Variables

- [ ] NODE_ENV = "production"
- [ ] VITE_APP_VERSION = "1.0.0"
- [ ] VITE_DB_NAME = "bookmarkforge_prod"
- [ ] VITE_P2P_SIGNALING_URL = "wss://signal.bookmarkforgeapp.com"
- [ ] VITE_WHOP_CHECKOUT_URL = "https://bookmarkforgeapp.com/checkout"
- [ ] AI_SESSION_ORIGINS = "https://bookmarkforgeapp.com"
- [ ] ENFORCE_SIGNAL_HMAC = "1"
- [ ] TRUST_PROXY = "1"
- [ ] HOST = "0.0.0.0"
- [ ] PORT = "8787"
- [ ] HTTP_PORT = "8080"
- [ ] PRODUCTION_URL = "https://bookmarkforgeapp.com"

---

## 🔵 OPTIONAL: Nice to Have

### Vercel Analytics
- [ ] Analytics is enabled
- [ ] Web Vitals tracking is enabled
- [ ] Custom events are configured (if desired)

### Monitoring
- [ ] Sentry is configured (VITE_SENTRY_DSN)
- [ ] Error tracking is tested
- [ ] Performance monitoring is enabled

### Backup Strategy
- [ ] Database backups are configured (if using server)
- [ ] Backup retention policy is set
- [ ] Backup restoration is tested

---

## 🚨 Security Verification

### Access Control
- [ ] Only you have admin access to Vercel
- [ ] Only you have admin access to Whop
- [ ] 2FA is enabled on Vercel account
- [ ] 2FA is enabled on Whop account
- [ ] 2FA is enabled on GitHub account

### Secret Rotation
- [ ] Plan for rotating WHOP_API_KEY (quarterly)
- [ ] Plan for rotating license signing key (annually)
- [ ] Plan for rotating signing keys after compromise

### Audit Trail
- [ ] Deployment logs are reviewed weekly
- [ ] Access logs are reviewed weekly
- [ ] Order logs are reviewed weekly

---

## 📊 Testing External Integrations

### Test Whop Integration
```bash
# Test Whop service validation
npm run whop:validate

# Test Whop service tests
npm run whop:test
```

### Test Vercel Deployment
```bash
# Deploy to preview
vercel --preview

# Test production build locally
npm run build:ci

# Test staging deployment
npm run check:staging-http
```

---

## ✅ Pre-Launch Verification

### End-to-End Test
1. [ ] Create test purchase on Whop (use discount code if available)
2. [ ] Verify license key is generated
3. [ ] Verify license activation works in app
4. [ ] Verify Pro features unlock
5. [ ] Verify refund flow (test with small amount)
6. [ ] Cancel test purchase and refund

### Domain Verification
1. [ ] https://bookmarkforgeapp.com loads correctly
2. [ ] HTTPS is working with valid certificate
3. [ ] SSL certificate doesn't expire soon (>30 days)
4. [ ] DNS resolves to correct IP
5. [ ] WWW redirects correctly (if configured)

### Performance Verification
1. [ ] Lighthouse score >90 on mobile
2. [ ] Lighthouse score >90 on desktop
3. [ ] First Contentful Paint <2s
4. [ ] Time to Interactive <4s
5. [ ] Bundle size is acceptable (check with npm run check:bundle-size)

---

## 📝 Notes

### CSP Header in Vercel
Current vercel.json does NOT include CSP header. This is intentional if using:
- nginx reverse proxy (docs/nginx-render.mjs)
- Netlify (netlify.toml)
- Custom server with CSP

If deploying ONLY to Vercel without reverse proxy, add CSP to vercel.json headers.

### License Signing Key
The license signing key (Ed25519/RSA-PSS) can be:
- Stored in GitHub Secrets (LICENSE_SIGNING_PRIVATE_KEY_PKCS8)
- Mounted as Docker secret (if using Docker)
- Stored in server filesystem (if using VPS)

Choose ONE method and configure accordingly.

### Whop Webhooks
Webhooks are OPTIONAL for BookmarkForge. The app polls Whop API directly for license validation. Only configure webhooks if you want real-time order updates.

---

## 🎯 Completion Criteria

Consider external services audited when:
- ✅ All CRITICAL items are checked
- ✅ All IMPORTANT items are checked
- ✅ Security measures are in place (2FA, access control)
- ✅ Test purchase flow works end-to-end
- ✅ Domain and SSL are verified
- ✅ GitHub Secrets are configured correctly

---

**Last Updated**: 2026-10-02
**Next Review**: Before production launch
