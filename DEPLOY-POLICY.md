# Deploy Policy for BookmarkForge-2026

## Important: Manual Deploys Only

This project **does not use automatic Git deployments** to Vercel.

### Configuration

- **Vercel Git Integration**: ❌ Disabled
- **vercel.json**: `git.deploymentEnabled: false`
- **Vercel dashboard**: Git integration disconnected

### Why `.vercelignore` must not be used for this

`.vercelignore` filters the files uploaded for a **CLI** deploy. Ignoring the
source tree there (`*`) makes Vercel receive only the whitelisted files, so the
build container has no `package.json` and fails with:

```
npm error enoent Could not read package.json: ... /vercel/path0/package.json
Error: Command "npm run build" exited with 254
```

`.vercelignore` only excludes build-irrelevant noise (dependencies, test
artifacts, logs, IDE files); the mechanisms above are what disable Git
deployments.

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
