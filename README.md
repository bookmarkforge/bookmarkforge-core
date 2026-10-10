<div align="center">

# BookmarkForge

**Local-first AI Knowledge Vault with End-to-End Encryption**

[![CI](https://github.com/bookmarkforge/bookmarkforge-2026/actions/workflows/ci.yml/badge.svg)](https://github.com/bookmarkforge/bookmarkforge-2026/actions/workflows/ci.yml)
[![Nightly validation](https://github.com/bookmarkforge/bookmarkforge-2026/actions/workflows/nightly.yml/badge.svg)](https://github.com/bookmarkforge/bookmarkforge-2026/actions/workflows/nightly.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](https://github.com/bookmarkforge/bookmarkforge-2026/releases/latest)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24.17.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

> **Distribution model:** Open Core. The public Core is licensed under MIT; Pro features identified in `OPEN-CORE.md` are proprietary and not covered by that license.

BookmarkForge is a privacy-preserving personal knowledge application with encrypted storage, offline operation, optional P2P sync, and AI features that call directly to the provider you configure.

[**Getting Started**](#-quick-start) • [**Documentation**](#-documentation) • [**Architecture**](#-architecture) • [**Security**](#-security--privacy) • [**Contributing**](#-contributing)

</div>

---

## ✨ Features

### 🔒 **Security & Privacy**
- **End-to-end encryption** — AES-GCM + Argon2id for secure vault storage
- **Zero-knowledge architecture** — Your data never leaves your device unencrypted
- **BYO AI keys** — Provider keys stored encrypted in your vault, never on our servers
- **Secure credential handling** — Password buffers automatically zeroized after use

### 🌐 **Local-First Design**
- **Offline-first** — Works without internet connection
- **P2P sync** — Direct device-to-device synchronization (Pro)
- **No cloud dependencies** — Full functionality without external services
- **Progressive Web App** — Installable on any modern browser

### 🤖 **AI Integration**
- **Multi-provider support** — Gemini, OpenAI, Anthropic, Groq, Hugging Face, OpenRouter
- **Local AI models** — Ollama and in-browser models with WebLLM
- **Direct API calls** — No proxy, browser-to-provider communication
- **RAG & Knowledge Graph** — AI-powered knowledge management

### 📝 **Knowledge Management**
- **Bookmarks & Notes** — Organize your digital knowledge
- **Interactive Knowledge Graphs** — Visualize connections between concepts
- **Advanced Search** — Smart search across all your content
- **Export Options** — JSON, JSONL, CSV, Markdown, HTML, Notion, Obsidian, and PDF

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 24.17.0
- **npm** (comes with Node.js)
- **Docker Compose** (for containerized environments)

### Installation

```bash
# Clone the repository
git clone https://github.com/bookmarkforge/bookmarkforge-2026.git
cd bookmarkforge

# Install dependencies
npm ci

# Setup environment
cp .env.example .env

# Run development server
npm run dev
```

### Development Workflow

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Run fast tests
npm run test:fast

# Run all tests
npm run test:slow

# Build for production
npm run build:ci

# Run all checks
npm run check
```

---

## 📚 Documentation

### Core Documentation
- [**Architecture**](docs/architecture.md) — System architecture and design decisions
- [**Security**](docs/security.md) — Security model and best practices
- [**Operations**](docs/operations.md) — Deployment and operational procedures
- [**API Reference**](docs/api.md) — Companion server API documentation
- [**OpenAPI Spec**](docs/openapi.yaml) — OpenAPI 3.0 specification

### Developer Resources
- [**Developer Guide**](docs/DEVELOPER-GUIDE.md) — Development workflows and conventions
- [**Engineering Conventions**](AGENTS.md) — Code style and architectural rules
- [**Contributor Onboarding**](docs/ONBOARDING.md) — Getting started as a contributor
- [**Open Core Model**](OPEN-CORE.md) — Licensing and feature boundaries

### User Documentation
- [**User Manuals**](docs/user-manual-en.md) — End-user documentation (30 languages)
- [**Self-Hosting Guide**](docs/SELF-HOSTING.md) — Deploy your own instance
- [**Launch Checklist**](docs/launch-checklist.md) — Production readiness checklist

### Business & Compliance
- [**Commercial Positioning**](docs/positioning.md) — Market positioning and strategy
- [**Audit Report**](docs/audit.md) — Security audit findings
- [**ROPA (GDPR)**](docs/ROPA.md) — Records of processing activities
- [**Market Validation Plan**](docs/market-validation-plan.md) — 30-day validation strategy

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Browser / PWA / Extension                   │
│  React 19 + TypeScript + RxDB + IndexedDB + WebRTC     │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS/WSS
                     ▼
┌─────────────────────────────────────────────────────────┐
│            Reverse Proxy (TLS, CSP, Static)              │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
┌─────────────────┐     ┌─────────────────┐
│  Web Frontend   │     │ Companion Server│
│  (React/Vite)   │     │   (Node/ws)     │
└────────┬────────┘     └────────┬────────┘
         │                     │
         │                     ├─► P2P WebSocket signaling
         │                     ├─► License endpoints (/api/license/*)
         │                     ├─► Health, CSP reports
         │                     └─► Opt-in telemetry
         │
         └─► Your AI Providers (BYO key)
              • Gemini, OpenAI, Anthropic
              • Groq, Hugging Face, OpenRouter
              • Ollama, WebLLM (local)

Cryptography: AES-GCM, Argon2id/HKDF, keys managed in Web Workers
```

### Key Architectural Principles

- **Stateless services** — No shared database or Redis in production
- **Client-first data** — Vault data lives on the client
- **End-to-end encryption** — Encryption/decryption happens client-side
- **Zero-trust model** — Server never sees unencrypted data or AI keys

---

## 🔒 Security & Privacy

### Security Measures

- **TLS termination** at reverse proxy with HTTPS redirect and HSTS
- **Content Security Policy** (CSP) with strict allow-lists
- **IP privacy** in server logs — no user IP addresses logged
- **Secret scanning** — Automated detection of leaked secrets in commits
- **License key management** — Ed25519/RSA-PSS for license validation

### Mandatory Production Configuration

```bash
# Required environment variables
AI_SESSION_ORIGINS=https://your-domain.com  # Browser origin allow-list
ENFORCE_SIGNAL_HMAC=1                       # Signal message authentication
SIGNALING_ADMIN_TOKEN=<secure-token>         # Admin-only access
CSP_REPORT_ADMIN_TOKEN=<secure-token>       # CSP report access
```

### Privacy Guarantees

- **Your AI keys** are stored encrypted in your vault, never on our servers
- **Vault content** never leaves your device unencrypted
- **No tracking** — Opt-in telemetry only, no behavioral tracking
- **GDPR-ready** — ROPA, retention policies, and user rights documented

### Security Gates

Every PR must pass mandatory security gates before merge:

```bash
npm run check:security-internal  # 9 security checks
npm run check:server-log-ip-privacy
npm run check:blindeo              # Security scanner
```

---

## 🧪 Testing

### Test Profiles

| Profile | Duration | Coverage | Command |
|---------|----------|----------|---------|
| `test:fast` | ~7s | Critical paths | `npm run test:fast` |
| `test:slow` | ~4min | Full test suite | `npm run test:slow` |
| `e2e:smoke` | ~60s | Critical vault operations | `npm run e2e:smoke` |
| `e2e:full` | ~10min | End-to-end scenarios | `npm run e2e` |

### Test Categories

- **Unit tests** — Vitest suites for security, DB, services
- **Integration tests** — Cross-component interactions
- **E2E tests** — Playwright specs for user workflows
- **Security tests** — Adversarial property tests and fuzzing
- **Performance tests** — Bundle size and runtime budgets

### Continuous Testing

```bash
# Watch mode for fast iteration
npm run test:fast:watch

# Playwright UI mode
npm run e2e:ui

# Run all gates (before commit)
npm run ci:local
```

---

## 🚢 Production Deployment

### Pre-Deployment Checklist

```bash
# Environment validation
npm run check:env
npm run check:secrets-in-commit
npm run check:landings-fresh

# Build verification
npm run build:ci

# Production smoke test
npm run production-smoke

# Full gate chain
npm run check
```

### Deployment Requirements

- **SHA-identified images** — Use container digests, not tags
- **All gates passing** — Security, lint, tests, and build checks
- **Rollback procedure** — Tested rollback plan before deployment
- **Operational approval** — Explicit approval for production changes

### Monitoring & Operations

- **Health endpoint** — `/health` for liveness checks
- **Structured logging** — Events, errors, saturation, connections
- **Performance metrics** — Latency, availability, resource usage
- **Backup verification** — Monthly restore tests, quarterly disaster drills

---

## 📜 Licensing

### Open Core Model

BookmarkForge uses an **Open Core** distribution model:

- **Core** — MIT-licensed, freely available and modifiable
- **Pro** — Proprietary features, commercial license required
- **Trademarks** — Brand assets protected by trademark policy

### License Files

- [**Core MIT License**](LICENSE) — Open source components
- [**Pro License**](PRO-LICENSE.md) — Commercial features
- [**Trademark Policy**](scripts/public-export/TRADEMARKS.md) — Brand usage guidelines
- [**Open Core Specification**](OPEN-CORE.md) — Feature boundaries

### Export Public Repository

To generate the reproducible public repository from the private checkout:

```bash
node scripts/export-public-repo.mjs
```

Never publish the complete checkout as if everything were under MIT.

---

## 🛠️ Scripts & Tools

### Check Groups

Checks are organized into 8 groups for faster iteration:

| Group | Time | Command |
|-------|------|---------|
| Core Integrity | ~3s | `npm run check:core-integrity` |
| Security Environment | ~4s | `npm run check:security-environment` |
| Quality Code | ~25s | `npm run check:quality-code` |
| Content Integrity | ~12s | `npm run check:content-integrity` |
| Brand Visual | ~5s | `npm run check:brand-visual` |
| Security Depth | ~8s | `npm run check:security-depth` |
| Build Verification | ~60s | `npm run check:build-verification` |
| Workflow Pipeline | ~5s | `npm run check:workflow-pipeline` |

### Fast Iteration

```bash
# Fast CI (~7s)
npm run ci:fast

# Run checks with fast option
npm run check:ci-groups --fast
```

### Complete Tool Catalog

See [`scripts/README.md`](scripts/README.md) for the complete catalog of 168+ build, verification, and operations scripts.

---

## 🌍 Internationalization

BookmarkForge supports **30 languages** with complete UI translations:

### Available Languages

Spanish, English, German, French, Italian, Portuguese, Arabic, Bulgarian, Czech, Danish, Greek, Finnish, Hebrew, Hindi, Croatian, Hungarian, Indonesian, Japanese, Korean, Dutch, Norwegian, Polish, Romanian, Russian, Swedish, Thai, Turkish, Ukrainian, Vietnamese, Chinese

### User Manuals

Each language has a Markdown source and generated PDF:

| Language | Markdown | PDF |
|----------|----------|-----|
| Spanish | [manual-de-usuario-es.md](docs/manual-de-usuario-es.md) | [manual-de-usuario-es.pdf](docs/manual-de-usuario-es.pdf) |
| English | [user-manual-en.md](docs/user-manual-en.md) | [user-manual-en.pdf](docs/user-manual-en.pdf) |

Manuals are named in each language's own language (the endonym) plus its locale code — `benutzerhandbuch-de.md`, `user-manual-ja.md` — so the other locales live in `docs/` (+ `.pdf`) under those names. See [`docs/index.md`](docs/index.md) for the complete list.

---

## 🤝 Contributing

### Getting Started

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run all checks (`npm run check`)
5. Commit your changes
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Code of Conduct

- Respect all contributors
- Focus on what is best for the community
- Be inclusive and welcoming
- Constructive feedback only

### Security Champions Program

BookmarkForge operates a **Security Champions program** for distributed security responsibility. Every PR must pass mandatory security gates before merge.

See [`AGENTS.md`](AGENTS.md) for detailed engineering conventions and security guidelines.

---

## 📞 Support

- **Documentation** — See the [documentation index](docs/index.md)
- **Issues** — Report bugs on [GitHub Issues](https://github.com/bookmarkforge/bookmarkforge-2026/issues)
- **Security** — Report security vulnerabilities privately via responsible disclosure
- **Discussions** — Join community discussions on [GitHub Discussions](https://github.com/bookmarkforge/bookmarkforge-2026/discussions)

---

## 🌐 Domain & URLs

**Official domain:** [bookmarkforgeapp.com](https://bookmarkforgeapp.com)

All references to `bookmarkforgeapp.com` are being migrated to `bookmarkforgeapp.com`.

---

## 📊 Stats

- **168+** build, verification, and operations scripts
- **30** supported languages
- **460+** automated tests
- **8** check groups for fast iteration
- **Zero** cloud dependencies for core functionality

---

<div align="center">

**BookmarkForge v1.0.0 — Open Core: MIT Core + proprietary Pro**

[⬆ Back to top](#-bookmarkforge)

</div>
