# BookmarkForge Core Architecture

This document describes the architecture of the MIT-licensed Core.

## System Overview

BookmarkForge Core is a local-first, client-side application with optional companion server services.

```
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

## Core Components

### Client-Side (Browser)

#### 1. Application Shell
- **Entry Point:** `app.html` (Vite HTML entry)
- **Framework:** React 19 with TypeScript
- **Build Tool:** Vite 8
- **State Management:** Zustand
- **Database:** RxDB 17 over IndexedDB

#### 2. Database Layer
- **ORM:** RxDB (Reactive Database)
- **Storage:** IndexedDB (browser-native)
- **Collections:**
  - `bookmarks` - User bookmarks
  - `notes` - Rich text notes
  - `tags` - Tag system
  - `vault_metadata` - Vault settings

#### 3. Cryptography
- **Encryption:** AES-256-GCM
- **Key Derivation:** Argon2id + HKDF
- **Key Management:** Web Workers
- **Zeroization:** Password buffers cleared after use

#### 4. AI Integration (Core)
- **Providers:** Gemini, OpenAI, Anthropic, Groq, Hugging Face, OpenRouter
- **Model:** BYO keys (user provides their own API keys)
- **Calls:** Direct browser-to-provider (no proxy)
- **Embeddings:** Voyage Search (semantic search engine)

#### 5. Pro Access Boundary
- **File:** `src/services/pro-access.ts`
- **Purpose:** Gate for Pro features
- **Behavior:** Checks license before loading Pro chunks
- **Error:** `ProUnavailableError` for Free users

### Server-Side (Companion)

#### 1. License Server
- **Endpoints:** `/api/license/*`
- **Purpose:** License validation
- **Method:** Browser-side validation with signed license
- **Credential:** RSA-PSS signing key (mounted as Compose secret)

#### 2. P2P Signaling Server
- **Protocol:** WebSocket
- **Purpose:** WebRTC signaling for P2P sync (Pro)
- **Privacy:** Relays encrypted traffic only, never content

#### 3. Health & Telemetry
- **Health Endpoint:** `/health`
- **CSP Reports:** `/api/csp-report`
- **Telemetry:** Opt-in only, no behavioral tracking

## Key Architectural Principles

### 1. Client-First Data
- Vault data lives on the client (IndexedDB)
- Server is stateless (no shared database)
- No server-side access to vault content

### 2. End-to-End Encryption
- Encryption/decryption happens client-side
- Server never sees unencrypted data
- AI keys stored encrypted in vault

### 3. Zero-Trust Model
- Server never trusts client data implicitly
- All sensitive operations use attestation
- License validation is client-side with signed keys

### 4. Stateless Services
- No Redis or shared database in production
- Services are horizontally scalable
- Session state is client-managed

## Data Flow

### Bookmark Creation Flow

```
User Input → React Component → Zustand Store → RxDB → IndexedDB
                                      ↓
                                 Encrypt (Worker)
```

### AI Search Flow

```
User Query → React Component → Embedding Engine → AI Provider (BYO key)
                                      ↓
                                 Decrypt Vault Keys (Worker)
```

### Pro Feature Access Flow

```
User Action → pro-access.ts → hasProAccess() → License Check
                           ↓
                    Pro Chunk Load (if license valid)
                           ↓
              ProUnavailableError (if Free user)
```

## Security Model

### Client-Side Security
- **Content Security Policy (CSP):** Strict allow-lists
- **Subresource Integrity (SRI):** SHA-256 hashes for scripts
- **Service Worker Integrity:** Hash verification before serving
- **Buffer Zeroization:** Passwords cleared from memory

### Server-Side Security
- **TLS Only:** HTTPS redirect with HSTS
- **IP Privacy:** No user IPs in logs
- **Secret Scanning:** Automated detection in CI
- **License Key:** Only credential, mounted as Compose secret

## Open Core Boundary

### What's Included in Core (MIT)
- Bookmark management
- Note-taking with rich text
- Tag system
- Smart search (Fuse.js + semantic embeddings)
- BYO AI provider integration
- Client-side cryptography
- Basic PWA functionality

### What's Pro (Proprietary)
- Encrypted backups
- PDF/OCR extraction
- P2P device sync
- Local AI model runtime (WebLLM)
- RAG orchestration
- Expert agents
- Flashcard generation

### Boundary Enforcement
- **Gate:** `npm run check:open-core`
- **Placeholder System:** Inert modules for Pro code
- **Runtime Check:** `hasProAccess()` before Pro chunk load
- **Export Script:** `export-public-repo.mjs` generates public tree

## Technology Stack

### Frontend
- **Framework:** React 19
- **Language:** TypeScript 5.9
- **Build:** Vite 8
- **Database:** RxDB 17
- **Storage:** IndexedDB
- **State:** Zustand
- **UI:** Mantine 9
- **Editor:** BlockNote 0.52

### Backend
- **Runtime:** Node.js 24+
- **Framework:** Native Node.js (ws server)
- **Protocol:** WebSocket
- **License:** RSA-PSS (SHA-256)

### Testing
- **Unit:** Vitest
- **E2E:** Playwright
- **Property-Based:** fast-check
- **Coverage:** 460+ tests

## Deployment Topology

### Production
```
User Browser → CDN/Reverse Proxy → Static Files (Vite build)
                                  → Companion Server (Docker)
```

### Self-Hosting
- **Static Files:** Any static file server (nginx, Apache, Caddy)
- **Companion Server:** Docker Compose
- **Database:** None (client-side IndexedDB)

## Performance Considerations

### Bundle Size
- **Split Code:** Core vs Pro chunks
- **Lazy Loading:** Pro features loaded on demand
- **Tree Shaking:** Unused code eliminated
- **Budgets:** Enforced per feature

### Runtime Performance
- **Web Workers:** Crypto operations off main thread
- **IndexedDB:** Async database operations
- **RxDB:** Reactive queries with efficient diffing

## Monitoring & Observability

### Client-Side
- **Sentry:** Opt-in error reporting
- **Performance:** Web Vitals collection
- **Integrity:** Bundle hash verification

### Server-Side
- **Health Checks:** `/health` endpoint
- **CSP Reports:** Malicious attempt tracking
- **Telemetry:** Opt-in usage analytics

## Related Documentation

- [Security Model](security.md) - Detailed security practices
- [API Reference](api.md) - Companion server API
- [Open Core Model](../OPEN-CORE.md) - Licensing and feature boundaries
- [README](../README.md) - Project overview and quick start
