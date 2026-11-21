# Documentation Index — BookmarkForge

**Version:** 1.0.0
**Last updated:** 2026-10-25

---

## 📚 Generated Documentation

### Developer guides

#### [Contribution Guide](developers/CONTRIBUTING-GUIDE.md)
Complete guide to contributing to the BookmarkForge project.

**Contents:**
- Prerequisites and environment setup
- Development workflow
- Code conventions (TypeScript, React)
- Testing (unit, integration, E2E)
- Commit messages (Conventional Commits)
- Pull requests and code review
- Special cases (Open Core, security, breaking changes)

**Best for:** new contributors, developers

---

#### [Testing Guide](developers/TESTING-GUIDE.md)
Complete testing guide for BookmarkForge.

**Contents:**
- Test architecture (unit, integration, E2E)
- Unit tests with Vitest
- Integration tests
- E2E tests with Playwright
- Security tests
- Performance tests
- Running tests (useful commands)
- Test debugging
- Best practices
- Common pitfalls

**Best for:** developers, QA engineers

---

#### [Debugging Guide](developers/DEBUGGING-GUIDE.md)
Debugging guide for BookmarkForge.

**Contents:**
- Debugging tools (browser, Node.js, logs)
- Debugging in VS Code
- Test debugging (Vitest, Playwright)
- Build debugging
- Security debugging
- Performance debugging
- Common problems and solutions
- Advanced techniques
- Debugging in production

**Best for:** developers, DevOps

---

#### [Command Cheat Sheet](developers/CHEAT-SHEET.md)
Quick reference for useful commands.

**Contents:**
- Development commands
- Testing commands
- Quality-check commands
- Security commands
- Internationalization commands
- Build and bundle commands
- Extension commands
- Audit and metrics commands
- Debugging commands
- Git commands
- Cleanup commands
- Useful one-liners
- Environment variables
- Docker commands
- PWA commands

**Best for:** all developers (quick reference)

---

### Security guides

#### [User Security Guide](security/USER-SECURITY-GUIDE.md)
Security guide for BookmarkForge end users.

**Contents:**
- Security principles (local-first, zero-knowledge, E2E encryption)
- Master password setup
- AI key storage (BYOK)
- Best practices (auto-lock, 2FA, backups)
- Access recovery
- Security on shared devices
- Network security
- Open-source security
- Reporting vulnerabilities
- Security checklist
- In case of compromise

**Best for:** end users, system administrators

---

#### [Security Feature Implementation Guide](security/SECURITY-IMPLEMENTATION-GUIDE.md)
Technical guide to implementing security features.

**Contents:**
- Security architecture (layers)
- Encryption implementation (AES-256-GCM)
- KDF implementation (Argon2id)
- Zeroization implementation
- Security Vault implementation
- Mutation Guard implementation
- Audit Log implementation
- Security verification
- Testing security features
- Security monitoring
- Implementation best practices

**Best for:** security developers, senior developers

---

#### [Security Audit Checklist](security/SECURITY-AUDIT-CHECKLIST.md)
Complete checklist for security audits.

**Contents:**
- Automated audit (security gates)
- Manual audit (code review, layer boundaries)
- Dependency audit (npm audit, CVEs)
- Code audit (type safety, linting, BMF rules)
- Configuration audit (environment, HTTP, CSP, Docker, CI/CD)
- Operations audit (logs, monitoring, backup, incident response)
- Compliance audit (GDPR, CCPA, OWASP, PCI DSS)
- Audit frequency (daily, weekly, monthly, quarterly, yearly)
- Pre-release checklist
- Incident response
- Audit documentation

**Best for:** security engineers, auditors, DevOps

---

#### [Compliance Guide](security/COMPLIANCE-GUIDE.md)
Guide to compliance with global regulations.

**Contents:**
- GDPR compliance (principles, user rights, ROPA, consent)
- CCPA compliance (user rights, Do Not Sell)
- Data retention (policy, retention by data type)
- Data deletion (complete deletion, selective deletion)
- Security standards (OWASP Top 10, NIST Framework)
- Open-source compliance (licenses, attributions, source code)
- Audit trail (logging, retention, export)
- Compliance checklist

**Best for:** legal teams, compliance officers, security engineers

---
## 🔗 Project Documentation

### Core
- [README.md](../README.md) — project overview
- [OPEN-CORE.md](../OPEN-CORE.md) — Open Core model

### Audit files
- [docs/ADR-*.md](../docs/) — architecture decisions
- [docs/ROPA.md](../docs/ROPA.md) — processing record (GDPR)

---

## 🎯 Quick Reference

### For new developers
1. Read [README.md](../README.md)
2. Read the [Contribution Guide](developers/CONTRIBUTING-GUIDE.md)
3. Set up the environment with npm install
4. Run `npm run verify:fast`

### For debugging
1. Read the [Debugging Guide](developers/DEBUGGING-GUIDE.md)
2. Use the [Cheat Sheet](developers/CHEAT-SHEET.md) for commands
3. Run `npm run test:fast:watch` for interactive debugging

### For security
1. Read the [User Security Guide](security/USER-SECURITY-GUIDE.md)
2. Read the [Security Feature Implementation Guide](security/SECURITY-IMPLEMENTATION-GUIDE.md)
3. Run `npm run check:security`

### For compliance
1. Read the [Compliance Guide](security/COMPLIANCE-GUIDE.md)
2. Run the [Security Audit Checklist](security/SECURITY-AUDIT-CHECKLIST.md)
3. Check [ROPA.md](../docs/ROPA.md)

### For testing
1. Read the [Testing Guide](developers/TESTING-GUIDE.md)
2. Run `npm run test:fast` for critical tests
3. Run `npm run e2e:smoke` for critical E2E

---

## 📈 Current Repository Status

### bookmarkforge-core (Pro/Private)
- **Status:** ✅ PRODUCTION-READY
- **Score:** 9.5/10
- **Vulnerabilities:** 3 moderate (dev-only)
- **Scripts:** 234 complete
- **Use:** development with Pro features

### bookmarkforge-core-2 (Core/MIT)
- **Status:** ✅ PRODUCTION-READY
- **Score:** 9.3/10
- **Vulnerabilities:** 3 moderate (dev-only)
- **Scripts:** 224 complete (Core-only)
- **Use:** public Core-only development

---

## 📝 Documentation Conventions

### Format
- GitHub Flavored Markdown
- Headers in English (except ADR sections)
- Code blocks with syntax highlighting
- Relative links whenever possible

### Language
- Main content in English
- ADR sections accept Spanish/English
- User-facing docs in 30 languages (in the codebase)

### Updating
- Last-updated date in the header
- Version in the header
- Changelog at the end of significant changes

---

## 🚀 Useful Scripts

### Verify everything
```bash
npm run ci:local
```

### Verify security
```bash
npm run check:security
```

### Verify the Core boundary
```bash
npm run check:open-core
```

### Generate an audit report
```bash
npm run check:security
```

---

## 📞 Support

### Documentation
- GitHub Issues: https://github.com/bookmarkforge/bookmarkforge-core/issues
- Discord: https://discord.gg/bookmarkforge
- Email: support@bookmarkforge.com

### Security
- Report vulnerabilities: security@bookmarkforge.com
- Bug bounty: https://bookmarkforge.com/bounty

---

## 🔄 Change History

### 2026-10-25
- 8 new guide documents generated
- Deep security audit completed
- Manual zod fix applied
- bookmarkforge-core-2 cleanup completed
- Documentation index created

---

**Last updated:** 2026-10-25
