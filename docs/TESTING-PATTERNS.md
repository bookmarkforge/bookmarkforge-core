# Testing Patterns Guide

This guide documents the specific testing patterns and conventions used in BookmarkForge. Understanding these patterns is essential for writing effective tests that pass CI gates and maintain security standards.

## Table of Contents

1. [Test Profiles](#test-profiles)
2. [Test Organization](#test-organization)
3. [Unit/Integration Testing](#unitintegration-testing)
4. [E2E Testing](#e2e-testing)
5. [Security Testing](#security-testing)
6. [Mock Patterns](#mock-patterns)
7. [Test Timing](#test-timing)
8. [Coverage Requirements](#coverage-requirements)
9. [Common Patterns](#common-patterns)

---

## Test Profiles

BookmarkForge uses bounded test profiles to control test execution time and CI resource usage.

### Fast Profile (~5 seconds)

The fast profile covers critical areas and smoke tests:

```bash
npm run test:fast
```

**Includes:**
- Security tests (crypto, vault, integrity)
- Database initialization and core operations
- Critical services (AI, bookmarks, encryption)
- Key components that are frequently touched

**Purpose:** Quick feedback during development. Files in this profile must complete in ≤5 seconds.

### Slow Profile (~10 seconds per file)

The slow profile covers the remaining test suite:

```bash
npm run test:slow
# or simply
npm test
```

**Includes:**
- Component tests
- Integration tests
- Less critical services
- Edge case coverage

**Purpose:** Comprehensive coverage before merge. Files in this profile must complete in ≤10 seconds.

### Watch Mode

For live development feedback:

```bash
npm run test:fast:watch
```

Re-runs only the fast-profile tests affected by the file you save.

---

## Test Organization

### Directory Structure

```
src/tests/
├── security/           # Security and crypto tests
├── services/           # Service layer tests
├── components/         # Component tests
├── hooks/              # Hook tests
├── utils/              # Utility function tests
├── store/              # Zustand store tests
└── scripts/            # Script tests

tests/e2e/
├── browsers/           # Browser-level E2E tests
├── multiuser/          # Multi-user P2P tests
├── nightly/            # Nightly regression tests
└── human-like/         # Human-like interaction tests
```

### Naming Conventions

- Unit tests: `*.test.ts` or `*.test.tsx`
- Integration tests: `*.integration.test.ts`
- Regression tests: `*.regression.test.ts`
- Fuzz tests: `*.fuzz.test.ts`
- E2E specs: `*.spec.ts`

---

## Unit/Integration Testing

### Basic Pattern

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { myService } from "../services/MyService";

describe("MyService", () => {
  beforeEach(() => {
    // Reset state before each test
    vi.clearAllMocks();
  });

  it("should perform operation correctly", async () => {
    const result = await myService.doSomething("input");
    expect(result).toBe("expected output");
  });
});
```

### Error Handling Pattern

```typescript
it("should handle errors gracefully", async () => {
  await expect(myService.doSomething("invalid"))
    .rejects.toThrow("Expected error message");
});
```

### INTENTIONAL SILENCE Pattern

```typescript
it("should not crash on invalid input", async () => {
  try {
    await myService.handleInvalidInput(null);
  } catch {
    /* INTENTIONAL SILENCE: error is logged but not propagated */
  }
  // Verify state is still valid
  expect(myService.isHealthy()).toBe(true);
});
```

### Async/Await Pattern

```typescript
it("should handle async operations", async () => {
  const promise = myService.asyncOperation();
  await expect(promise).resolves.toBe("result");
});
```

---

## E2E Testing

### Fixture Fidelity (MANDATORY)

E2E fixtures must reach the surface by clicking controls and writing state, not by bypassing UI. This ensures tests can be neutralized and still pass.

```typescript
import { test, expect } from "@playwright/test";

test("should add bookmark", async ({ page }) => {
  // ✅ CORRECT: Click through UI
  await page.click('[data-testid="add-bookmark-button"]');
  await page.fill('[data-testid="bookmark-url"]', "https://example.com");
  await page.click('[data-testid="save-button"]');

  // ❌ WRONG: Direct database manipulation
  // await db.bookmarks.insert({ url: "https://example.com" });
});
```

### Fixture Neutralization

Tests that touch registered surfaces must preserve them or declare a waiver:

```typescript
test("should not interfere with onboarding", async ({ page }) => {
  // Preserve onboarding through the test
  await setupVault(page, { dismissOnboarding: false });

  // ... test logic ...

  // Onboarding is still intact for assertion
  await expect(page.locator('[data-testid="onboarding"]')).toBeVisible();
});
```

### Waiver Pattern

```typescript
// fixture-neutralization-waiver: onboarding — test specifically validates onboarding flow
test("should dismiss onboarding correctly", async ({ page }) => {
  await setupVault(page, { dismissOnboarding: true });

  // Test specifically targets onboarding dismissal
  await page.click('[data-testid="dismiss-onboarding"]');
  await expect(page.locator('[data-testid="onboarding"]')).not.toBeVisible();
});
```

### Custom Provider E2E

For provider wiring tests, use the custom provider suite:

```bash
npm run e2e:custom-provider
```

This suite drives the Custom (OpenAI-format) provider through the real Settings path against a mock server.

---

## Security Testing

### Adversarial Testing (Not Happy Path)

Security tests must exercise adversarial behavior:

```typescript
describe("crypto security", () => {
  it("should reject malformed ciphertext", async () => {
    const invalidCiphertext = "not-valid-base64";
    await expect(decrypt(invalidCiphertext, key))
      .rejects.toThrow();
  });

  it("should not reuse nonce for encryption", async () => {
    const plaintext = "test data";
    const encrypted1 = await encrypt(plaintext, key);
    const encrypted2 = await encrypt(plaintext, key);

    // Ciphertexts should differ due to random nonce
    expect(encrypted1).not.toBe(encrypted2);
  });
});
```

### Property Testing with fast-check

```typescript
import fc from "fast-check";

it("should handle arbitrary passwords correctly", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), async (password) => {
      const result = await validatePassword(password);
      // Property must hold for all inputs
      expect(result.isValid).toBe(result.strength > 0);
    })
  );
});
```

### SecurityVault Mock Pattern

```typescript
import { createMockSecurityVault } from "../tests/services/security-vault/mock";

describe("MyService", () => {
  let mockVault: ReturnType<typeof createMockSecurityVault>;

  beforeEach(() => {
    mockVault = createMockSecurityVault();
  });

  it("should require lock/unlock symmetry", async () => {
    // CRITICAL: Must unlock before operations
    await mockVault.unlock(new Uint8Array([1, 2, 3]));
    expect(mockVault.isUnlocked).toBe(true);

    // Perform operation
    await myService.secureOperation();

    // CRITICAL: Must lock after operations
    await mockVault.lock();
    expect(mockVault.isUnlocked).toBe(false);
  });
});
```

### Crypto Buffer Testing

```typescript
it("should zeroize password after use", async () => {
  const passwordBytes = new TextEncoder().encode("test-password");

  await cryptoService.encrypt(data, passwordBytes);

  // Verify password is zeroized
  expect(Array.from(passwordBytes)).toEqual(new Array(passwordBytes.length).fill(0));
});
```

---

## Mock Patterns

### Service Mocking

```typescript
import { vi } from "vitest";

describe("MyComponent", () => {
  beforeEach(() => {
    vi.mock("../services/MyService", () => ({
      myService: {
        doSomething: vi.fn(),
      },
    }));
  });

  it("should call service correctly", async () => {
    const { myService } = await import("../services/MyService");
    vi.mocked(myService.doSomething).mockResolvedValue("result");

    // ... test component ...

    expect(myService.doSomething).toHaveBeenCalledWith("input");
  });
});
```

### RxDB Collection Mocking

```typescript
import { createMockRxCollection } from "../tests/db/mock-collection";

describe("BookmarkService", () => {
  let mockCollection: ReturnType<typeof createMockRxCollection>;

  beforeEach(() => {
    mockCollection = createMockRxCollection();
  });

  it("should query bookmarks correctly", async () => {
    mockCollection.insert({ id: "1", title: "Test" });

    const results = await bookmarkService.getBookmarks(mockCollection);
    expect(results).toHaveLength(1);
  });
});
```

### AI Manager Mocking

```typescript
describe("BookmarkAIService", () => {
  let mockAIManager: AIManager;

  beforeEach(() => {
    mockAIManager = {
      generateText: vi.fn(),
      getProviderInfo: vi.fn(() => ({ provider: "gemini", model: "gemini-pro" })),
    } as unknown as AIManager;

    vi.mocked(mockAIManager.generateText).mockResolvedValue({
      text: "Test response",
      provider: "gemini",
    });
  });
});
```

---

## Test Timing

### Fast Profile Limits

Files in the fast profile must complete in ≤5 seconds:

```json
// scripts/test-timing-baseline.json
{
  "src/tests/services/BookmarkAIService.test.ts": 3000,
  "src/tests/services/EncryptionService.test.ts": 4000
}
```

### Slow Profile Limits

Files in the slow profile must complete in ≤10 seconds:

```json
{
  "src/tests/components/MainApp.test.tsx": 8000,
  "src/tests/hooks/useBookmarkCRUD.test.ts": 6000
}
```

### Updating Baselines

If a test legitimately needs more time:

```bash
BMF_TEST_TIMING=update npm run test:fast
```

This updates the baseline file. The change will be reviewed in the PR diff.

### Opt-Out

For tests that cannot be bounded:

```bash
BMF_TEST_TIMING_OFF=1 npm run test:fast
```

This is an explicit opt-out and should be rare.

---

## Coverage Requirements

### Global Budgets

```json
// scripts/coverage-area-budgets.json
{
  "global": {
    "statements": 86,
    "branches": 85,
    "functions": 86,
    "lines": 88
  },
  "components": {
    "statements": 84,
    "branches": 76,
    "functions": 84,
    "lines": 84
  },
  "services": {
    "statements": 81,
    "branches": 75,
    "functions": 81,
    "lines": 81
  }
}
```

### Area-Specific Budgets

Different areas have different coverage targets:

- **Security**: 90%+ branches (crypto, vault, integrity)
- **Services**: 75%+ branches
- **Components**: 76%+ branches
- **Hooks**: 80%+ branches
- **Utils**: 85%+ branches

### Running Coverage

```bash
npm run test:coverage
```

This runs the full suite with coverage and checks against budgets.

---

## Common Patterns

### Testing Custom Hooks

```typescript
import { renderHook, act } from "@testing-library/react";
import { useMyHook } from "../hooks/useMyHook";

describe("useMyHook", () => {
  it("should return initial state", () => {
    const { result } = renderHook(() => useMyHook());
    expect(result.current.value).toBe("initial");
  });

  it("should update state on action", () => {
    const { result } = renderHook(() => useMyHook());

    act(() => {
      result.current.setValue("new value");
    });

    expect(result.current.value).toBe("new value");
  });
});
```

### Testing React Components

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { MyComponent } from "../components/MyComponent";

describe("MyComponent", () => {
  it("should render correctly", () => {
    render(<MyComponent />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("should handle button click", () => {
    render(<MyComponent />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(screen.getByText("Clicked")).toBeInTheDocument();
  });
});
```

### Testing Async Components

```typescript
describe("AsyncComponent", () => {
  it("should show loading state", async () => {
    render(<AsyncComponent />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Data loaded")).toBeInTheDocument();
    });
  });
});
```

### Testing with RxDB Subscriptions

```typescript
describe("BookmarkStore", () => {
  it("should update on subscription", async () => {
    const store = bookmarkStore;

    // Subscribe to changes
    const bookmarks = store.useQuery(
      (collection) => collection.find()
    );

    // Insert data
    await bookmarkCollection.insert({ id: "1", title: "Test" });

    // Verify subscription received update
    await waitFor(() => {
      expect(bookmarks).toHaveLength(1);
    });
  });
});
```

### Testing Error Boundaries

```typescript
describe("RouteErrorBoundary", () => {
  it("should catch render errors", () => {
    const ThrowError = () => {
      throw new Error("Test error");
    };

    render(
      <RouteErrorBoundary>
        <ThrowError />
      </RouteErrorBoundary>
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });
});
```

### Testing Theme Context

```typescript
describe("ThemeContext", () => {
  it("should provide theme value", () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });

    expect(result.current.theme).toBe("system");
  });

  it("should update theme", () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });

    act(() => {
      result.current.setTheme("dark");
    });

    expect(result.current.theme).toBe("dark");
  });
});
```

---

## Best Practices

### DO ✅

- Write tests that fail for the right reason
- Use descriptive test names that explain what is being tested
- Test edge cases and error conditions
- Mock external dependencies (APIs, databases)
- Use `waitFor` for async operations
- Clean up after each test (`beforeEach`, `afterEach`)
- Test security boundaries and adversarial inputs
- Verify password zeroization after crypto operations
- Use fixture neutralization for E2E tests

### DON'T ❌

- Skip tests without a reason (enforced by `no-unexplained-test-skip`)
- Mock SecurityVault without lock/unlock symmetry
- Use hardcoded strings in E2E fixtures instead of UI interactions
- Assume test execution order (tests should be independent)
- Test implementation details instead of behavior
- Use `console.log` in tests (use `logger` instead)
- Leave secrets in test code (redact them)
- Write happy-path-only security tests

---

## CI Integration

### Pre-commit Gates

```bash
npm run typecheck:prod
npm run lint
npm run test:fast
npm run build:ci
npm run check
```

### CI Job Gates

- **Typecheck**: TypeScript compilation
- **Lint**: ESLint with custom rules
- **Test Fast**: Fast profile tests
- **Test Slow**: Slow profile tests (timing enforced)
- **E2E**: Playwright end-to-end tests
- **Security**: Security gates and scans
- **Coverage**: Coverage budget checks

### Failing Tests

If a test fails in CI:

1. Check if it's a timing issue (slow profile)
2. Verify fixture neutralization (E2E)
3. Check SecurityVault mock symmetry
4. Review i18n key completeness
5. Verify no secrets are leaked

---

## Resources

- [Vitest Documentation](https://vitest.dev)
- [Playwright Documentation](https://playwright.dev)
- [React Testing Library](https://testing-library.com/react)
- [fast-check Property Testing](https://fast-check.dev)
- AGENTS.md: Engineering conventions
- scripts/test-profiles.mjs: Test profile definitions
- scripts/coverage-area-budgets.json: Coverage budgets

---

## Conclusion

Testing in BookmarkForge follows strict patterns to ensure security, reliability, and maintainability. Understanding these patterns is essential for writing effective tests that pass CI gates and maintain the project's high standards.

When in doubt, look at existing tests in the codebase—they are the best reference for the project's testing conventions.
