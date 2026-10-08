# Vercel Domain Configuration Script

This script automates the configuration of custom domains in Vercel for BookmarkForge.

## Features

- ✅ Adds domain to the project
- ✅ Configures redirect settings (no redirect)
- ✅ Connects domain to production environment
- ✅ Fetches DNS configuration
- ✅ Validates domain existence before adding

## Prerequisites

1. **Vercel API Token**
   - Go to https://vercel.com/account/tokens
   - Create a new token
   - Copy the token

2. **Vercel Project ID**
   - Go to your Vercel project
   - Settings → General
   - Copy the Project ID

## Setup

1. Copy the example environment file:
   ```bash
   cp scripts/vercel-domain-config.example.env .env.local
   ```

2. Edit `.env.local` and fill in your values:
   ```bash
   VERCEL_TOKEN=your_vercel_token_here
   VERCEL_PROJECT_ID=your_project_id_here
   DOMAIN=www.bookmarkforgeapp.com
   ENVIRONMENT=production
   ```

## Usage

### Basic usage (uses defaults from .env.local)
```bash
node scripts/vercel-configure-domain.mjs
```

### Custom domain
```bash
DOMAIN=bookmarkforgeapp.com node scripts/vercel-configure-domain.mjs
```

### Custom environment
```bash
ENVIRONMENT=preview node scripts/vercel-configure-domain.mjs
```

### Full custom configuration
```bash
VERCEL_TOKEN=your_token VERCEL_PROJECT_ID=your_project_id DOMAIN=www.bookmarkforgeapp.com ENVIRONMENT=production node scripts/vercel-configure-domain.mjs
```

## What the script does

1. **Checks if domain exists** in the project
2. **Adds domain** to the project if it doesn't exist
3. **Configures redirect** to "No Redirect"
4. **Fetches latest deployment** for the target environment
5. **Connects domain** to the latest deployment
6. **Fetches DNS configuration** for verification

## DNS Configuration

After running the script, configure DNS records at your domain registrar:

### For `www.bookmarkforgeapp.com`
- **Type:** CNAME
- **Name:** `www`
- **Value:** `cname.vercel-dns.com`

### For `bookmarkforgeapp.com` (apex domain)
- **Type:** A
- **Name:** `@`
- **Value:** `76.76.21.21` (Vercel's IP)

**Note:** Apex domains require A records pointing to Vercel's IP addresses.

## Verification

After DNS propagation (5-30 minutes):

1. Check domain status in Vercel dashboard
2. Visit `https://www.bookmarkforgeapp.com`
3. Verify SSL certificate is issued

## Troubleshooting

### Domain already exists
The script will detect existing domains and skip adding them, but will still configure redirects and connections.

### DNS propagation delay
DNS changes can take 5-30 minutes to propagate worldwide. Use `dig` or `nslookup` to verify:
```bash
dig www.bookmarkforgeapp.com
```

### API token permissions
Ensure your Vercel token has the following permissions:
- Read
- Write
- Deployments

### Environment not found
Verify the environment name matches exactly what's in Vercel (case-sensitive).

## Security

- Never commit `.env.local` to version control
- Use environment-specific `.env` files
- Rotate API tokens regularly
- Use different tokens for different projects

## Example Output

```
🔧 Configuring domain: www.bookmarkforgeapp.com
📦 Project ID: prj_abc123xyz
🌍 Environment: production

ℹ️  Domain www.bookmarkforgeapp.com does not exist in project yet
➕ Adding domain www.bookmarkforgeapp.com to project...
✅ Domain www.bookmarkforgeapp.com added successfully
🔄 Configuring domain redirect (no redirect)...
✅ Domain redirect configured (no redirect)
📊 Fetching latest deployment for production environment...
✅ Latest deployment found: dpl_abc123 (https://bookmarkforgeapp.com)
🔗 Connecting domain www.bookmarkforgeapp.com to deployment dpl_abc123...
✅ Domain connected to deployment dpl_abc123
📋 Fetching DNS configuration...
✅ Domain is verified
🔐 DNS challenge type: dns-01

✅ Domain configuration completed successfully!

📋 Next steps:
1. Configure DNS records at your domain registrar:
   Type: CNAME
   Name: www
   Value: cname.vercel-dns.com

2. Wait for DNS propagation (usually 5-30 minutes)
3. Verify the domain in Vercel dashboard

🌐 Access your site at: https://www.bookmarkforgeapp.com
```

## License

MIT
