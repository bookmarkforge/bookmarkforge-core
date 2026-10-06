<div align="center">

# BookmarkForge

**Local-first AI Knowledge Vault with End-to-End Encryption**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](https://github.com/bookmarkforge/bookmarkforge/releases/latest)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![CI](https://github.com/bookmarkforge/bookmarkforge/actions/workflows/ci.yml/badge.svg)](https://github.com/bookmarkforge/bookmarkforge/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-460%2B-brightgreen)](https://github.com/bookmarkforge/bookmarkforge/actions)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

> **Distribution model:** Open Core. This repository is the MIT-licensed Core; Pro features identified in `OPEN-CORE.md` are proprietary and not included here.

Your personal knowledge vault — encrypted on your device, works offline, and stays yours. No accounts, no tracking, no one can read your data. Not even us.

[Quick Start](#-quick-start) • [Features](#-features) • [Free vs Pro](#-free-vs-pro) • [Documentation](#-documentation) • [Architecture](#-architecture) • [Security](#-security--privacy) • [Contributing](#-contributing) • [Troubleshooting](#-troubleshooting)

</div>

---

## ✨ Features

### 🔒 Security & Privacy

- **End-to-end encryption** — AES-256-GCM + Argon2id for secure vault storage
- **Zero-knowledge vault** — 24-word recovery phrase, tampering detection, fail-closed storage
- **BYO AI keys** — Provider keys stored encrypted in your vault, never on our servers
- **No tracking** — Opt-in telemetry only, works fully offline
- **Client-side cryptography** — All encryption/decryption happens in Web Workers, server never sees keys

### 🌐 Local-First Design

- **Offline-first** — The app lives in your browser; your vault works without internet
- **No cloud dependencies** — Full Core functionality without external services
- **Progressive Web App** — Installable on any modern browser, plus browser extensions
- **P2P sync (Pro)** — Optional device-to-device sync over WebRTC; servers relay encrypted traffic, never content

### 🤖 AI Integration (Core: BYOK)

- **Multi-provider support** — Gemini, OpenAI, Anthropic, Groq, Hugging Face, OpenRouter with your own keys
- **Direct API calls** — No proxy: the browser calls the provider you configure
- **Free smart search** — Fuse.js + semantic embeddings engine included in Core
- **Pro AI surfaces (Pro)** — Local model runtime, RAG orchestration, expert agents and flashcard generation

### 📝 Knowledge Management

- **Bookmarks & Notes** — Organize your digital knowledge
- **Interactive Knowledge Graphs** — Visualize connections between concepts
- **Advanced Search** — Smart search across all your content
- **Import / Export** — JSON, JSONL, CSV, Markdown, HTML, Notion, Obsidian, and PDF

---

## 💡 Why BookmarkForge?

Most bookmark managers store your library in someone else's cloud in plain text. BookmarkForge keeps everything **encrypted on your device** (AES-GCM with an Argon2id-derived key), so your data is yours in the strongest sense: we couldn't hand it over even if we wanted to.

- **Local-first** — Your vault works fully offline. No server required.
- **Zero-knowledge** — Recovery phrase, tampering detection, fail-closed storage.
- **P2P sync (Pro)** — Device-to-device sync; servers relay encrypted traffic, never content.
- **Open Core, MIT** — Audit the public Core; Pro components are not included in this export.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 20.19.0
- **npm** (comes with Node.js)

### Installation

```bash
# Clone the public Core
git clone https://github.com/bookmarkforge/bookmarkforge-core.git
cd bookmarkforge-core

# Install dependencies
npm ci

# Start the development server
npm run dev        # http://localhost:5173
```

### Useful Commands

```bash
# Type checking (production config)
npm run typecheck:prod

# Linting
npm run lint

# Fast tests (critical paths)
npm run test:fast

# Full test suite
npm run test:slow

# Production build with integrity gates
npm run build:ci

# Full gate chain (open-core, boundaries, docs, security, …)
npm run check
```

Build for production: `npm run build`. See `docs/architecture.md` for the full topology: static web + signaling/licensing companion server.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/bookmarkforge/bookmarkforge-core.git
cd bookmarkforge-core

# Install dependencies
npm ci

# Start development server
npm run dev        # http://localhost:5173

# Run tests in watch mode
npm run test:fast:watch

# Run E2E tests in UI mode
npm run e2e:ui
```

### Environment Variables

The Core uses environment variables for configuration. Create a `.env.local` file in the root directory:

```bash
# Build environment
VITE_BUILD_ENV=development

# App version (must match package.json)
VITE_APP_VERSION=1.0.0

# Database name (for local development)
VITE_DB_NAME=bookmarkforge_dev

# Disable network firewall for development (optional)
VITE_DISABLE_NETWORK_FIREWALL=false

# Enable strict environment boot checks
VITE_ENV_BOOT_STRICT=0

# Test build mode
VITE_TEST_BUILD=false
```

**Note:** Never commit `.env.local` to the repository. Use `.env.example` as a template.

---

## 🆓 Free vs Pro

This repository contains the MIT-licensed **Core**. The private distribution adds proprietary **Pro** components, unlocked at runtime by a **signed license** purchased from the official store:

| Feature | Free (Core) | Pro |
|---|---|---|
| Bookmarks | 2,500 | Unlimited |
| Smart search (Fuse.js + semantic) | ✅ included | ✅ |
| Encrypted backups & PDF/OCR | — | ✅ |
| Flashcards from bookmarks | — | ✅ |
| P2P device sync | — | ✅ |
| Support | Community | Email 48h |

**Buy a Pro license:** [bookmarkforgeapp.com](https://bookmarkforgeapp.com) — $59 Early Bird (first 200 licenses) → $79 regular.

---

## 📚 Documentation

### Core Documentation

- [**Architecture**](docs/architecture.md) — System architecture and design decisions
- [**OpenAPI Spec**](docs/openapi.yaml) — OpenAPI 3.0 specification
- [**Documentation Index**](docs/index.md) — Full documentation catalog
- [**Open Core Model**](OPEN-CORE.md) — Licensing and feature boundaries

### Project Guides

- [**Contributing**](CONTRIBUTING.md) — How to contribute to the Core
- [**Engineering Conventions**](AGENTS.md) — Code style and architectural rules
- [**Trademark Policy**](TRADEMARKS.md) — Brand usage guidelines
- [**Core MIT License**](LICENSE) — Open source components

### User Manual

- [English](manual-usuario-en.md) · [Español](manual-usuario.md)
- [PDF English](manual-usuario-en.pdf) · [PDF Español](manual-usuario.pdf)
- The full set ships in **30 languages** under `docs/`: see [docs/index.md](docs/index.md).

---

## 🏗️ Architecture

```text
┌─────────────────────────────────────────────────────────┐
│              Browser / PWA / Extension                   │
│  React 19 + TypeScript + RxDB + IndexedDB + WebRTC      │
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
              • Ollama, WebLLM (local, Pro)

Cryptography: AES-GCM, Argon2id/HKDF, keys managed in Web Workers
```

### Key Architectural Principles

- **Client-first data** — Vault data lives on the client
- **End-to-end encryption** — Encryption and decryption happen client-side
- **Zero-trust model** — Server never sees unencrypted data or AI keys
- **Stateless services** — No shared database or Redis in production

---

## 🔒 Security & Privacy

### Privacy Guarantees

- **Your AI keys** are stored encrypted in your vault, never on our servers
- **Vault content** never leaves your device unencrypted
- **No tracking** — Opt-in telemetry only, no behavioral tracking
- **IP privacy** — Server logs never contain user IP addresses

### Security Measures

- **TLS termination** at reverse proxy with HTTPS redirect and HSTS
- **Content Security Policy** (CSP) with strict allow-lists
- **Secret scanning** — Automated detection of leaked secrets in commits
- **460+ automated tests** including security, crypto, and property-based tests
- **Monthly DAST** (OWASP ZAP) penetration testing
- **CodeQL + Semgrep** SAST analysis on every PR

Found a vulnerability? Please report it privately — see [SECURITY.md](.github/SECURITY.md). Please do not open public issues for security reports.

---

## 🧪 Testing & Quality

| Profile | Coverage | Command |
|---------|----------|---------|
| `test:fast` | Critical paths | `npm run test:fast` |
| `test:slow` | Full test suite | `npm run test:slow` |
| `e2e:smoke` | Critical vault operations | `npm run e2e:smoke` |
| `check` | ~50 gates + lint | `npm run check` |

- **Unit / Integration** — Vitest suites for security, DB, and services
- **E2E** — Playwright specs across Chromium, Firefox, WebKit, and Android
- **Open Core boundary** — `npm run check:open-core` verifies no Pro code leaks into this export
- **Performance budgets** — Bundle size and runtime metrics enforced per feature

---

## 📦 Self-Hosting & MIT Core

The code in this public repository is the MIT-licensed Core. You may run, study, modify and redistribute it under the terms in `LICENSE`. Proprietary Pro features and private infrastructure are intentionally excluded. The BookmarkForge name and logo remain protected by `TRADEMARKS.md`.

Running the Core for yourself or your team is permitted without payment.

### Where the Pro Code Went

Pro code is resolved two ways in this build, both enforced in CI by `npm run check:open-core`:

1. **Behind the entitlement gate.** Core components resolve the Pro services (encrypted backups, PDF/OCR extraction, P2P sync, and the proprietary AI surfaces — the local model runtime, RAG orchestration, expert agents and flashcard generation) through `src/services/pro-access.ts` (MIT), which calls `hasProAccess()` *before* fetching the Pro chunk. A Free user never downloads that code; the call rejects with a typed `ProUnavailableError` that the UI presents as a "requires Pro" state or upgrade prompt, never a silent dead button.

2. **Client-side AI boundary.** Cloud providers are called directly by the browser with a user-supplied key; no server-side AI relay or placeholder is shipped. (The AI client tree is largely Core MIT: the BYOK cloud path and the embedding engine behind free smart search are open; see `OPEN-CORE.md` for the exact Pro list.)

Reaching a Pro surface is never silent: the placeholder helper also dispatches `open-core:pro-reached`, and the loader refuses to hand out a placeholder as if it were real. Either signal opens the in-app **"Available in Pro"** panel (`ProRequiredBoundary`), which explains what happened and links to the Pro section with the current license price.

---

## 🌍 Internationalization

BookmarkForge ships **30 languages** with complete UI translations. Each language has a Markdown source and a generated PDF under `docs/`. See [`docs/index.md`](docs/index.md) for the complete list.

| Language | Markdown | PDF |
|----------|----------|-----|
| English | [manual-usuario-en.md](manual-usuario-en.md) | [manual-usuario-en.pdf](manual-usuario-en.pdf) |
| Spanish | [manual-usuario.md](manual-usuario.md) | [manual-usuario.pdf](manual-usuario.pdf) |

---

## 🤝 Contributing

Core contributions are accepted under MIT. Do not send Pro code or copy third-party code with an incompatible license.

### Getting Started

1. **Fork the repository**
   ```bash
   # Fork on GitHub, then clone your fork
   git clone https://github.com/YOUR_USERNAME/bookmarkforge-core.git
   cd bookmarkforge-core
   ```

2. **Set up your development environment**
   ```bash
   npm ci
   npm run dev
   ```

3. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```

4. **Make your changes**
   - Follow the code style defined in [`AGENTS.md`](AGENTS.md)
   - Add tests for new features
   - Update documentation as needed

5. **Run the gates**
   ```bash
   npm run typecheck:prod
   npm run lint
   npm run test:fast
   npm run check
   ```

6. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add amazing feature"
   ```

7. **Push to the branch**
   ```bash
   git push origin feature/amazing-feature
   ```

8. **Open a Pull Request**
   - Include a clear description of changes
   - Reference related issues
   - Ensure CI passes

### Code Style Guidelines

- **TypeScript:** Use strict mode, no `any` types without justification
- **Naming:** Use camelCase for variables/functions, PascalCase for classes/types
- **Comments:** Explain "why" not "what" for complex logic
- **Security:** Never commit secrets, use environment variables
- **Tests:** Write tests for new features and bug fixes

### Commit Message Format

Follow conventional commits:

```
feat: add amazing feature
fix: resolve issue with database
docs: update README with new commands
chore: update dependencies
refactor: simplify authentication flow
```

Before opening a change that crosses the Core/Pro boundary, document the decision and update the export gate. See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md).

### Areas Where We Need Help

- 🌍 **Translations** — Help translate the UI to more languages
- 🧪 **Tests** — Add more test coverage for edge cases
- 📚 **Documentation** — Improve guides and add examples
- 🐛 **Bug fixes** — Help squash bugs reported in issues
- ✨ **Features** — Propose and implement new Core features

---

## 🗺️ Roadmap

### Current Version (v1.0.0)

- ✅ Core MIT release
- ✅ Local-first encrypted vault
- ✅ Multi-provider AI integration (BYOK)
- ✅ Smart search with semantic embeddings
- ✅ Import/Export for multiple formats
- ✅ PWA support with browser extensions
- ✅ 30 language support

### Planned Features

#### v1.1.0 (Q1 2026)
- [ ] Enhanced mobile experience
- [ ] Improved search algorithm
- [ ] Additional import formats
- [ ] Performance optimizations

#### v1.2.0 (Q2 2026)
- [ ] Advanced knowledge graph visualization
- [ ] Enhanced AI-powered insights
- [ ] Offline-first improvements
- [ ] Better collaboration features

#### v2.0.0 (Q3 2026)
- [ ] Major architecture improvements
- [ ] New UI/UX redesign
- [ ] Enhanced security features
- [ ] Extended API for third-party integrations

*Note: Pro features (P2P sync, encrypted backups, PDF/OCR, flashcards, local AI) are developed in the private repository and are not part of this roadmap.*

---

## 📸 Screenshots

### Main Interface

<!-- Add screenshots here when available -->
*Screenshot placeholder: Main knowledge vault interface*

### AI-Powered Search

<!-- Add screenshots here when available -->
*Screenshot placeholder: Smart search results*

### Knowledge Graph

<!-- Add screenshots here when available -->
*Screenshot placeholder: Interactive knowledge graph*

---

## ⚡ Performance

### Benchmarks

| Metric | Target | Current |
|--------|--------|---------|
| Initial load | < 2s | ~1.5s |
| Time to interactive | < 3s | ~2.2s |
| Bundle size (gzipped) | < 500KB | ~450KB |
| Vault unlock time | < 1s | ~0.8s |
| Search latency | < 100ms | ~80ms |

### Optimization Strategies

- **Code splitting** — Routes and features loaded on demand
- **Tree shaking** — Unused code eliminated from bundle
- **Lazy loading** — Heavy components loaded when needed
- **Caching** — Service Worker for offline access
- **Compression** — Brotli compression for production builds

---

## 🙏 Acknowledgments

### Core Technologies

- **React** — UI framework
- **TypeScript** — Type safety
- **Vite** — Build tool
- **RxDB** — Database layer
- **IndexedDB** — Browser storage
- **WebCrypto** — Cryptographic operations
- **Playwright** — E2E testing
- **Vitest** — Unit testing

### AI Providers

- **Gemini** — Google's AI
- **OpenAI** — GPT models
- **Anthropic** — Claude models
- **Groq** — Fast inference
- **Hugging Face** — Open models
- **OpenRouter** — Multi-provider API

### Security

- **OWASP** — Security best practices
- **WebCrypto API** — Browser cryptography
- **Argon2id** — Password hashing

---

## 🎯 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=bookmarkforge/bookmarkforge-core&type=Date)](https://star-history.com/#bookmarkforge/bookmarkforge-core&Date)

---

## 📜 License

---

## �️ Troubleshooting

### Common Issues

#### Build Errors

**Problem:** `npm run build` fails with "Module not found" errors.

**Solution:**
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm ci
```

**Problem:** TypeScript compilation errors after pulling latest changes.

**Solution:**
```bash
# Ensure you're on the latest main branch
git pull origin main
npm ci
npm run typecheck:prod
```

#### Development Server Issues

**Problem:** Dev server fails to start with "Port 5173 already in use".

**Solution:**
```bash
# Kill the process using port 5173
# On Linux/Mac:
lsof -ti:5173 | xargs kill -9

# On Windows:
netstat -ano | findstr :5173
taskkill /PID <PID> /F

# Or use a different port
npm run dev -- --port 5174
```

**Problem:** Changes not reflecting in browser (hot reload not working).

**Solution:**
```bash
# Clear Vite cache
rm -rf .vite
npm run dev
```

#### Database Issues

**Problem:** IndexedDB errors or corrupted database.

**Solution:**
```bash
# Clear browser data for localhost
# 1. Open DevTools (F12)
# 2. Go to Application tab
# 3. Clear Storage → Clear site data
# 4. Refresh the page
```

**Problem:** RxDB sync errors.

**Solution:**
```bash
# Check that the database is not locked in another tab
# Close all other tabs running the app
# Refresh the page
```

#### Test Failures

**Problem:** Tests fail with "Database already open" errors.

**Solution:**
```bash
# Clear test databases
rm -rf test-results
npm run test:fast
```

**Problem:** E2E tests fail with "Timeout" errors.

**Solution:**
```bash
# Increase timeout for slow runners
export E2E_TIMEOUT_MULTIPLIER=2
npm run e2e:smoke
```

#### AI Provider Issues

**Problem:** AI API calls fail with "Invalid API key" errors.

**Solution:**
```bash
# Verify your API key is correct
# 1. Open Settings → AI Providers
# 2. Check that the API key is properly stored
# 3. Ensure the key has not expired
# 4. Test the key directly with the provider's API
```

**Problem:** AI responses are slow or timeout.

**Solution:**
```bash
# Check your network connection
# Try a different AI provider
# Check the provider's status page for outages
```

### Getting Help

If you encounter an issue not listed here:

1. **Check the documentation** — See the [documentation index](docs/index.md)
2. **Search existing issues** — Check [GitHub Issues](https://github.com/bookmarkforge/bookmarkforge/issues)
3. **Create a new issue** — Include:
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Environment (OS, browser, version)
   - Screenshots if applicable
4. **Join discussions** — Ask questions in [GitHub Discussions](https://github.com/bookmarkforge/bookmarkforge/discussions)

### Reporting Security Issues

**Do not open public issues for security reports.**

Report vulnerabilities privately via [SECURITY.md](.github/SECURITY.md) or email security@bookmarkforgeapp.com.

---

## 📞 Support

## 📜 License

Copyright © 2026 BookmarkForge

This Core is free software: you can redistribute and/or modify it under the terms of the MIT License in `LICENSE`.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

---

<div align="center">

**BookmarkForge v1.0.0 — Open Core: MIT Core + proprietary Pro**

[⬆ Back to top](#bookmarkforge)

</div>
