# Troubleshooting Guide

This guide covers common problems developers may encounter when working with BookmarkForge, along with their solutions and preventive measures.

## Table of Contents

1. [Development Environment](#development-environment)
2. [Build Issues](#build-issues)
3. [Testing Problems](#testing-problems)
4. [TypeScript Errors](#typescript-errors)
5. [Linting Issues](#linting-issues)
6. [Crypto and Security](#crypto-and-security)
7. [Database Issues](#database-issues)
8. [AI and Provider Issues](#ai-and-provider-issues)
9. [Performance Issues](#performance-issues)
10. [CI/CD Problems](#cicd-problems)
11. [E2E Test Failures](#e2e-test-failures)
12. [Common Patterns](#common-patterns)

---

## Development Environment

### Problem: Node.js version incompatibility

**Symptoms:**
- `npm install` fails with module resolution errors
- Vite build fails with ES syntax errors
- TypeScript compilation fails

**Solution:**
```bash
# Check Node version
node --version

# Install required version (check .nvmrc or package.json engines)
nvm install 20
nvm use 20

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

**Prevention:**
- Use `.nvmrc` file for version pinning
- Add `engines` field to `package.json`
- Use `nvm use` automatically with `.nvmrc`

### Problem: Port already in use

**Symptoms:**
- Dev server fails to start
- "Port 5173 is already in use" error

**Solution:**
```bash
# Find process using the port
lsof -i :5173  # macOS/Linux
netstat -ano | findstr :5173  # Windows

# Kill the process
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows

# Or use a different port
npm run dev -- --port 5174
```

**Prevention:**
- Kill dev servers before closing terminal
- Use `.env` file to configure default port

### Problem: Environment variables not loading

**Symptoms:**
- Config values are `undefined`
- API calls fail with missing credentials

**Solution:**
```bash
# Check .env file exists
ls -la .env

# Verify .env.local (gitignored)
ls -la .env.local

# Restart dev server after .env changes
npm run dev
```

**Prevention:**
- Use `.env.example` as template
- Document required variables in `.env.example`
- Never commit `.env.local` to git

---

## Build Issues

### Problem: Vite build fails with module resolution

**Symptoms:**
- "Failed to resolve import" errors
- Build exits with code 1

**Solution:**
```bash
# Check for circular dependencies
npm run check:boundaries

# Verify imports use correct paths
# src/components/... not ./components/...

# Clear Vite cache
rm -rf node_modules/.vite
npm run build
```

**Prevention:**
- Follow layer rules in AGENTS.md
- Use path aliases defined in `tsconfig.json`
- Run `npm run check:boundaries` before commit

### Problem: Bundle size exceeds budget

**Symptoms:**
- Build fails with chunk size error
- Performance budget exceeded

**Solution:**
```bash
# Analyze bundle
npm run build:ci
# Check output for chunk sizes

# Use vite-plugin-visualizer
npm install -D rollup-plugin-visualizer
# Add to vite.config.ts for visualization
```

**Prevention:**
- Lazy load heavy components
- Code split by route
- Use dynamic imports for AI features
- Monitor bundle size in PR reviews

### Problem: SRI hash generation fails

**Symptoms:**
- "SRI hash mismatch" error
- Build fails at integrity check step

**Solution:**
```bash
# Clear dist and rebuild
rm -rf dist
npm run build:ci

# Verify no uncommitted changes affect dist
git status
```

**Prevention:**
- Commit before building
- Use consistent build environment
- Don't manually modify dist files

---

## Testing Problems

### Problem: Tests timeout

**Symptoms:**
- Tests fail with timeout error
- "Test timed out after 5000ms"

**Solution:**
```bash
# Check if test is in fast profile
npm run test:fast

# Update timing baseline if legitimate
BMF_TEST_TIMING=update npm run test:fast

# Opt-out if unbounded (rare)
BMF_TEST_TIMING_OFF=1 npm run test:fast
```

**Prevention:**
- Keep fast tests under 5 seconds
- Mock slow operations (API, crypto)
- Use `vi.useFakeTimers()` for time-based tests

### Problem: E2E tests flake on vault setup

**Symptoms:**
- E2E tests fail randomly during vault unlock
- Timeout waiting for password input

**Solution:**
```bash
# Increase timeout multiplier
E2E_TIMEOUT_MULTIPLIER=2 npm run e2e:smoke

# Use test mode for faster Argon2id
# Configured in playwright configs
```

**Prevention:**
- Use `--mode test` for E2E webServer
- Don't start dev server for E2E
- Use proper waits (not fixed timeouts)

### Problem: Fixture neutralization fails

**Symptoms:**
- "Fixture neutralization violation" error
- E2E test fails at check step

**Solution:**
```typescript
// Preserve surface through test
await setupVault(page, { dismissOnboarding: false });

// Or declare waiver
// fixture-neutralization-waiver: onboarding — test specifically validates onboarding flow
```

**Prevention:**
- Document fixture surface IDs
- Use preserving options when needed
- Declare waivers with clear reasoning

### Problem: Test coverage drops below budget

**Symptoms:**
- Coverage gate fails
- "Branch coverage below threshold"

**Solution:**
```bash
# Run coverage with detailed report
npm run test:coverage

# Identify uncovered branches
# Check coverage/istanbul report

# Add tests for uncovered paths
```

**Prevention:**
- Write tests for new features
- Cover error paths and edge cases
- Review coverage in PRs

---

## TypeScript Errors

### Problem: Type 'string' not assignable to Theme

**Symptoms:**
- TS2322 error on theme values
- Type mismatch on string literals

**Solution:**
```typescript
// Import Theme type
import { type Theme } from "../contexts/ThemeContext";

// Use union type
const theme: Theme = "dark"; // not "dark" as string

// Export Theme type from context
export type Theme = "light" | "dark" | "system";
```

**Prevention:**
- Import types where used
- Export types from modules
- Use `type` keyword for type-only imports

### Problem: Cannot find module for custom hooks

**Symptoms:**
- TS2307 error on hook imports
- Module resolution fails

**Solution:**
```bash
# Check tsconfig.json paths
"paths": {
  "@/*": ["./src/*"]
}

# Use @ alias for clean imports
import { useMyHook } from "@/hooks/useMyHook";
```

**Prevention:**
- Configure path aliases in tsconfig
- Use consistent import patterns
- Run `npm run typecheck` before commit

### Problem: Strict null check errors

**Symptoms:**
- TS2532 error on possibly null values
- Object is possibly 'undefined'

**Solution:**
```typescript
// Use optional chaining
const value = data?.property;

// Use nullish coalescing
const value = data.property ?? defaultValue;

// Use type guards
if (data !== null && data !== undefined) {
  // data is non-null here
}
```

**Prevention:**
- Enable strict null checks
- Use proper type guards
- Initialize variables properly

---

## Linting Issues

### Problem: INTENTIONAL SILENCE required

**Symptoms:**
- ESLint error on empty catch block
- "Empty catch block without comment"

**Solution:**
```typescript
try {
  await riskyOperation();
} catch {
  /* INTENTIONAL SILENCE: error is logged elsewhere, not relevant to this flow */
}
```

**Prevention:**
- Always comment empty catches
- Use bounded logging for repeated errors
- Follow error handling conventions

### Problem: No unexplained test skip

**Symptoms:**
- ESLint error on `test.skip()`
- "Test skip without explanation"

**Solution:**
```typescript
it.skip("reason for skipping", () => {
  // test implementation
});
```

**Prevention:**
- Explain why test is skipped
- Remove skip when issue is fixed
- Use skip sparingly

### Problem: Layer boundary violation

**Symptoms:**
- ESLint error on import path
- "Component importing from workers"

**Solution:**
```typescript
// ❌ WRONG: Direct import
import { workerFunction } from "../workers/myWorker";

// ✅ CORRECT: Through service layer
import { myService } from "../services/MyService";
```

**Prevention:**
- Follow layer rules in AGENTS.md
- Use service layer for data access
- Run `npm run check:boundaries`

---

## Crypto and Security

### Problem: Password buffer reuse warning

**Symptoms:**
- "Buffer is already zeroized" warning
- "Possible reuse of consumed password"

**Solution:**
```typescript
// ❌ WRONG: Reusing consumed buffer
await cryptoService.encrypt(data, passwordBytes);
await cryptoService.encrypt(data2, passwordBytes); // ERROR

// ✅ CORRECT: Create fresh copy
const passwordBytes2 = new Uint8Array(passwordBytes);
await cryptoService.encrypt(data, passwordBytes);
await cryptoService.encrypt(data2, passwordBytes2);
```

**Prevention:**
- Always create fresh copies after crypto operations
- Use `withMasterPasswordBytes` for automatic copy management
- Zeroize copies in `finally` blocks

### Problem: SecurityVault mock lock/unlock asymmetry

**Symptoms:**
- Test fails with "lock/unlock symmetry required"
- Mock vault state is inconsistent

**Solution:**
```typescript
// ✅ CORRECT: Unlock before operations
await mockVault.unlock(passwordBytes);
await myService.secureOperation();
await mockVault.lock(); // Lock after operations
```

**Prevention:**
- Always pair unlock/lock in tests
- Use `createMockSecurityVault` helper
- Verify mock state in assertions

### Problem: Secret leaked in bundle

**Symptoms:**
- Build fails with secret scan error
- "Secret found in dist/"

**Solution:**
```bash
# Check for secrets in code
npm run check:secrets-in-commit

# Remove secrets from .env
# Use VITE_* only for non-sensitive config
```

**Prevention:**
- Never put real keys in VITE_*
- Store provider keys in encrypted vault
- Use Compose secrets for server credentials

---

## Database Issues

### Problem: RxDB initialization fails

**Symptoms:**
- "Database initialization failed" error
- IndexedDB blocked or corrupted

**Solution:**
```bash
# Clear IndexedDB in browser
# DevTools > Application > Storage > IndexedDB

# Or reset programmatically
await destroyDB();
await initDB();
```

**Prevention:**
- Handle initialization errors gracefully
- Provide reset option in settings
- Log initialization failures

### Problem: Query returns stale data

**Symptoms:**
- UI shows old data after updates
- RxDB subscription not firing

**Solution:**
```typescript
// Use RxDB queries, not direct storage
const bookmarks = bookmarkStore.useQuery(
  (collection) => collection.find({ selector: { isDeleted: false } })
);

// Subscribe to changes
collection.$.subscribe((change) => {
  // React to changes
});
```

**Prevention:**
- Always use RxDB queries for UI
- Subscribe to collection changes
- Avoid direct IndexedDB access

### Problem: Migration fails on schema change

**Symptoms:**
- "Migration failed" error
- Data not readable after schema update

**Solution:**
```typescript
// Add migration strategy
const migrationStrategies = {
  1: (oldDoc) => {
    // Transform old schema to new
    return { ...oldDoc, newField: defaultValue };
  },
  2: (oldDoc) => {
    // Next migration
  },
};
```

**Prevention:**
- Test migrations in dev
- Provide rollback strategy
- Document schema changes

---

## AI and Provider Issues

### Problem: AI provider returns 401

**Symptoms:**
- "Provider authentication failed" error
- API key rejected

**Solution:**
```typescript
// Check provider configuration
const config = await providerConfiguration.getProvider("openai");

// Verify API key is set
if (!config.apiKey) {
  throw new Error("API key not configured");
}

// Reconfigure if needed
await providerConfiguration.setProvider("openai", {
  apiKey: newKey,
  model: "gpt-4",
});
```

**Prevention:**
- Validate provider config before use
- Handle 401/429 errors gracefully
- Provide UI for key reconfiguration

### Problem: Streaming response parsing fails

**Symptoms:**
- "SSE parse error" during AI generation
- Incomplete or malformed responses

**Solution:**
```typescript
// Use custom provider E2E suite
npm run e2e:custom-provider

// This tests SSE parsing against mock server
// that returns various error scenarios
```

**Prevention:**
- Test with custom provider suite
- Handle partial responses
- Implement robust SSE parsing

### Problem: WebLLM fails to load

**Symptoms:**
- "WebLLM initialization failed"
- Model download fails

**Solution:**
```bash
# Check WebGPU support
npm run check:webgpu

# Verify network for model download
# Check browser console for download errors
```

**Prevention:**
- Detect WebGPU support before initialization
- Provide fallback to cloud providers
- Handle download failures gracefully

---

## Performance Issues

### Problem: First load is slow

**Symptoms:**
- Initial page load takes >10 seconds
- Large bundle size

**Solution:**
```bash
# Analyze bundle
npm run build:ci
# Check chunk sizes in output

# Lazy load heavy features
const AIChat = lazy(() => import("./components/AIChat"));

// Use route-based code splitting
const routes = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/ai", element: <AIChat /> },
]);
```

**Prevention:**
- Lazy load by route
- Code split heavy dependencies
- Use deferred loading for non-critical features

### Problem: UI freezes during crypto operations

**Symptoms:**
- Browser becomes unresponsive
- Main thread blocked

**Solution:**
```typescript
// Use Web Workers for crypto
const worker = new Worker(new URL("./workers/crypto.worker.ts", import.meta.url));

worker.postMessage({ type: "encrypt", data, passwordBytes });

worker.onmessage = (e) => {
  const result = e.data;
  // Handle result on main thread
};
```

**Prevention:**
- Always use Web Workers for crypto
- Offload heavy computations
- Keep main thread responsive

### Problem: Memory usage grows over time

**Symptoms:**
- Browser tab uses >2GB RAM
- Performance degrades over time

**Solution:**
```typescript
// Clean up subscriptions
useEffect(() => {
  const subscription = someObservable.subscribe();
  return () => subscription.unsubscribe();
}, []);

// Zeroize password buffers
finally {
  zeroPasswordBytes(passwordBytes);
}

// Clear caches periodically
```

**Prevention:**
- Always clean up in useEffect returns
- Zeroize sensitive data
- Monitor memory in dev tools

---

## CI/CD Problems

### Problem: CI fails on check:audit-drift

**Symptoms:**
- "Audit anchor drift detected"
- Regression test renamed or removed

**Solution:**
```bash
# Check audit anchors
npm run check:audit-drift

# If intentional change, update baseline
npm run check:audit-drift:strict
```

**Prevention:**
- Don't rename anchored tests
- Add new tests instead of renaming
- Document anchor changes in ADR

### Problem: CI fails on check:i18n

**Symptoms:**
- "i18n key missing from locale"
- Translation incomplete

**Solution:**
```bash
# Scaffold missing keys
npm run check:i18n:fix

# Translate keys in all locales
# en.json, es.json, etc.
```

**Prevention:**
- Add keys to all locales when adding new strings
- Use `t()` for all user-facing text
- Run i18n check before commit

### Problem: CI fails on check:open-core

**Symptoms:**
- "Open Core boundary violation"
- Pro code in Core file

**Solution:**
```bash
# Check Open Core classification
npm run check:open-core

# Move Pro code to proper location
# Update OPEN-CORE.md if needed
```

**Prevention:**
- Classify new files before merge
- Keep Core/Pro boundaries synchronized
- Run check after boundary changes

---

## E2E Test Failures

### Problem: Test fails to find element

**Symptoms:**
- "Element not found" error
- Selector doesn't match

**Solution:**
```typescript
// Use data-testid for stable selectors
<button data-testid="save-button">Save</button>

// In test
await page.click('[data-testid="save-button"]');
```

**Prevention:**
- Use `data-testid` for test selectors
- Avoid CSS selectors that change
- Keep test IDs stable

### Problem: Test fails on timeout

**Symptoms:**
- "Timeout 5000ms exceeded"
- Element not visible in time

**Solution:**
```typescript
// Use waitFor instead of fixed timeout
await waitFor(() => {
  expect(page.locator('[data-testid="result"]')).toBeVisible();
});

// Or increase timeout
await expect(page.locator('[data-testid="result"]')).toBeVisible({ timeout: 10000 });
```

**Prevention:**
- Use `waitFor` for async operations
- Avoid `setTimeout` in tests
- Configure reasonable defaults

### Problem: Test fails randomly (flaky)

**Symptoms:**
- Test passes sometimes, fails others
- No consistent failure pattern

**Solution:**
```bash
# Run test multiple times
npm run e2e:smoke -- --repeat=10

# Check for race conditions
# Add proper waits
# Use fixture neutralization
```

**Prevention:**
- Use fixture neutralization
- Add proper waits (not sleeps)
- Isolate tests from each other

---

## Common Patterns

### Debug Pattern

```typescript
// Add logging for debugging
logger.debug("Operation started", { input });

try {
  const result = await operation();
  logger.debug("Operation succeeded", { result });
  return result;
} catch (error) {
  logger.error("Operation failed", { error: safeErrorForLog(error) });
  throw error;
}
```

### Error Recovery Pattern

```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await delay(1000 * (i + 1)); // Exponential backoff
    }
  }
  throw new Error("Max retries exceeded");
}
```

### Validation Pattern

```typescript
function validateInput(input: unknown): input is ExpectedType {
  return (
    typeof input === "object" &&
    input !== null &&
    "requiredField" in input &&
    typeof (input as ExpectedType).requiredField === "string"
  );
}
```

### Cleanup Pattern

```typescript
useEffect(() => {
  const subscription = observable.subscribe();
  const worker = new Worker("./worker.ts");

  return () => {
    subscription.unsubscribe();
    worker.terminate();
  };
}, []);
```

---

## Getting Help

### Internal Resources

- Check existing ADRs for context
- Review this troubleshooting guide
- Consult AGENTS.md for conventions
- Search codebase for similar patterns

### External Resources

- [Vite Documentation](https://vitejs.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [RxDB Documentation](https://rxdb.info)
- [Playwright Documentation](https://playwright.dev)
- [Vitest Documentation](https://vitest.dev)

### Reporting Issues

When reporting an issue, include:
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node version, OS, browser)
- Relevant error messages and stack traces
- Any workarounds you've found

---

## Conclusion

Most issues in BookmarkForge can be resolved by following the patterns documented in this guide. When in doubt, refer to AGENTS.md for conventions and the existing codebase for examples.

Remember to run the full gate chain before committing:

```bash
npm run typecheck:prod
npm run lint
npm run test:fast
npm run build:ci
npm run check
```

Happy debugging! 🔧
