# Core Developer Setup Guide

This guide walks you through setting up a BookmarkForge Core development environment.

**IMPORTANT:** This is the MIT-licensed Core repository. Pro features and proprietary code are intentionally excluded.

## Prerequisites

- **Node.js** >= 24.17.0 (download from [nodejs.org](https://nodejs.org/))
- **npm** (comes with Node.js)
- **Git** (for version control)
- **Code editor** (VS Code recommended)

## Quick Setup (5 minutes)

```bash
# 1. Clone the repository
git clone https://github.com/bookmarkforge/bookmarkforge.git
cd bookmarkforge

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev
```

The app will be available at `http://localhost:5173`.

---

## Detailed Setup

### 1. System Requirements

#### Node.js Version

BookmarkForge Core requires Node.js >= 24.17.0. Check your version:

```bash
node --version
```

If you need to upgrade:
- Download from [nodejs.org](https://nodejs.org/)
- Or use [nvm](https://github.com/nvm-sh/nvm) (macOS/Linux):
  ```bash
  nvm install 24
  nvm use 24
  ```

#### npm Version

npm comes with Node.js. Verify:

```bash
npm --version
```

### 2. Clone the Repository

```bash
git clone https://github.com/bookmarkforge/bookmarkforge.git
cd bookmarkforge
```

### 3. Install Dependencies

Use `npm install` (clean install):

```bash
npm install
```

**Expected output:**
```
added 50 packages, and audited 51 packages in 10s
found 0 vulnerabilities
```

### 4. Environment Configuration

For **local development**, most environment variables have safe defaults. You can start the dev server immediately:

```bash
npm run dev
```

For **custom configuration**, see [ENVIRONMENT.md](ENVIRONMENT.md).

**Optional: Create `.env.local` for custom values**

```bash
# .env.local - Gitignored, for your local development only
VITE_APP_VERSION=1.0.0
VITE_DB_NAME=bookmarkforge-dev
VITE_MODEL_SELF_HOST_URL=http://localhost:11434  # If using Ollama
```

**Never commit `.env.local` or `.env` files.**

### 5. Start Development Server

```bash
npm run dev
```

The dev server starts at `http://localhost:5173`.

**Features available in dev mode:**
- Hot Module Replacement (HMR)
- Fast refresh
- Source maps
- Error overlay
- Vite dev tools

### 6. Verify Setup

Run the basic checks to ensure everything works:

```bash
# Type checking
npm run typecheck:prod

# Linting
npm run lint

# Fast tests
npm run test:fast

# Verify Core/Pro boundary
npm run check:open-core
```

All should pass without errors.

---

## VS Code Setup (Recommended)

### Install Extensions

Install these VS Code extensions for the best development experience:

1. **ESLint** - `dbaeumer.vscode-eslint`
2. **TypeScript** - `ms-vscode.vscode-typescript-next`
3. **Prettier** - `esbenp.prettier-vscode` (optional)
4. **GitLens** - `eamodio.gitlens` (optional but recommended)
5. **Error Lens** - `usernamehw.errorlens` (inline errors)

### Recommended VS Code Settings

Create `.vscode/settings.json`:

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "eslint.validate": ["javascript", "javascriptreact", "typescript", "typescriptreact"],
  "editor.formatOnSave": false,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  }
}
```

---

## Common Development Tasks

### Running Tests

```bash
# Fast tests (critical paths, ~2min)
npm run test:fast

# All tests (~4min)
npm run test:slow

# Watch mode (re-runs on file changes)
npm run test:fast:watch

# E2E tests
npm run e2e:smoke
npm run e2e:ui  # Interactive UI mode
```

### Building

```bash
# Development build
npm run build

# Production build with all gates
npm run build:ci

# Preview production build
npm run build:ci
npm run preview
```

### Running Checks

```bash
# Quick validation (typecheck + lint + fast tests)
npm run verify:fast

# Full CI validation locally
npm run ci:local

# All check gates
npm run check
```

### Type Checking

```bash
# Type check (includes tests/server)
npm run typecheck

# Type check (prod config only)
npm run typecheck:prod
```

### Linting

```bash
# ESLint (bounded to avoid 4GB heap)
npm run lint

# Full ESLint (all files)
npm run lint:all
```

---

## Project Structure

```
bookmarkforge/
├── src/                    # Source code
│   ├── components/         # React components
│   ├── services/           # Business logic
│   ├── hooks/              # React hooks
│   ├── utils/              # Utilities
│   ├── db/                 # Database (RxDB)
│   └── tests/              # Unit/integration tests
├── tests/                  # E2E tests (Playwright)
├── scripts/                # Build/verification scripts
├── docs/                   # Documentation
├── public/                 # Static assets
├── server/                 # Companion server
├── extension/              # Browser extension
├── package.json            # Dependencies and scripts
├── vite.config.ts          # Vite configuration
├── tsconfig.json           # TypeScript config (dev)
├── tsconfig.prod.json      # TypeScript config (prod)
└── AGENTS.md               # Engineering conventions
```

### Key Files to Know

- **AGENTS.md** - Read this first! Engineering conventions (Core-only)
- **CONTRIBUTING.md** - How to contribute to Core
- **docs/architecture.md** - System architecture
- **docs/ENVIRONMENT.md** - Environment variables reference
- **OPEN-CORE.md** - Open Core licensing model

---

## Core vs Pro Boundary

### What's in This Repository

This repository contains **only the MIT-licensed Core**:

✅ **Included:**
- Bookmark management
- Note-taking with rich text
- Tag system
- Smart search (Fuse.js + semantic embeddings)
- BYO AI provider integration (Gemini, OpenAI, Anthropic, etc.)
- Client-side cryptography
- Basic PWA functionality

❌ **NOT Included (Pro):**
- Encrypted backups
- PDF/OCR extraction
- P2P device sync
- Local AI model runtime (WebLLM)
- RAG orchestration
- Expert agents
- Flashcard generation

### Pro Access Pattern

Core code uses `src/services/pro-access.ts` to check Pro availability:

```typescript
import { hasProAccess } from "./pro-access";

async function someFeature() {
  if (await hasProAccess()) {
    // Pro chunk would load here (not in this repo)
  } else {
    throw new ProUnavailableError("This feature requires Pro");
  }
}
```

### Placeholder System

Pro features use inert placeholders in this build:
- `<path>.js` - Inert module that warns when Pro surface is reached
- `<path>..d.ts` - Type declarations for Pro features
- Event: `open-core:pro-reached` dispatched when Pro surface is reached

### Verifying the Boundary

Before committing, always run:

```bash
npm run check:open-core
```

This gate verifies no Pro code has leaked into the Core export.

---

## Troubleshooting

### "Module not found" errors

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### TypeScript errors after pulling changes

```bash
# Clear TypeScript cache
rm -rf *.tsbuildinfo
npm run typecheck:prod
```

### Port already in use (5173)

```bash
# Kill process on port 5173 (macOS/Linux)
lsof -ti:5173 | xargs kill -9

# Or use a different port
VITE_PORT=5174 npm run dev
```

### Tests failing randomly

```bash
# Clear test cache
rm -rf node_modules/.vite
npm run test:fast
```

### "VITE_* not defined" errors

Check your environment configuration:

```bash
npm run check:env
```

---

## Next Steps

### Learn the Codebase

1. Read **AGENTS.md** - Engineering conventions (mandatory)
2. Read **docs/architecture.md** - System architecture
3. Read **docs/security.md** - Security model
4. Explore **src/components/** - React components
5. Explore **src/services/** - Business logic

### First Contribution

1. Create a feature branch:
   ```bash
   git checkout -b feature/my-feature
   ```

2. Make your changes (Core-only, MIT-compatible)

3. Run validation:
   ```bash
   npm run verify:fast
   npm run check:open-core
   ```

4. Commit:
   ```bash
   git add .
   git commit -m "feat: add my feature"
   ```

5. Push and create PR

### Useful Scripts to Know

```bash
# Check Open Core boundary (CRITICAL before committing)
npm run check:open-core

# Validate environment config
npm run check:env

# Check for secrets in commits
npm run check:secrets-in-commit

# Check layer boundaries
npm run check:boundaries

# Check i18n completeness
npm run check:i18n
```

---

## Advanced Setup

### Using Ollama (Local AI Models)

1. Install Ollama: https://ollama.ai

2. Start Ollama server:
   ```bash
   ollama serve
   ```

3. Pull a model:
   ```bash
   ollama pull llama3.2
   ```

4. Configure in `.env.local`:
   ```
   VITE_MODEL_SELF_HOST_URL=http://localhost:11434
   ```

5. Restart dev server

### Running Companion Server

The signaling/licensing companion server is Pro-only hosted infrastructure and is **not included in this MIT Core export** — the client runs fully without it. To develop the server itself, work in the private `bookmarkforge-2026` tree, which ships its own start/watch scripts (bound to `http://localhost:8787`).

### Docker Development

```bash
# Build containers
docker-compose -f docker-compose.staging.yml build

# Start services
docker-compose -f docker-compose.staging.yml up

# View logs
docker-compose -f docker-compose.staging.yml logs -f
```

---

## Getting Help

- **Documentation:** See [docs/index.md](index.md)
- **Issues:** Report bugs on [GitHub Issues](https://github.com/bookmarkforge/bookmarkforge/issues)
- **Discussions:** Join [GitHub Discussions](https://github.com/bookmarkforge/bookmarkforge/discussions)
- **Security:** Report vulnerabilities privately via responsible disclosure

---

## Checklist: Complete Setup

- [ ] Node.js >= 24.17.0 installed
- [ ] Repository cloned
- [ ] Dependencies installed (`npm install`)
- [ ] Dev server starts (`npm run dev`)
- [ ] Type checking passes (`npm run typecheck:prod`)
- [ ] Linting passes (`npm run lint`)
- [ ] Fast tests pass (`npm run test:fast`)
- [ ] Open Core boundary verified (`npm run check:open-core`)
- [ ] Read AGENTS.md
- [ ] Read docs/ENVIRONMENT.md
- [ ] Read CONTRIBUTING.md
- [ ] VS Code extensions installed (optional)

✅ **You're ready to develop on Core!**

---

## Additional Resources

- [Architecture](architecture.md) - System architecture
- [Security](security.md) - Security practices
- [API Reference](api.md) - Companion server API
- [Open Core Model](../OPEN-CORE.md) - Licensing and feature boundaries
