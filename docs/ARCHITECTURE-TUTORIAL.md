# BookmarkForge Architecture Tutorial

## Welcome to BookmarkForge

This tutorial will help you understand the architecture of BookmarkForge and get you up to speed with the codebase quickly. BookmarkForge is a sophisticated local-first, privacy-preserving AI knowledge vault built with React, TypeScript, and advanced cryptographic security.

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Core Concepts](#core-concepts)
3. [Project Structure](#project-structure)
4. [Key Technologies](#key-technologies)
5. [Data Flow](#data-flow)
6. [Security Architecture](#security-architecture)
7. [Development Workflow](#development-workflow)
8. [Common Tasks](#common-tasks)
9. [Testing](#testing)
10. [Troubleshooting](#troubleshooting)

## High-Level Architecture

### Application Structure

```
┌─────────────────────────────────────────────────────────┐
│                    Browser / PWA                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │           React Frontend (TypeScript)             │  │
│  │  ┌────────────────────────────────────────────┐  │  │
│  │  │  Components (UI layer)                     │  │  │
│  │  │  - MainApp, Header, Sidebar, etc.          │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────┐  │  │
│  │  │  Services (Business logic)                 │  │  │
│  │  │  - EncryptionService, SecurityVault, etc.  │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────┐  │  │
│  │  │  Data Layer (RxDB + IndexedDB)            │  │  │
│  │  │  - Encrypted local storage                 │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────┐  │  │
│  │  │  Crypto Workers (Web Workers)              │  │  │
│  │  │  - AES-GCM encryption, Argon2id KDF       │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  Direct AI Provider Calls (BYOK)                        │
│  - OpenAI, Anthropic, Gemini, Groq, etc.                │
│  - Keys stored encrypted in user's vault                │
└─────────────────────────────────────────────────────────┘
                            ↕ HTTPS
┌─────────────────────────────────────────────────────────┐
│              Companion Server (Node.js)                 │
│  - WebSocket signaling (P2P sync)                        │
│  - License validation (Ed25519/RSA-PSS)                 │
│  - Health checks, CSP reports, telemetry                 │
│  - NO AI proxy - calls go direct from browser            │
└─────────────────────────────────────────────────────────┘
```

### Trust Boundaries

1. **Browser Vault**: Unlocked vault data exists only while session is active
2. **Signaling Server**: Not trusted for vault confidentiality (relay only)
3. **AI Providers**: Third-party, user's encrypted keys used directly
4. **Companion Server**: No shared state, stateless HTTP + signaling

## Core Concepts

### Local-First Architecture

BookmarkForge is designed to work primarily offline:
- All data stored locally in encrypted IndexedDB
- Optional P2P sync via WebRTC (server only relays encrypted traffic)
- AI features work offline with local models (WebLLM, Ollama)
- No server-side database or session state

### Open Core Model

The project uses an Open Core licensing model:
- **Core (MIT)**: Basic vault, CRUD, search, security, UI
- **Pro (Proprietary)**: Advanced AI, RAG, P2P sync, flashcards, PDF/OCR

**Key Boundary**: `src/services/pro-access.ts` gates Pro features at runtime.

### Zero-Knowledge Vault

User data is encrypted with user's master password:
- 24-word recovery phrase for backup
- Tamper detection via integrity checks
- Fail-closed storage (errors don't expose data)
- Per-vault random salts prevent cross-vault attacks

## Project Structure

### Directory Layout

```
src/
├── components/          # React components
│   ├── app/             # Main app components (MainApp, etc.)
│   ├── bookmarks/       # Bookmark-related UI
│   ├── ai/              # AI features and panels
│   └── ...
├── services/            # Business logic services
│   ├── EncryptionService.ts
│   ├── SecurityVault.ts
│   ├── ai/              # AI provider adapters
│   └── security-vault/  # Modular security components
├── db/                  # Database layer (RxDB)
│   ├── database.ts      # Database initialization
│   ├── schema.ts        # Data schemas
│   └── ...
├── workers/             # Web Workers
│   └── crypto.worker.ts # Crypto operations
├── utils/               # Utility functions
│   ├── crypto-core.ts   # Pure crypto primitives
│   ├── argon2-kdf.ts    # Key derivation
│   └── ...
├── hooks/               # React hooks
├── contexts/            # React contexts
├── store/               # State management (Zustand)
├── types/               # TypeScript types
└── tests/               # Unit tests
```

### Key Files to Understand

1. **`src/App.tsx`**: Application entry point
2. **`src/components/app/MainApp.tsx`**: Main app container (now refactored)
3. **`src/services/EncryptionService.ts`**: Encryption orchestration
4. **`src/utils/crypto-core.ts`**: Core crypto primitives
5. **`src/db/database.ts`**: Database initialization and lifecycle
6. **`src/services/SecurityVault.ts`**: Master password management

## Key Technologies

### Frontend Stack

- **React 19**: UI framework with concurrent features
- **TypeScript**: Type safety and better DX
- **Vite 8**: Build tool and dev server
- **RxDB 17**: Reactive database over IndexedDB
- **Mantine**: UI component library
- **Tailwind CSS**: Utility-first styling

### Crypto Stack

- **Web Crypto API**: Browser-native cryptography
- **AES-256-GCM**: Symmetric encryption
- **Argon2id**: Password-based key derivation
- **HKDF-SHA256**: Key derivation for session keys
- **Ed25519**: Digital signatures (license validation)

### Testing Stack

- **Vitest**: Unit and integration tests
- **Playwright**: E2E testing
- **React Testing Library**: Component testing

## Data Flow

### Vault Unlock Flow

```
User enters password
    ↓
SecurityVault.unlock(password)
    ↓
Argon2id KDF (per-vault salt)
    ↓
Master key derived
    ↓
Session key cache populated
    ↓
Database unlocked with encryption key
    ↓
UI renders vault content
```

### Data Encryption Flow

```
User saves bookmark
    ↓
BookmarkAIService processes
    ↓
EncryptionService.encrypt(data, password)
    ↓
Web Worker receives request
    ↓
HKDF derives session key
    ↓
AES-GCM encrypts data
    ↓
Encrypted data stored in IndexedDB
    ↓
Password bytes zeroized
```

### AI Request Flow

```
User requests AI summary
    ↓
AIManager processes request
    ↓
Provider adapter (OpenAI, Gemini, etc.)
    ↓
User's encrypted API key retrieved
    ↓
Direct browser-to-provider call
    ↓
Response processed and stored
    ↓
No server-side proxy involved
```

## Security Architecture

### Encryption Layers

1. **Transport Layer**: HTTPS/TLS for all network calls
2. **Storage Layer**: AES-256-GCM encrypted IndexedDB
3. **Memory Layer**: Keys isolated in Web Workers
4. **Session Layer**: Auto-lock with timeout
5. **Integrity Layer**: HMAC verification for critical tokens

### Key Management

- **Master Password**: User's main secret, never stored
- **Device Key**: Per-device key, split between localStorage + IndexedDB
- **Session Keys**: Cached derived keys, cleared on lock
- **API Keys**: User's provider keys, encrypted in vault

### Access Control

- **Rate Limiting**: Failed unlock attempts with lockout
- **Caller Registration**: Only registered callers can access password bytes
- **Least Privilege**: Components access only needed data
- **Audit Logging**: Security events logged locally

## Development Workflow

### Getting Started

```bash
# Install dependencies
npm ci

# Setup environment
cp .env.example .env

# Run development server
npm run dev

# Run type checking
npm run typecheck:prod

# Run linting
npm run lint

# Run fast tests
npm run test:fast
```

### Pre-Commit Workflow

Before committing, run:

```bash
npm run ci:local
```

This runs:
- Type checking
- Linting
- Fast tests
- Build verification
- Full check suite (~50 checks)

### Branch Protection

The `main` branch requires:
- `Enforce mandatory security gates`
- `Typecheck, lint, tests and security gates`
- `Playwright E2E`

### Testing Strategy

1. **Unit Tests**: Fast, focused on individual functions
2. **Integration Tests**: Test service interactions
3. **E2E Tests**: Full user flows with Playwright
4. **Security Tests**: Adversarial testing, fuzzing
5. **Regression Tests**: Pinned by audit anchors

## Common Tasks

### Adding a New Component

1. Create component in appropriate directory
2. Follow existing patterns and naming conventions
3. Add TypeScript types
4. Include unit tests
5. Update i18n files for user-facing strings
6. Run linting and type checking

### Adding a New Service

1. Create service in `src/services/`
2. Implement business logic
3. Add error handling with `INTENTIONAL SILENCE` comments
4. Use logger for structured logging
5. Add comprehensive tests
6. Update AGENTS.md if security-related

### Modifying Crypto Code

1. **Read CRYPTO-PATTERNS.md** first
2. Understand the security implications
3. Add regression tests with audit anchors
4. Update ADR documentation
5. Run security gates
6. Get security review if significant change

### Adding a New AI Provider

1. Create adapter in `src/services/ai/providers/`
2. Implement provider interface
3. Add error handling for provider-specific responses
4. Add tests with mock server
5. Update i18n for error messages
6. Test with real API key (locally)

## Testing

### Running Tests

```bash
# Fast tests (security, db, services)
npm run test:fast

# All tests
npm test

# E2E tests
npm run e2e

# E2E with UI mode
npm run e2e:ui

# Coverage report
npm run test:coverage
```

### Writing Tests

1. **Unit Tests**: Test pure functions and services
2. **Component Tests**: Use React Testing Library
3. **E2E Tests**: Use Playwright, test user flows
4. **Security Tests**: Test adversarial scenarios
5. **Performance Tests**: Test with large datasets

### Test Organization

- `src/tests/`: Unit/integration tests by area
- `tests/e2e/`: E2E test specs
- `src/tests/security/`: Security regression tests
- `src/tests/human-like/`: Human-behavior tests

## Troubleshooting

### Common Issues

**Vault won't unlock**:
- Verify password is correct
- Check per-vault salt exists
- Validate device key separation
- Test with backup recovery

**Crypto worker fails**:
- Check worker initialization logs
- Verify worker file exists
- Test with main-thread fallback
- Monitor memory usage

**Tests fail intermittently**:
- Check for timing issues (Argon2id slow on CI)
- Increase test timeouts with `E2E_TIMEOUT_MULTIPLIER`
- Verify test isolation
- Check for race conditions

**Build fails**:
- Check Node.js version (>=24.17.0)
- Verify dependencies are installed
- Check environment variables
- Run `npm run check` for specific issues

### Debugging Tools

1. **React DevTools**: Component inspection
2. **RxDB DevMode**: Database inspection (dev only)
3. **Browser DevTools**: Network, console, storage
4. **Playwright Inspector**: E2E test debugging
5. **Vitest UI**: Test debugging

### Performance Issues

**Slow vault unlock**:
- Check Argon2id parameters
- Verify Web Worker is used
- Monitor memory pressure
- Consider reducing vault size

**Slow AI responses**:
- Check provider API status
- Verify network connectivity
- Consider local models (WebLLM, Ollama)
- Monitor token usage

**Large bundle size**:
- Check lazy loading is working
- Verify code splitting
- Run bundle analysis
- Consider removing unused dependencies

## Advanced Topics

### Open Core Boundary

The Pro/Core boundary is enforced at:
- **Compile time**: `scripts/export-public-repo.mjs`
- **Runtime**: `src/services/pro-access.ts`
- **CI**: `npm run check:open-core`

Pro features are:
- Local AI (WebLLM, RAG, agents)
- P2P sync
- Flashcards
- PDF/OCR
- Advanced backups

### Custom Hooks

Key hooks to understand:
- `useMainAppState`: Main app state management
- `useTabManager`: Tab navigation
- `useAIStatus`: AI service status
- `useMemoryPressure`: Memory monitoring
- `useAppLifecycle`: App lifecycle management

### Layer Rules

Enforced by `npm run check:boundaries`:
- `components` must NOT import `workers`, `memory`, or `db` directly
- `workers` must NOT import `components` or `memory`
- `memory` must NOT import `components` or `workers`
- `hooks` must NOT import `components`

### Error Handling

Follow the `INTENTIONAL SILENCE` pattern:
```typescript
try {
  // operation
} catch (error) {
  /* INTENTIONAL SILENCE: <precise reason> */
  logger.error("Operation failed", { error: safeErrorForLog(error) });
}
```

## Resources

### Documentation

- `AGENTS.md`: Engineering conventions (MANDATORY reading)
- `OPEN-CORE.md`: Open Core model explanation
- `docs/architecture.md`: Detailed architecture
- `docs/security.md`: Security documentation
- `docs/CRYPTO-PATTERNS.md`: Crypto maintenance guide
- `README.md`: Project overview

### ADRs (Architecture Decision Records)

Located in `docs/ADR-*.md`:
- `ADR-001`: Static brand checking
- `ADR-019`: Argon2id migration
- `ADR-039`: Bundle integrity verification
- `ADR-046`: Per-vault salt strategy
- `ADR-052`: V5 format sunset proposal
- `ADR-055`: Dashboard banner CLS optimization
- `ADR-058`: Release target enforcement

### Scripts

- `scripts/README.md`: Complete tool catalog (168 scripts)
- `scripts/build-ci.mjs`: Production build pipeline
- `scripts/check-*.mjs`: Various validation scripts

## Getting Help

### Internal Resources

- Check existing ADRs for context
- Review audit reports in `docs/audit.md`
- Consult AGENTS.md for conventions
- Search codebase for similar patterns

### External Resources

- [React Documentation](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [RxDB Documentation](https://rxdb.info)
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [Playwright Documentation](https://playwright.dev)

## Practical Examples

### Example 1: Adding a New Bookmark with AI Summary

```typescript
import { bookmarkAIService } from "../services/BookmarkAIService";
import { useBookmarkCRUD } from "../hooks/useBookmarkCRUD";

function BookmarkForm() {
  const { createBookmark } = useBookmarkCRUD();
  const { t } = useTranslation();

  const handleAddBookmark = async (url: string) => {
    try {
      // Create bookmark entry
      const bookmark = await createBookmark({
        url,
        title: url,
        content: "",
        tags: [],
      });

      // Generate AI summary
      await bookmarkAIService.generateDetailedContent(
        bookmark,
        t,
        aiManager,
      );

      // Success - UI will update via RxDB subscription
    } catch (error) {
      logger.error("Failed to add bookmark", { error });
    }
  };

  return <button onClick={() => handleAddBookmark("https://example.com")}>
    Add Bookmark
  </button>;
}
```

### Example 2: Handling Vault Lock/Unlock

```typescript
import { securityVault } from "../services/SecurityVault";
import { zeroPasswordBytes } from "../utils/crypto-core";

async function unlockVault(password: string) {
  // Convert password to bytes (NOT string)
  const passwordBytes = new TextEncoder().encode(password);

  try {
    await securityVault.unlock(passwordBytes);
    // Vault is now unlocked - keys are in memory
  } finally {
    // CRITICAL: Zeroize password bytes after use
    zeroPasswordBytes(passwordBytes);
  }
}

async function withSecureOperation<T>(
  operation: (passwordBytes: Uint8Array) => Promise<T>
): Promise<T> {
  return securityVault.withMasterPasswordBytes(
    "MyCaller",
    async (passwordBytes) => {
      try {
        return await operation(passwordBytes);
      } finally {
        // CRITICAL: Zeroize caller-owned copy
        zeroPasswordBytes(passwordBytes);
      }
    }
  );
}
```

### Example 3: Querying Bookmarks with RxDB

```typescript
import { bookmarkStore } from "../store/bookmarkStore";

function BookmarkList() {
  const bookmarks = bookmarkStore.useQuery(
    (collection) => collection.find({
      selector: {
        isDeleted: false,
        isPrivate: false,
      },
      sort: [{ updatedAt: "desc" }],
    })
  );

  return (
    <ul>
      {bookmarks.map((bookmark) => (
        <li key={bookmark.id}>{bookmark.title}</li>
      ))}
    </ul>
  );
}
```

### Example 4: Adding AI Provider Configuration

```typescript
import { providerConfiguration } from "../services/ai/ProviderConfiguration";

async function configureOpenAIProvider(apiKey: string) {
  // Store encrypted provider key in vault
  await providerConfiguration.setProvider("openai", {
    apiKey,
    model: "gpt-4",
  });

  // Provider is now available for AI operations
}
```

### Example 5: Testing with SecurityVault Mock

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSecurityVault } from "../tests/services/security-vault/mock";

describe("MyService", () => {
  let mockVault: ReturnType<typeof createMockSecurityVault>;

  beforeEach(() => {
    mockVault = createMockSecurityVault();
  });

  it("should handle vault lock/unlock correctly", async () => {
    // Mock lock/unlock lifecycle
    await mockVault.unlock(new Uint8Array([1, 2, 3]));
    expect(mockVault.isUnlocked).toBe(true);

    await mockVault.lock();
    expect(mockVault.isUnlocked).toBe(false);
  });
});
```

### Example 6: Creating a Custom Hook

```typescript
import { useState, useEffect, useCallback } from "react";
import { useSecurityVault } from "../contexts/SecurityVaultContext";

export function useVaultState() {
  const vault = useSecurityVault();
  const [isUnlocked, setIsUnlocked] = useState(false);

  useEffect(() => {
    // Subscribe to vault lock state changes
    const subscription = vault.subscribe((state) => {
      setIsUnlocked(state.isUnlocked);
    });

    return () => subscription.unsubscribe();
  }, [vault]);

  const unlock = useCallback(async (password: string) => {
    const passwordBytes = new TextEncoder().encode(password);
    try {
      await vault.unlock(passwordBytes);
    } finally {
      zeroPasswordBytes(passwordBytes);
    }
  }, [vault]);

  return { isUnlocked, unlock };
}
```

### Example 7: Adding a New Component with Theme Support

```typescript
import { useTheme } from "../contexts/ThemeContext";

function MyComponent() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark" || (theme === "system" && prefersDark());

  return (
    <div className={isDark ? "dark-mode" : "light-mode"}>
      <button onClick={() => setTheme("dark")}>
        Switch to Dark Mode
      </button>
    </div>
  );
}
```

### Example 8: Handling Error Boundaries

```typescript
import { Component, ErrorInfo, ReactNode } from "react";
import { logger } from "../utils/logger";

class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("Route error boundary caught", {
      error: error.message,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return <div>Something went wrong. Please refresh.</div>;
    }

    return this.props.children;
  }
}
```

### Example 9: Creating a Service Worker Cache Strategy

```typescript
// In service worker
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Cache strategy for API calls
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      caches.open("api-cache").then((cache) => {
        return cache.match(event.request).then((response) => {
          if (response) {
            return response;
          }
          return fetch(event.request).then((networkResponse) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
  }
});
```

### Example 10: Adding Internationalization

```typescript
import { useTranslation } from "react-i18next";

function SettingsPanel() {
  const { t } = useTranslation();

  return (
    <div>
      <h1>{t("settings_title")}</h1>
      <button>{t("settings_save")}</button>
    </div>
  );
}

// In locales/en.json:
// {
//   "settings_title": "Settings",
//   "settings_save": "Save"
// }
```

## Next Steps

1. **Read AGENTS.md**: Understand engineering conventions
2. **Explore the codebase**: Start with components you're interested in
3. **Run the tests**: Familiarize yourself with test patterns
4. **Make a small change**: Fix a bug or add a simple feature
5. **Contribute**: Follow CONTRIBUTING.md guidelines

## Conclusion

BookmarkForge is a sophisticated project with strong security practices. Take time to understand the architecture before making changes, especially in security-critical areas. The documentation and code comments are extensive—use them!

Happy coding! 🚀