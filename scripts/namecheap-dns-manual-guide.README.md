# Namecheap DNS Manual Configuration Guide

This script provides step-by-step instructions for manual DNS configuration on Namecheap when API access is not available.

## Why use this script?

Namecheap requires one of the following to access their API:
- $50+ account balance
- 20+ domains in your account
- $50+ in purchases in the last 2 years

If you don't meet these requirements, you must configure DNS manually through the Namecheap web interface. This script guides you through the process.

## Usage

### Display configuration guide
```bash
node scripts/namecheap-dns-manual-guide.mjs
```

### Check current DNS configuration
```bash
node scripts/namecheap-dns-manual-guide.mjs --check
```

### Custom domain
```bash
DOMAIN=bookmarkforgeapp.com node scripts/namecheap-dns-manual-guide.mjs
```

### Custom subdomain
```bash
SUBDOMAIN=www node scripts/namecheap-dns-manual-guide.mjs
```

## What the script does

1. **Displays step-by-step instructions** for Namecheap DNS configuration
2. **Shows the exact DNS records** you need to configure
3. **Provides verification commands** to check if DNS is working
4. **Optionally checks current DNS** to verify your configuration

## Manual Configuration Steps

### Step 1: Log in to Namecheap
1. Open your browser
2. Go to: https://www.namecheap.com/myaccount/login/
3. Log in with your Namecheap credentials

### Step 2: Navigate to DNS Management
1. In the top menu, click on "Domain List"
2. Find your domain: bookmarkforgeapp.com
3. Click on the "Manage" button next to your domain
4. In the left sidebar, click on "Advanced DNS"

### Step 3: Remove existing DNS records (if any)
1. Look for any existing records for:
   - @ (apex domain)
   - www (subdomain)
2. Click the trash icon 🗑️ to delete them
3. Click "Save Changes" if prompted

### Step 4: Add CNAME record for subdomain
1. Click the "Add New Record" button
2. Select "CNAME Record" from the dropdown
3. Fill in the fields:
   - Type: CNAME
   - Host: www
   - Value: cname.vercel-dns.com
   - TTL: Automatic (or 3600 seconds)
4. Click "Save All Changes"

### Step 5: Add A record for apex domain
1. Click the "Add New Record" button again
2. Select "A Record" from the dropdown
3. Fill in the fields:
   - Type: A
   - Host: @
   - Value: 76.76.21.21
   - TTL: Automatic (or 3600 seconds)
4. Click "Save All Changes"

### Step 6: Verify the configuration
1. Scroll down to see your DNS records
2. You should see:
   - CNAME: www → cname.vercel-dns.com
   - A: @ → 76.76.21.21
3. If you see any other records, delete them

### Step 7: Wait for DNS propagation
DNS changes typically take 5-30 minutes to propagate worldwide. In some cases, it can take up to 48 hours.

## DNS Records to Configure

### CNAME Record (www.bookmarkforgeapp.com)
- **Type:** CNAME
- **Host:** www
- **Value:** cname.vercel-dns.com
- **TTL:** Automatic or 3600 seconds

### A Record (bookmarkforgeapp.com - apex)
- **Type:** A
- **Host:** @
- **Value:** 76.76.21.21 (Vercel's primary IP)
- **TTL:** Automatic or 3600 seconds

## Verification

### Using the script
```bash
node scripts/namecheap-dns-manual-guide.mjs --check
```

### Using command line

**Windows (Command Prompt):**
```bash
nslookup www.bookmarkforgeapp.com
nslookup bookmarkforgeapp.com
```

**Windows (PowerShell):**
```bash
Resolve-DnsName -Name www.bookmarkforgeapp.com -Type CNAME
Resolve-DnsName -Name bookmarkforgeapp.com -Type A
```

**macOS/Linux:**
```bash
dig www.bookmarkforgeapp.com CNAME
dig bookmarkforgeapp.com A
```

### Online tools
- https://dnschecker.org/
- https://www.whatsmydns.net/

## Troubleshooting

### DNS not propagating
- Wait 5-30 minutes for DNS propagation
- Check propagation at https://dnschecker.org/
- Clear your browser cache and try again

### Wrong DNS records
- Go back to Namecheap Advanced DNS
- Delete incorrect records
- Add the correct records as shown above
- Save changes and wait for propagation

### Vercel domain not verified
- Ensure DNS records are correct
- Wait for DNS propagation
- Check Vercel dashboard for domain status
- Click "Verify" in Vercel if needed

## Example Output

```
🔧 DNS Manual Configuration Guide for www.bookmarkforgeapp.com

═══════════════════════════════════════════════════════════════
              NAMECHEAP DNS CONFIGURATION GUIDE
═══════════════════════════════════════════════════════════════

📋 STEP 1: Log in to Namecheap
─────────────────────────────────────────────────────────────
1. Open your browser
2. Go to: https://www.namecheap.com/myaccount/login/
3. Log in with your Namecheap credentials

[... more steps ...]

═══════════════════════════════════════════════════════════════
                    DNS RECORDS SUMMARY
═══════════════════════════════════════════════════════════════

Record 1 (CNAME):
  Type: CNAME
  Host: www
  Value: cname.vercel-dns.com
  Points to: Vercel
  Full URL: https://www.bookmarkforgeapp.com

Record 2 (A):
  Type: A
  Host: @
  Value: 76.76.21.21
  Points to: Vercel
  Full URL: https://bookmarkforgeapp.com
```

## Related Scripts

- `scripts/vercel-configure-domain.mjs` - Configure domain in Vercel
- `scripts/namecheap-dns-config.mjs` - Configure DNS via Namecheap API (requires API access)

## Documentation

- Namecheap DNS Documentation: https://www.namecheap.com/support/knowledgebase/article.aspx/294/33/how-to-configure-dns-records-for-your-domain/
- Vercel Custom Domains: https://vercel.com/docs/projects/domains

## License

MIT
