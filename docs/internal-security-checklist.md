# Internal security checklist

This document delimits what can be verified from the repository, without access to GitHub, staging, production or external providers.

## Mandatory local gates

```bash
npm ci
npm run typecheck:prod
npm run lint
npm run test:fast
npm run check:secrets-in-commit
npm run check:workflows
npm run check:http-config
npm run check:compose-config
npm run check:runtime-config
npm run check:zap-baseline
npm run check:zap-workflow
npm run check:workflow-security
npm run build:ci
```

## Covered controls

- Production images identified by `IMAGE_TAG`, never by `latest`.
- API executed as non-root user.
- Redis configured in `fail-closed` mode.
- License required in production.
- Staging published ports bound to loopback.
- CSP, HSTS and HTTP security headers present.
- Upstream Nginx with explicit port.
- Real secrets and `.env` files excluded from commits.
- Workflows with declared permissions and without secret interpolation in Docker.
- Unit tests of security gates.
- Independent SAST (CodeQL + Semgrep) in CI with High/Critical severity gate (`scripts/check-sarif-severity.mjs`).
- Authenticated DAST context opt-in, guaranteed cleanup and temporary files with restrictive permissions.
- DAST/staging workflows without dynamic commands or mutable image references.

## Cannot verify locally

- Effective configuration of `main` protection in GitHub for the single maintainer.
- Effective protection of `main` in GitHub.
- Current hashes of remote actions and ZAP Docker images; must be verified against their official releases before incorporation.
- GitHub Actions secrets.
- Environment configuration and deployment permissions.
- Security of staging/production infrastructure.
- Real DAST, pentest, load, restore and operational rollback.
- Real CodeQL/Semgrep findings (require CI execution).
- Authenticated DAST activation: remains disabled until verifying context, image digest and action SHA.
- GDPR legal compliance.
