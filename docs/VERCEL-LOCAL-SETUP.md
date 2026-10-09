# Vercel Local Development Setup

This guide explains how to use Vercel for local development with BookmarkForge.

## Prerequisites

- Node.js >= 24.17.0
- Vercel CLI installed (`npm install -g vercel`)
- Vercel account (free tier works)

## Installation

### 1. Install Vercel CLI

```bash
npm install -g vercel
```

### 2. Login to Vercel

```bash
vercel login
```

This will open a browser window to authenticate with your Vercel account.

### 3. Initialize Project

```bash
cd D:\Nueva\carpeta\bookmark7
vercel
```

Follow the prompts:
- **Set up and deploy?** → `No` (for local development only)
- **Link to existing project?** → `No` (or select existing if you have one)
- **Project name** → `bookmarkforge-local` (or your preferred name)
- **Directory** → `./` (current directory)
- **Override settings?** → `No` (use the vercel.json we created)

## Local Development

### Start Vercel Dev Server

```bash
npm run dev:vercel
```

This will:
- Start the Vercel development server
- Build the project using Vercel's infrastructure
- Provide a local URL (usually `http://localhost:3000`)
- Simulate Vercel's production environment locally

### Environment Variables

Copy the example environment file:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your values:

```env
VITE_BUILD_ENV=development
VITE_ENABLE_BETA_FEATURES=false
VITE_ENABLE_DEBUG_MODE=false
```

**Important:** Never commit `.env.local` to git. It's already in `.gitignore`.

## Configuration Files

### vercel.json

The project includes a `vercel.json` file with:

- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Framework**: Vite
- **Security headers**: CSP, XSS protection, etc.
- **Cache headers**: Optimized for static assets
- **Rewrites**: SPA routing support

### .vercelignore

Excludes unnecessary files from Vercel deployment:
- `node_modules`, test artifacts, logs, IDE files
- Development-only files

**Important:** `.vercelignore` only trims build-irrelevant noise. It must never
whitelist the source tree (`*`), because Vercel would upload almost nothing and
the build would fail with `ENOENT ... /vercel/path0/package.json`. Automatic Git
deploys are disabled via `vercel.json` (`git.deploymentEnabled: false`) and the
dashboard, not with this file. See `DEPLOY-POLICY.md`.

## Scripts

### Available Commands

```bash
# Start Vercel dev server
npm run dev:vercel

# Regular Vite dev server (faster for development)
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

## Deployment to Vercel

When you're ready to deploy to Vercel:

### 1. Deploy to Preview

```bash
vercel
```

This creates a preview URL for testing.

### 2. Deploy to Production

```bash
vercel --prod
```

This deploys to your production domain.

### 3. Set Environment Variables in Vercel Dashboard

Go to your Vercel project dashboard and add:
- `VITE_BUILD_ENV=production`
- Any other required environment variables

## Differences from Regular Dev Server

### Vercel Dev Server (`npm run dev:vercel`)
- Simulates Vercel's production environment
- Includes Vercel's Edge Network features
- Better for testing production behavior
- Slightly slower startup time

### Regular Vite Dev Server (`npm run dev`)
- Faster for development
- Uses Vite's native HMR
- Better for rapid iteration
- Doesn't simulate Vercel specifics

## Troubleshooting

### Port Already in Use

If port 3000 is in use:

```bash
vercel dev --port 3001
```

### Build Errors

Check that all dependencies are installed:

```bash
npm install
```

### Environment Variables Not Loading

Ensure `.env.local` exists and is not in `.gitignore` for testing:

```bash
ls -la .env.local
```

### Vercel CLI Authentication Issues

Re-login:

```bash
vercel logout
vercel login
```

## Best Practices

1. **Use `npm run dev` for regular development** - faster and more responsive
2. **Use `npm run dev:vercel` for testing production behavior** - before deploying
3. **Never commit `.env.local`** - it contains sensitive data
4. **Keep `vercel.json` updated** - reflects production configuration
5. **Test preview deployments** - before production releases

## Next Steps

1. Start with `npm run dev` for regular development
2. Use `npm run dev:vercel` when testing deployment behavior
3. Deploy to preview when ready for team review
4. Deploy to production when changes are approved

## Resources

- [Vercel CLI Documentation](https://vercel.com/docs/cli)
- [Vercel Configuration](https://vercel.com/docs/projects/project-configuration)
- [Environment Variables](https://vercel.com/docs/projects/environment-variables)
- [BookmarkForge Architecture Tutorial](ARCHITECTURE-TUTORIAL.md)
