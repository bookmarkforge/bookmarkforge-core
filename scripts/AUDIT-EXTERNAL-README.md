# External Services Audit Scripts

**Purpose**: Automated verification of Vercel, Whop, and GitHub configurations using local CLI tools
**Security**: Scripts run locally using YOUR credentials - no data is shared with external services

---

## 🚀 Quick Start

### Run All Audits (Recommended)
```bash
npm run audit:external
```

This runs:
1. Vercel configuration audit
2. Whop configuration audit
3. GitHub secrets audit

---

## 📋 Individual Scripts

### 1. Vercel Audit
```bash
npm run audit:vercel
```

**Prerequisites**:
- Vercel CLI installed: `npm i -g vercel`
- Logged in to Vercel: `vercel login`

**What it checks**:
- Project configuration
- Environment variables
- Domains
- Recent deployments

**Security**: Uses your local Vercel CLI session - no credentials shared

---

### 2. Whop Audit
```bash
npm run audit:whop
```

**Prerequisites**:
- WHOP_API_KEY in environment or .env.local

**Setup**:
```bash
# Option 1: Environment variable
export WHOP_API_KEY=your_key_here

# Option 2: .env.local file
echo "WHOP_API_KEY=your_key_here" > .env.local
```

**What it checks**:
- Whop service validation
- Whop integration tests
- API key format and validity

**Security**: Key stays in your local environment - never shared

---

### 3. GitHub Secrets Audit
```bash
npm run audit:github-secrets
```

**Prerequisites**:
- GitHub CLI installed: https://cli.github.com/
- Logged in to GitHub: `gh auth login`

**What it checks**:
- Repository information
- Secret names
- Variable names
- Whether required secrets are set

**Security**: Uses your local GitHub CLI session - no credentials shared

---

## 🔒 Security Model

### How It Works

1. **Local Execution**: Scripts run on YOUR machine
2. **CLI Tools**: Use official CLI tools (Vercel CLI, GitHub CLI)
3. **Your Credentials**: Scripts use YOUR local authentication sessions
4. **No Sharing**: Credentials never leave your machine

### What It Does NOT Do

- ❌ Does NOT connect to Vercel/Whop/GitHub APIs directly
- ❌ Does NOT send credentials to external servers
- ❌ Does NOT store or log credentials
- ❌ Does NOT share credentials with AI

### Credential Safety

Your credentials are safe because:
- Scripts use environment variables or CLI sessions
- Credentials never leave your local machine
- Scripts are read-only (verify configuration, don't modify)
- You can revoke CLI sessions at any time

---

## 📊 Output Example

```
🚀 Starting Comprehensive External Services Audit...
📦 This script audits Vercel, Whop, and GitHub configurations locally

======================================================================
PHASE 1: VERCEL AUDIT
======================================================================

🔧 Vercel configuration audit...
✅ Vercel configuration audit completed

======================================================================
PHASE 2: WHOP AUDIT
======================================================================

🔧 Whop configuration audit...
✅ Whop configuration audit completed

======================================================================
PHASE 3: GITHUB SECRETS AUDIT
======================================================================

🔧 GitHub secrets audit...
✅ GitHub secrets audit completed

======================================================================
📊 OVERALL EXTERNAL SERVICES AUDIT SUMMARY
======================================================================

Vercel: ✅ PASSED
Whop: ✅ PASSED
GitHub Secrets: ✅ PASSED

✅ ALL EXTERNAL SERVICES AUDITS PASSED
```

---

## 🛠️ Troubleshooting

### Vercel CLI Not Found
```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login
```

### GitHub CLI Not Found
```bash
# Install GitHub CLI
# Visit: https://cli.github.com/

# Login
gh auth login
```

### WHOP_API_KEY Not Found
```bash
# Set environment variable
export WHOP_API_KEY=your_key_here

# Or create .env.local
echo "WHOP_API_KEY=your_key_here" > .env.local
```

### Permission Denied
```bash
# Make scripts executable (Linux/Mac)
chmod +x scripts/audit-*.mjs
```

---

## 📝 Manual Verification Still Required

These scripts verify configuration but CANNOT replace manual dashboard checks:

### Still Need to Verify Manually:

**Vercel Dashboard**:
- [ ] No real secrets in VITE_* variables
- [ ] CSP header is configured (or documented)
- [ ] SSL certificate is valid
- [ ] Domain is pointing correctly

**Whop Dashboard**:
- [ ] Product "BookmarkForge Pro" exists and is active
- [ ] LIFETIME plan is configured correctly
- [ ] Software Licensing is enabled
- [ ] No suspicious orders

**GitHub Settings**:
- [ ] Secret values are correct (not just names)
- [ ] Branch protection is configured
- [ ] CI/CD workflows are enabled

Use the detailed checklist: `docs/EXTERNAL-SERVICES-AUDIT-CHECKLIST.md`

---

## 🎯 When to Run

### Before Production Launch
- Run `npm run audit:external` to verify all services
- Review output for any failures
- Complete manual checklist items
- Fix any issues before launch

### After Configuration Changes
- Run specific audit after changing Vercel config: `npm run audit:vercel`
- Run specific audit after adding secrets: `npm run audit:github-secrets`
- Run specific audit after changing Whop setup: `npm run audit:whop`

### Regular Maintenance
- Run weekly before major changes
- Run after adding new environment variables
- Run after connecting new services

---

## 📚 Related Documentation

- `docs/EXTERNAL-SERVICES-AUDIT-CHECKLIST.md` - Detailed manual checklist
- `docs/WHOP-INTEGRATION.md` - Whop integration guide
- `docs/GITHUB-SECRETS.md` - GitHub secrets documentation
- `vercel.json` - Vercel configuration
- `.env.production.example` - Environment variables reference

---

## 🔍 Script Details

### audit-vercel-config.mjs
- Uses: Vercel CLI
- Commands: `vercel inspect`, `vercel env ls`, `vercel domains ls`, `vercel ls`
- Read-only: Only verifies configuration, doesn't modify

### audit-whop-config.mjs
- Uses: WHOP_API_KEY from environment
- Commands: `npm run whop:validate`, `npm run whop:test`
- Read-only: Only validates integration, doesn't modify Whop

### audit-github-secrets.mjs
- Uses: GitHub CLI
- Commands: `gh repo view`, `gh secret list`, `gh variable list`
- Read-only: Only lists secrets/variables, doesn't modify

### audit-all-external.mjs
- Uses: All three scripts above
- Purpose: Master script for comprehensive audit
- Output: Combined summary of all audits

---

## ✅ Verification

To verify scripts work correctly:

```bash
# Test Vercel audit
npm run audit:vercel

# Test Whop audit (requires WHOP_API_KEY)
npm run audit:whop

# Test GitHub audit (requires gh auth login)
npm run audit:github-secrets

# Test all audits
npm run audit:external
```

---

**Last Updated**: 2026-10-02
**Version**: 1.0.0
