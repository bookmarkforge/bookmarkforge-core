# Namecheap DNS Configuration Script

This script automates DNS configuration for BookmarkForge on Namecheap using their API.

## Features

- ✅ Configures CNAME record for www subdomain
- ✅ Configures A record for apex domain
- ✅ Verifies DNS configuration
- ✅ Provides manual configuration instructions if API fails
- ✅ Supports custom domain and subdomain

## Prerequisites

### API Access Requirements

Namecheap requires one of the following to access their API:
- $50+ account balance, OR
- 20+ domains in your account, OR
- $50+ in purchases in the last 2 years

**If you don't meet these requirements**, use the manual configuration guide instead:
```bash
node scripts/namecheap-dns-manual-guide.mjs
```

### Required for API Access

1. **Namecheap Account**
   - Log in to https://www.namecheap.com
   - Ensure you own the domain
   - **Meet API access requirements** (see above)

2. **Namecheap API Key**
   - Go to https://ap.www.namecheap.com/grant/api-key
   - Select "Read" and "Write" permissions
   - Copy the API key

3. **Namecheap Username**
   - Your Namecheap account username

## Setup

1. Copy the example environment file:
   ```bash
   cp scripts/namecheap-dns-config.example.env .env.local
   ```

2. Edit `.env.local` and fill in your values:
   ```bash
   NAMECHEAP_USER=your_namecheap_username
   NAMECHEAP_API_KEY=your_namecheap_api_key
   DOMAIN=bookmarkforgeapp.com
   SUBDOMAIN=www
   ```

## Usage

### Basic usage (uses defaults from .env.local)
```bash
node scripts/namecheap-dns-config.mjs
```

### Custom domain
```bash
DOMAIN=bookmarkforgeapp.com node scripts/namecheap-dns-config.mjs
```

### Custom subdomain
```bash
SUBDOMAIN=api node scripts/namecheap-dns-config.mjs
```

### Full custom configuration
```bash
NAMECHEAP_USER=your_user NAMECHEAP_API_KEY=your_key DOMAIN=bookmarkforgeapp.com SUBDOMAIN=www node scripts/namecheap-dns-config.mjs
```

## What the script does

1. **Fetches current DNS records** for the domain
2. **Verifies existing configuration**
3. **Sets CNAME record** for subdomain (www → cname.vercel-dns.com)
4. **Sets A record** for apex domain (@ → 76.76.21.21)
5. **Verifies final DNS configuration**

## DNS Records Configured

### CNAME Record (www.bookmarkforgeapp.com)
- **Type:** CNAME
- **Host:** www
- **Value:** cname.vercel-dns.com
- **TTL:** 3600 seconds

### A Record (bookmarkforgeapp.com - apex)
- **Type:** A
- **Host:** @
- **Value:** 76.76.21.21 (Vercel's primary IP)
- **TTL:** 3600 seconds

## Manual Configuration (if API fails)

If the API fails, the script will provide manual configuration instructions:

1. Log in to Namecheap: https://www.namecheap.com/myaccount/login/
2. Go to Domain List → Manage → Advanced DNS
3. Add CNAME record:
   - Type: CNAME
   - Host: www
   - Value: cname.vercel-dns.com
   - TTL: 3600
4. Add A record (for apex domain):
   - Type: A
   - Host: @
   - Value: 76.76.21.21
   - TTL: 3600
5. Save changes
6. Wait for DNS propagation (5-30 minutes)

## DNS Propagation

DNS changes typically take 5-30 minutes to propagate worldwide. You can verify propagation using:

```bash
# Check CNAME record
dig www.bookmarkforgeapp.com

# Check A record
dig bookmarkforgeapp.com
```

## Verification

After DNS propagation:

1. Visit `https://www.bookmarkforgeapp.com`
2. Visit `https://bookmarkforgeapp.com`
3. Verify SSL certificate is issued by Vercel
4. Check domain status in Vercel dashboard

## Troubleshooting

### API Authentication Error
- Verify your Namecheap username is correct
- Ensure API key has Read and Write permissions
- Regenerate API key if necessary

### Domain Not Found
- Ensure you own the domain on Namecheap
- Verify the domain name is spelled correctly
- Check that the domain is not expired

### Record Already Exists
- The script will overwrite existing records
- If you get an error, configure manually using the instructions above

### DNS Propagation Delay
- DNS changes can take 5-30 minutes to propagate
- Use `dig` or `nslookup` to verify:
  ```bash
  dig www.bookmarkforgeapp.com
  nslookup www.bookmarkforgeapp.com
  ```

## Security

- Never commit `.env.local` to version control
- Use environment-specific `.env` files
- Rotate API keys regularly
- Use separate API keys for different projects

## Related Scripts

- `scripts/namecheap-dns-manual-guide.mjs` - Manual DNS configuration guide (no API access required)
- `scripts/vercel-configure-domain.mjs` - Configure domain in Vercel

## Alternative: Manual Configuration

If you don't have API access to Namecheap, use the manual configuration guide:
```bash
node scripts/namecheap-dns-manual-guide.mjs
```

This guide provides step-by-step instructions for configuring DNS through the Namecheap web interface.

## API Documentation

Namecheap API documentation:
- https://www.namecheap.com/support/api/methods/
- https://www.namecheap.com/support/api/methods/dns-get-hosts/
- https://www.namecheap.com/support/api/methods/dns-set-hosts/

## Example Output

```
🔧 Configuring DNS for www.bookmarkforgeapp.com
👤 Namecheap User: your_username

📋 Fetching current DNS records for bookmarkforgeapp.com...
✅ DNS records fetched
🔍 Verifying DNS configuration...
⚠️  CNAME record not found for www.bookmarkforgeapp.com
⚠️  A record not found for bookmarkforgeapp.com
➕ Setting CNAME record for www.bookmarkforgeapp.com...
✅ CNAME record set: www.bookmarkforgeapp.com → cname.vercel-dns.com
➕ Setting A record for bookmarkforgeapp.com...
✅ A record set: bookmarkforgeapp.com → 76.76.21.21
🔍 Verifying DNS configuration...
✅ CNAME record verified for www.bookmarkforgeapp.com
✅ A record verified for bookmarkforgeapp.com

✅ DNS configuration completed successfully!

📋 Records configured:
   CNAME: www.bookmarkforgeapp.com → cname.vercel-dns.com
   A: bookmarkforgeapp.com → 76.76.21.21

⏱️  DNS propagation may take 5-30 minutes
🌐 Access your site at: https://www.bookmarkforgeapp.com
🌐 Apex domain at: https://bookmarkforgeapp.com
```

## License

MIT
