# Contributing to BookmarkForge Core

Thank you for your interest in contributing to BookmarkForge Core! This guide will help you get started.

## Overview

BookmarkForge Core is the MIT-licensed public repository. It contains the Core features that are free to use, study, modify, and redistribute. Pro features and proprietary code are intentionally excluded from this repository.

## What Can You Contribute?

### Welcome Contributions
- Bug fixes
- Documentation improvements
- Performance optimizations
- New Core features (must be MIT-compatible)
- Test improvements
- Accessibility improvements
- Internationalization (new translations)

### Not Allowed
- Pro features (belong in private repository)
- Code with incompatible licenses
- Copying third-party code without proper attribution
- Changes that cross the Core/Pro boundary without documentation

## Getting Started

### Prerequisites
- **Node.js** >= 24.17.0
- **npm** (comes with Node.js)
- **Git**

### Setup

```bash
# Clone the repository
git clone https://github.com/bookmarkforge/bookmarkforge.git
cd bookmarkforge

# Install dependencies
npm install

# Start development server
npm run dev
```

### Verification

Run these commands to ensure your setup is correct:

```bash
npm run typecheck:prod  # TypeScript type checking
npm run lint             # ESLint
npm run test:fast        # Fast tests
npm run check:open-core  # Verify Core/Pro boundary
```

All should pass without errors.

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes

- Follow the engineering conventions in [AGENTS.md](AGENTS.md)
- Keep changes focused and minimal
- Add tests for new features
- Update documentation as needed

### 3. Run the Gates

Before committing, run:

```bash
npm run verify:fast      # Typecheck + lint + quick checks
npm run check:open-core  # Verify Core boundary
```

### 4. Commit Your Changes

Use conventional commit messages:

```bash
git add .
git commit -m "feat: add new feature"
```

Commit message types:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Test changes
- `chore:` Maintenance tasks

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## Core vs Pro Boundary

### Important: Core Code Only

This repository contains **only the MIT-licensed Core**. When making changes:

### ✅ DO
- Modify Core features (bookmarks, notes, search, AI BYO integration)
- Add new Core features (must be MIT-compatible)
- Fix bugs in Core code
- Improve documentation
- Add tests for Core features

### ❌ DON'T
- Add Pro features (encrypted backups, P2P sync, local AI runtime)
- Copy Pro code from private repository
- Add code that requires Pro dependencies
- Change the Core/Pro boundary without documentation

### Crossing the Boundary

If your change affects how Core interacts with Pro features:

1. **Document the decision** in the commit message
2. **Update `OPEN-CORE.md`** if the boundary changes
3. **Add tests** to verify the boundary
4. **Run `npm run check:open-core`** to verify

### Pro Access Pattern

Core code uses `src/services/pro-access.ts` to check Pro availability:

```typescript
import { hasProAccess } from "./pro-access";

async function someFeature() {
  if (await hasProAccess()) {
    // Load Pro chunk or use Pro feature
  } else {
    // Show "Available in Pro" message
    throw new ProUnavailableError("This feature requires Pro");
  }
}
```

Never import Pro modules directly. Always use the Pro access gate.

## Code Review Process

### What We Check

1. **Core/Pro Boundary** - No Pro code in Core
2. **Code Quality** - TypeScript strict mode, ESLint
3. **Tests** - Tests pass, adequate coverage
4. **Documentation** - Updated if needed
5. **License** - MIT-compatible only

### Review Timeline

- Small changes: 1-2 days
- Medium changes: 3-5 days
- Large changes: 1-2 weeks

## Testing

### Write Tests

- Unit tests for utilities and services
- Integration tests for component interactions
- E2E tests for user workflows

### Test Your Changes

```bash
npm run test:fast        # Fast tests
npm run test:slow        # Full test suite
npm run e2e:smoke        # Critical E2E tests
```

### Coverage

Aim for >80% coverage on Core code you modify. Critical paths (crypto, auth) should have 100% coverage.

## Documentation

### Update README If Needed

If your change is user-facing, update the README:
- Features section
- Quick start (if setup changes)
- Architecture (if structure changes)

### Update AGENTS.md If Needed

If you change engineering conventions:
- Update [AGENTS.md](AGENTS.md)
- Document the reasoning

## Security

### No Secrets

Never commit:
- API keys
- Tokens
- Passwords
- Any sensitive data

Run `npm run check:secrets-in-commit` before pushing.

### Security Bugs

If you find a security vulnerability:
- **DO NOT** open a public issue
- Report privately via [SECURITY.md](.github/SECURITY.md)
- Allow time to fix before disclosure

## License

### MIT License Only

All contributions must be MIT-compatible. Do not:
- Add GPL-licensed code
- Add code with copyleft restrictions
- Copy code without proper attribution

### Your Contributions

By contributing, you agree that your contributions will be licensed under the MIT License.

## Getting Help

### Documentation
- [Architecture](docs/architecture.md) - System architecture
- [Security](docs/security.md) - Security model
- [AGENTS.md](AGENTS.md) - Engineering conventions
- [OPEN-CORE.md](OPEN-CORE.md) - Open Core model

### Community
- [GitHub Issues](https://github.com/bookmarkforge/bookmarkforge/issues) - Bug reports
- [GitHub Discussions](https://github.com/bookmarkforge/bookmarkforge/discussions) - Questions

## Code of Conduct

- Be respectful to all contributors
- Focus on what is best for the community
- Provide constructive feedback
- Accept feedback gracefully

## Recognition

Contributors are recognized in:
- Release notes
- Contributor list in documentation
- GitHub contributor statistics

Thank you for contributing to BookmarkForge Core! 🎉
