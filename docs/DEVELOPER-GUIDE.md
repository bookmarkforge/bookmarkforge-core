# Developer Guide - BookmarkForge

**Version:** 1.0.0 · **Last updated:** September 2026

---

## 1. Development Environment Setup

### 1.1 Prerequisites

- **Node.js:** 18+ (recommended 20 LTS)
- **npm** or **pnpm** as package manager
- **Git** for version control
- **Modern browser:** Chrome, Edge, Firefox, Safari (for testing)

### 1.2 Installation

```bash
# Clone the repository
git clone <repository-url>
cd bookmark7

# Install dependencies
npm install

# Start development server
npm run dev
```

### 1.3 Project Structure

```
bookmark7/
├── src/                    # Main source code
│   ├── components/        # React components
│   ├── services/          # Business services
│   ├── hooks/            # Custom React hooks
│   ├── utils/            # Utilities
│   ├── types/            # TypeScript definitions
│   └── tests/            # Unit/integration tests
├── public/               # Static files
├── scripts/               # Automation scripts
├── docs/                 # Documentation
└── tests/                # E2E tests (Playwright)
```

---

## 2. Code Conventions

### 2.1 TypeScript

- **Strict mode:** `strict: true` in `tsconfig.json`
- **No `any`:** Use explicit types
- **Interfaces vs Types:** Prefer `interface` for objects, `type` for primitives

### 2.2 React

- **Functional components:** Use hooks, not classes
- **Props typing:** Define interfaces for props
- **Event handlers:** Use `useCallback` for optimization

### 2.3 Styling

- **Tailwind CSS:** Use utility classes
- **CSS Modules:** Avoid; use Tailwind
- **Design tokens:** Use CSS variables defined in `brand-tokens.css`

### 2.4 Naming Conventions

- **Components:** PascalCase (`QuickCapture.tsx`)
- **Hooks:** camelCase with `use` prefix (`useKeyboardShortcuts.ts`)
- **Utilities:** camelCase (`hashString.ts`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_CAPTURE_TITLE_CHARS`)

---

## 3. Validation Gates

The project has **extremely strict validation gates** that must pass before committing:

### 3.1 Mandatory Gates

```bash
# Typecheck
npm run typecheck

# Lint
npm run lint

# Fast tests
npm run test:fast

# Full tests
npm run test:slow

# Build
npm run build:ci

# Full verification
npm run check
```

### 3.2 Critical Rules

- **NO commits without passing gates**
- **NO changes to `AGENTS.md` without approval**
- **NO changes to test structure without updating baseline**
- **NO changes to localization without updating all languages**
- **NO changes to security files without legal review**

---

## 4. Security

### 4.1 Secret Zeroization

**Important:** Password buffers must be zeroized after use:

```typescript
import { zeroPasswordBytes } from "../utils/crypto-core";

// CORRECT: zeroize buffer after use
const passwordBytes = stringToBytes(password);
try {
  const key = deriveKey(passwordBytes);
  // Use the key...
} finally {
  zeroPasswordBytes(passwordBytes); // CRITICAL
}

// INCORRECT: not zeroizing
const passwordBytes = stringToBytes(password);
const key = deriveKey(passwordBytes);
// passwordBytes remains in memory
```

### 4.2 SecurityVault

**SecurityVault** is the critical security component (~1700 lines). DO NOT modify it without:

1. Reviewing `AGENTS.md` sections 2 and 3
2. Understanding the zeroization contract
3. Validating with `npm run check:security-internal`
4. Creating security regression tests

### 4.3 Encryption Formats

- **v6:** Current format (active)
- **v5:** Legacy (read-only, automatic rewrapping)
- **v4:** Legacy (read-only)
- **v2:** Legacy (read-only)

**DO NOT change wire formats** without ADR.

---

## 5. Testing

### 5.1 Test Profiles

```bash
# Fast tests (critical areas)
npm run test:fast

# Full tests (everything)
npm run test:slow

# E2E smoke tests
npm run e2e:smoke

# Full E2E tests
npm run e2e:ui
```

### 5.2 Test Conventions

- **Unit tests:** In `src/tests/` alongside the code they test
- **Integration tests:** In `src/tests/` for complex flows
- **E2E tests:** In `tests/e2e/` with Playwright
- **Human-like tests:** In `src/tests/human-like/` (161 specs)

### 5.3 Timing Rules

- **Fast profile:** max 5s per new file
- **Slow profile:** max 10s per new file
- **Regression:** 2x baseline time

---

## 6. Useful Scripts

### 6.1 Development

```bash
npm run dev              # Development server
npm run build             # Production build
npm run preview          # Preview build
```

### 6.2 Quality

```bash
npm run typecheck        # Type verification
npm run lint              # ESLint
npm run check             # All gates
```

### 6.3 Testing

```bash
npm run test:fast         # Fast tests
npm run test:slow         # Full tests
npm run test:watch        # Watch mode
```

---

## 7. Recommended Workflow

### 7.1 For Simple Changes

1. Create branch: `git checkout -b feature/xxx`
2. Make changes
3. Run `npm run typecheck` and `npm run lint`
4. Run `npm run test:fast` (if applicable)
5. Commit with descriptive message
6. Push and create PR

### 7.2 For Security Changes

1. Read `AGENTS.md` sections 2-6
2. Create ADR documenting the change
3. Add security regression tests
4. Run `npm run check:security-internal`
5. Request team approval

### 7.3 For Architecture Changes

1. Create ADR proposing the change
2. Discuss with the team
3. Implement in separate branch
4. Validate with full tests
5. Document migration if applicable

---

## 8. Common Troubleshooting

### 8.1 Typecheck Fails

- **Verify types are imported**
- **Remove unnecessary exclusions in `tsconfig.json`**
- **Check for circular imports**

### 8.2 Lint Fails

- **Follow defined ESLint rules**
- **Don't use `console.log` in production**
- **Zeroize secrets in logs**

### 8.3 Tests Fail

- **For security tests:** Verify mock is properly configured
- **For UI tests:** Verify components are mounted correctly
- **For integration tests:** Verify RxDB is initialized

### 8.4 Build Fails

- **Verify environment variables are configured**
- **Clear cache: `rm -rf node_modules dist .vite`**
- **Reinstall: `npm install`

---

## 9. Additional Resources

- **Technical documentation:** `docs/architecture.md`
- **ADRs:** `docs/ADR-*.md` (architecture decisions)
- **Conventions:** `AGENTS.md` (engineering rules)
- **Launch checklist:** `docs/launch-checklist.md`

---

## 10. Frequently Asked Questions

### Can I contribute?

Yes, but follow the workflow in section 7. For security changes, read `AGENTS.md` first.

### How do I report bugs?

Create a GitHub issue with:
- Clear problem description
- Steps to reproduce
- Expected behavior
- Screenshots if applicable

### How do I add a new feature?

1. Open an issue proposing the feature
2. Discuss with the team
3. Design the solution (may require ADR)
4. Implement following conventions
5. Validate with tests and gates
6. Create PR with clear description

---

## 11. Contact

For development questions:
- Email: bookmarkforge@proton.me
- Issues: GitHub repository
- Docs: `docs/` directory
