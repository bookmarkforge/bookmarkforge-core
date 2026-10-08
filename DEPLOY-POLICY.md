# Deploy Policy for BookmarkForge-2026

## Important: Manual Deploys Only

This project **does not use automatic Git deployments** to Vercel.

### Configuration

- **Vercel Git Integration**: ❌ Disabled
- **.vercelignore**: Blocks automatic Git sync
- **vercel.json**: `git.deploymentEnabled: false`

### How to Deploy

To deploy to production, run manually:

```bash
vercel deploy --prod
```

### Why Manual Deploys?

This gives full control over when production updates occur. Every deployment is intentional and requires explicit command execution.

### Verification

To verify no automatic Git sync is configured:

```bash
vercel git disconnect
# Should show: "No Git repository connected"
```

### Pre-Deploy Checklist

Before running `vercel deploy --prod`:

1. ✅ Run `npm run typecheck:prod`
2. ✅ Run `npm run lint`
3. ✅ Run `npm run test:fast`
4. ✅ Run `npm run build:ci`
5. ✅ Commit all changes to Git
6. ✅ Push to GitHub

Then deploy manually with the command above.
