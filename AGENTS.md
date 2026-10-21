# BookmarkForge Core Engineering Conventions

This document describes engineering conventions for the MIT-licensed Core.

**IMPORTANT:** This repository contains only the MIT-licensed Core. Pro features and proprietary code are intentionally excluded. All contributions must be MIT-compatible.

---

## 1. Code Style

### TypeScript
- **Strict mode:** Enabled in `tsconfig.json`
- **No implicit any:** Avoid `any` types (use `unknown` if necessary)
- **No unused locals:** Compiler checks enabled
- **No unchecked indexed access:** Enabled for safety

### Naming Conventions
- **Components:** PascalCase (`BookmarkList.tsx`)
- **Utilities:** camelCase (`formatDate.ts`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_BOOKMARKS`)
- **Interfaces:** PascalCase with `I` prefix (`IBookmark`)

### File Organization
- **Components:** `src/components/`
- **Services:** `src/services/`
- **Hooks:** `src/hooks/`
- **Utils:** `src/utils/`
- **Types:** `src/types/`
- **Tests:** `src/tests/` (mirrors src structure)

---

## 2. Error Handling

### Never Swallow Errors Silently
Empty catch blocks must be explicitly marked:

```typescript
try {
  // code
} catch {
  /* INTENTIONAL SILENCE: <reason> */
}
```

### Use Logger, Not Console
- Use `src/utils/logger` for app code
- Bound repeated noise with `logRateLimited`
- Redact secrets before logging

### User-Facing Errors
- Never leak raw error messages to users
- Sanitize stack traces
- Use i18n for error messages

---

## 3. Security (Core-Only)

### No Secrets in Code
- Never commit API keys, tokens, or passwords
- Use environment variables for configuration
- Run `npm run check:secrets-in-commit` before committing

### Client-Side Crypto
- All encryption/decryption in Web Workers
- Password buffers must be zeroized after use
- Never decode secrets into immutable strings

### AI Keys (BYO)
- User provides their own AI provider keys
- Keys stored encrypted in vault (IndexedDB)
- Never send keys to our servers

---

## 4. Pro Access Boundary

### Core Code Rule
- Core code must NOT import Pro modules directly
- Use `src/services/pro-access.ts` for Pro feature checks
- Handle `ProUnavailableError` gracefully

### Placeholder Pattern
- Pro features use inert placeholders in this build
- Placeholders dispatch `open-core:pro-reached` event
- UI shows "Available in Pro" panel for Pro features

### Open Core Verification
- Run `npm run check:open-core` before committing
- This gate verifies no Pro code leaks into Core export

---

## 5. Layer Rules

### Import Restrictions
- `components` must NOT import `workers`, `memory`, or `db` directly
- Data access goes through `src/services/*` or zustand stores
- Type-only imports are exempt (erased at compile time)

### Database Access
- Bootstrap through `src/container/database.ts`
- Never access RxDB collections directly from components
- Use services or stores for data operations

---

## 6. Testing

### Test Structure
- Unit tests mirror source structure
- Integration tests in `src/tests/`
- E2E tests in `tests/e2e/`

### Test Naming
- Unit: `<filename>.test.ts`
- Integration: `<feature>.integration.test.ts`
- E2E: `<workflow>.spec.ts`

### Coverage
- Aim for >80% coverage on Core code
- Critical paths (crypto, auth) must have 100% coverage

---

## 7. Git Workflow

### Commit Messages
- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`
- Keep messages concise and descriptive
- Reference issues: `fix: #123`

### Before Committing
```bash
npm run typecheck:prod
npm run lint
npm run test:fast
npm run check:open-core
```

### Before Pushing
```bash
npm run ci:local
```

---

## 8. Internationalization (i18n)

### All User-Facing Strings
- Use `t()` function for all UI strings
- Add keys to all locale files
- Run `npm run check:i18n` to verify completeness

### Supported Languages
- Core ships in 30 languages
- Add new keys to every locale file
- See `scripts/translations/` for locale files

---

## 9. Performance

### Bundle Size
- Lazy load non-critical features
- Use dynamic imports for Pro chunks
- Run `npm run check:bundle-size` before merging

### Runtime Performance
- Offload crypto to Web Workers
- Use RxDB reactive queries efficiently
- Avoid blocking the main thread

---

## 10. Documentation

### Code Comments
- Comment complex logic
- Explain "why", not just "what"
- Keep comments in English

### Documentation Updates
- Update README for user-facing changes
- Update this file for convention changes
- Add ADR (Architecture Decision Record) for major decisions

---

## 11. License Compatibility

### MIT-Only Contributions
- All contributions must be MIT-compatible
- Do not copy code with incompatible licenses
- Check license of dependencies before adding

### Pro Code Boundary
- Never add Pro code to this repository
- Pro features belong in private repository
- Use placeholder pattern for Pro references

---

## 12. Gates (Automated Checks)

### Mandatory Gates
```bash
npm run check           # All quality gates
npm run check:open-core  # Verify Core/Pro boundary
npm run check:secrets-in-commit  # No secrets in code
```

### Quality Gates
```bash
npm run typecheck:prod  # TypeScript (prod config)
npm run lint             # ESLint
npm run test:fast        # Critical path tests
```

---

## Quick Reference

### Daily Development
```bash
npm run dev              # Start dev server
npm run typecheck:prod  # Type check
npm run lint             # Lint
npm run test:fast        # Fast tests
```

### Before Commit
```bash
npm run verify:fast      # Typecheck + lint + quick checks
npm run check:open-core  # Verify Core boundary
```

### Before Push
```bash
npm run ci:local         # Full CI validation
```

---

## Related Documentation

- [Architecture](docs/architecture.md) - System architecture
- [Security](docs/security.md) - Security model
- [README](README.md) - Project overview
- [OPEN-CORE.md](OPEN-CORE.md) - Open Core model
