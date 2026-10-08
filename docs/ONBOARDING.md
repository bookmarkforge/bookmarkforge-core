# 🚀 BookmarkForge Contributor Onboarding Guide

> Complementary document to `CONTRIBUTING.md`, `AGENTS.md` and `docs/audit.md`.
> This document is your entry point if you are starting with the project.

## 📋 Prerequisites

- **Node.js >= 24.17.0** (verify with `node -v`)
- **npm** (or pnpm/yarn if you prefer)
- **Docker Compose** (only if you will test production topology)
- **Git** configured with your name and email
- A code editor with TypeScript support (VS Code recommended)

## 🏃 First time: Quick Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd bookmark6

# 2. Install dependencies
npm ci

# 3. Configure local environment
cp .env.example .env
# Edit .env with your local values

# 4. Verify everything works (30-60 seconds)
npm run verify:fast

# 5. Start development server
npm run dev

# 6. (Optional) Start companion server
npm run server
```

Frontend will be available at `http://localhost:5173`.
Companion server at `ws://localhost:8787`.

## 🎯 What to do after setup?

### If you want to make your first PR:

1. **Read section 6 of `CONTRIBUTING.md`** — Mandatory gates
2. **Run `npm run check:quick`** before each commit (~2.5s)
3. **Read `AGENTS.md`** — Contains project engineering rules
4. **Find an issue** labeled as `good first issue`
5. **Follow branching flow**: `feat/<short-slug>`

### If you want to understand architecture:

1. **Read `docs/architecture.md`** — The diagram and general description
2. **Explore `src/`** — Main directories:
   - `src/components/` — React components (80+)
   - `src/services/` — Domain services (58+)
   - `src/db/` — RxDB schemas
   - `src/workers/` — Web Workers for cryptography
   - `src/tests/` — Tests organized by area
3. **Read `docs/ADR-001-check-static-brand.md`** — Example ADR

### If you want to contribute to security:

1. **Read `docs/security.md`** and `docs/audit.md`
2. **Study `AGENTS.md` section 2** — Password buffer contract
3. **Review `src/tests/security/`** Security regression tests
4. **Do not touch crypto code without understanding `AGENTS.md`**

## 📁 Project Structure (Summary)

```
bookmark6/
├── src/                    # Frontend source code
│   ├── components/         # 80+ React components
│   ├── services/           # 58+ domain services
│   ├── db/                 # RxDB/IndexedDB schemas
│   ├── workers/            # Web Workers (crypto, sync)
│   ├── tests/              # Tests by area (42 directories)
│   └── ...
├── server/                 # Companion server (Node.js + WS)
│   └── src/               # ~13 HTTP + WS files
├── extension/              # Browser extension (Chrome/Firefox)
├── scripts/               # 168+ build/check scripts
├── docs/                  # 131+ documentation files
├── tests/e2e/             # Playwright specs
└── scripts/               # CI/CD tools
```

## 🧪 Testing for Beginners

### Quick test (recommended to start):
```bash
npm run test:fast        # ~30s, critical tests
```

### Specific test:
```bash
npx vitest run src/tests/db/        # Only db tests
npx vitest run src/tests/security/  # Only security tests
```

### E2E (requires build):
```bash
npm run build:ci              # First build
npm run e2e:smoke             # Quick smoke test
```

### View test logs (when they fail without output):
```bash
BMF_TEST_LOGS=full npm run test:fast
```

## 🔧 Useful Daily Commands

| Command | Time | Use |
|---------|--------|-----|
| `npm run dev` | — | Development server |
| `npm run verify:fast` | ~5s | Quick pre-commit |
| `npm run check:quick` | ~2.5s | Sub-second gates |
| `npm run typecheck:prod` | ~10s | Strict TypeScript |
| `npm run lint` | ~21s | Domain ESLint |
| `npm run test:fast` | ~30s | Critical tests |
| `npm run test:slow` | ~5min | All tests |
| `npm run check` | ~62s | All CI gates |
| `npm run ci:local` | ~2min | Simulate full CI |
| `npm run check:ci-groups core-integrity` | ~3s | Only core integrity |
| `npm run check:ci-groups security-environment` | ~4s | Only security |

## 🚦 Understanding CI Gates

The pipeline has **~50 checks**. To not overwhelm you, use groups:

```bash
# Only Core integrity + security (~7s instead of ~62s)
npm run ci:fast

# Standard (without e2e or full build)
npm run ci:standard

# Complete (includes visual, brand, performance)
npm run ci:full
```

The 8 groups are defined in `scripts/ci-groups.json`:
1. **core-integrity** (~3s) — Open Core boundary
2. **security-environment** (~4s) — Secrets and config
3. **workflow-pipeline** (~5s) — CI/CD workflows
4. **quality-code** (~25s) — Typecheck + lint + boundaries
5. **content-integrity** (~12s) — i18n and claims
6. **brand-visual** (~5s) — Brand and SEO
7. **security-depth** (~8s) — CVEs and audit
8. **build-verification** (~60s) — Full build

## 🐛 Common Debugging

### TypeScript errors:
```bash
npm run typecheck:prod    # Uses tsconfig.prod.json
```

### ESLint does not detect errors:
```bash
npm run lint:all          # Full ESLint (can be slow)
```

### Tests fail without clear messages:
```bash
BMF_TEST_LOGS=full npx vitest run src/tests/<area>/
```

### E2E cannot find elements:
```bash
npm run e2e:smoke:ui      # Playwright visual mode
```

### Build fails:
```bash
npm run build:ci          # Includes secret-scan, SRI, chunk gates
```

## 📚 Learning Resources

1. **`docs/architecture.md`** — General architecture
2. **`docs/ADR-001-check-static-brand.md`** — First ADR (example)
3. **`docs/audit.md`** — Audit ledger
4. **`docs/ROPA.md`** — GDPR (operational template)
5. **`docs/security.md`** — Security and cryptography
6. **`AGENTS.md`** — Engineering conventions (the bible)
7. **`CONTRIBUTING.md`** — Contribution flow
8. **`docs/launch-checklist.md`** Launch checklist

## 🤝 Code of Conduct

- Read `CONTRIBUTING.md` section 2 before opening issues
- Security sensitive → private disclosure, not public issues
- Every visible string → `t()` (fails if not through i18n)
- Never commit `.env`, secrets, or credentials
- Do not modify `scripts/context-boundaries.allowlist.json`

## 🆘 Need Help?

1. **Ask in the issue** with context of what you read
2. **Read section 13 of `CONTRIBUTING.md`** ("When you are sure")
3. **Do not guess** — if `AGENTS.md` is ambiguous, say it in the issue
4. **For legal/GDPR topics** → `docs/ROPA.md` (not legal advice)

## 🎯 Checklist for your First PR

- [ ] `npm run verify:fast` passes
- [ ] `npm run check:quick` passes
- [ ] `npm run typecheck:prod` passes
- [ ] `npm run lint` passes
- [ ] `npm run test:fast` passes
- [ ] No `console.*` in new code
- [ ] No hardcoded secrets
- [ ] Every visible string has `t()`
- [ ] ADR/anchor present if touching security
- [ ] Did not touch boundaries allowlist
- [ ] README/CONTRIBUTING updated if necessary

---

> **Note**: This repository is operated by a single maintainer.
> Review is **automated-first**: CI checks are the enforcement.
> Response times depend on maintainer.
> Read `docs/audit.md` for current operation status.
