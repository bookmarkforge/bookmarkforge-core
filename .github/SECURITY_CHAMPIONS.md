# Security Champions Program — BookmarkForge

## Overview

The Security Champions program distributes security responsibility across every
development team. Each champion is the first point of contact for security
questions, reviews critical changes, and makes sure security best practices are
part of the development lifecycle.

---

## Program Structure

### Roles

| Role | Responsibility | Appointment |
|-----|-----------------|-------------|
| **Security Champion** | Reviews security changes, mentors the team | 1 per engineering team |
| **Security Lead** | Coordinates the program, approves critical changes, owns the security pipeline | Lead maintainer |
| **External Security Auditor** | Runs penetration tests, independent code review | Contracted externally |
| **CST (Certified Security Tester)** | Runs the weekly DAST, reviews reports | Assigned from the team |

### Appointment Criteria

A Security Champion must meet at least 3 of these 5 criteria:
1. Having completed the OWASP Secure Software Development Professional (SSP) or equivalent
2. Having contributed to 5+ security PRs in the last quarter
3. Being authorized to modify `server/src/` or `src/utils/crypto-core.ts`
4. Having taken part in at least one internal penetration test
5. Passing the internal security exam (`npm run check:security-internal` with no errors)

---

## Security Champion Responsibilities

### Pre-Commit
- [ ] Verify `npm run check:security-internal` passes before pushing
- [ ] Verify `npm run check:server-log-ip-privacy` passes
- [ ] Verify `npm run check:blindeo` passes
- [ ] Check that no secrets are introduced in the code (`npm run check:workflows`)
- [ ] Validate that changes under `server/src/` do not break the security configuration

### Pull Request
- [ ] Approve or request changes on PRs that touch:
  - `server/src/` (any file)
  - `src/utils/crypto-core.ts` and related files
  - `src/db/database.ts`
  - `scripts/csp-config.js`
  - `vite.config.ts` (security changes)
  - `.github/workflows/*.yml` (pipeline changes)
  - `public/_headers`
  - `extension/manifest.json`
- [ ] Verify the CSP is updated correctly with new domains
- [ ] Verify the security headers stay consistent

### Post-Commit
- [ ] Review CodeQL and Semgrep results on every CI run
- [ ] Investigate and remediate any High/Critical severity alert within 48h
- [ ] Take part in the weekly DAST review
- [ ] Update `audit-anchors-baseline.json` when new anchors are added

### Quarterly
- [ ] Take part in an external penetration test
- [ ] Review `AGENTS.md` and update it with newly discovered vulnerabilities
- [ ] Threat-model the new features
- [ ] Review the supply chain (`npm audit`, dependabot, SLSA)

---

## Security Incident Response Scale

### 🔴 Critical (P0)
- **Response time:** < 1 hour
- **Action:** Isolate, patch, communicate
- **Example:** Secret exposed publicly, RCE on the server
- **Notification:** Security Lead + all champions + email to the team

### 🟠 High (P1)
- **Response time:** < 4 hours
- **Action:** Patch, verify impact
- **Example:** XSS in the editor, authentication bypass
- **Notification:** Security Lead + champion of the affected area

### 🟡 Medium (P2)
- **Response time:** < 24 hours
- **Action:** Plan the fix, include it in the next sprint
- **Example:** Insufficient CSP, missing header
- **Notification:** Security Champion of the area

### 🟢 Low (P3)
- **Response time:** < 1 week
- **Action:** Add to the security backlog
- **Example:** Security logging improvement, documentation
- **Notification:** Document it in the security issue

---

## Security Checklist by Change Type

### Changes under `server/src/`
```
- [ ] npm run check:security-internal passes
- [ ] npm run check:workflows passes
- [ ] npm run check:http-config passes
- [ ] npm run check:compose-config passes
- [ ] npm run check:docker-context passes
- [ ] npm run check:repository-hygiene passes
- [ ] No dependencies are added without an audit
- [ ] The CSP is updated if new domains are added
- [ ] The security headers stay in place
- [ ] No secrets or private keys are hardcoded
- [ ] Rate limiting is kept or improved
- [ ] Timeouts are kept or improved
- [ ] Input validation is strengthened
```

### Changes to `vite.config.ts` or `scripts/csp-config.js`
```
- [ ] npm run check:security passes
- [ ] CSP_MODERATE reflects the production policy
- [ ] CSP_OPEN has no excessive permissions
- [ ] The domains in connect-src are necessary
- [ ] report-uri is configured
- [ ] COEP/COOP stay in place
```

### Changes to `public/_headers`
```
- [ ] HSTS present with max-age >= 31536000
- [ ] CSP present and consistent with csp-config.js
- [ ] X-Content-Type-Options: nosniff
- [ ] X-Frame-Options: DENY
- [ ] Restrictive Permissions-Policy
- [ ] COEP: require-corp
- [ ] COOP: same-origin
- [ ] Report-To / Reporting-Endpoints configured
```

### Changes to `extension/manifest.json`
```
- [ ] Minimum permissions required
- [ ] CSP present and restrictive
- [ ] content_security_policy valid for Manifest V3
- [ ] incognito: split configured
- [ ] No unnecessary host_permissions
```

### Changes to `package.json`
```
- [ ] npm audit --omit=dev with no High/Critical vulnerabilities
- [ ] Dependabot configured and working
- [ ] Overrides keep safe versions
- [ ] No dependencies are added without justification
- [ ] The supply chain is reviewed (SLSA, provenance)
```

---

## Program Metrics

| Metric | Target | Measurement |
|---------|----------|----------|
| Mean time to remediate P0 | < 1h | From detection to deployed fix |
| Mean time to remediate P1 | < 4h | From detection to deployed fix |
| Open High/Critical vulnerabilities | 0 in production | `npm run check:security-internal` |
| Annual penetration tests | >= 2 | Scheduled and executed |
| CI security gate coverage | 100% | `check:security-internal` as a required gate |
| Active champions | >= 1 per team | Recorded in this document |
| DAST false positives | < 5% | Quarterly review |

---

## Recognition

Security Champions receive:
- Recognition in the release notes
- Priority when choosing security features
- A bonus in the performance evaluation
- Access to premium security tooling
- Company-funded attendance at security conferences

---

## Review and Continuous Improvement

This document is reviewed quarterly, or after any significant security
incident. Changes are proposed through a PR and discussed at the weekly
security meeting.

Last updated: September 2026
Next review: December 2026
