# BookmarkForge Scripts

This directory contains **all build, verification, and operational tools**
for the project. Each script is designed for a specific purpose and is
invoked from `package.json`.

## Script Classification

### 🔒 Security and Verification (42 scripts)

| Script | Purpose |
|--------|---------|
| `check-secrets-in-commit.mjs` | Scans git history for secrets |
| `check-server-log-ip-privacy.mjs` | Verifies server logs don't expose IPs |
| `check-blindeo.mjs` | Blindeo security scanner |
| `check-zap-baseline.mjs` | OWASP ZAP baseline scan |
| `validate-zap-workflow.mjs` | Validates the ZAP workflow |
| `check-workflow-security.mjs` | Verifies CI/CD workflow security |
| `check-workflow-vars-documented.mjs` | Ensures workflow variables are documented |
| `validate-workflow-artifacts.mjs` | Validates workflow artifacts |
| `validate-workflows.mjs` | Validates all YAML workflows |
| `validate-http-config.mjs` | HTTP configuration security |
| `validate-compose-config.mjs` | Docker Compose security |
| `validate-runtime-config.mjs` | Validates runtime configuration |
| `validate-docker-context.mjs` | Docker context security |
| `validate-image-pins.mjs` | Verifies container image digests |
| `validate-repository-hygiene.mjs` | Repository hygiene |
| `check-override-cve.mjs` | CVE override gate |
| `check-direct-cve.mjs` | Direct CVE scan |
| `check-sarif-severity.mjs` | SARIF result severity |
| `pro-boundary.mjs` | Core/Pro build boundary |
| `check-pro-imports.mjs` | Detects static Pro imports in Core |
| `check-open-core-export.mjs` | Verifies the Open Core export |
| `check-pro-routes.mjs` | Verifies Pro routes are protected |
| `audit-core.mjs` | Core audit |
| `audit-anchors.mjs` | Manages audit anchors |
| `check-audit-drift.mjs` | Detects audit drift |
| `check-inspector-freeze.mjs` | Inspector freeze gate |
| `check-csp-sync.mjs` | Syncs CSP |
| `check-extension-csp.mjs` | Extension CSP |
| `check-docs-markdown.mjs` | Validates Markdown docs |
| `check-baseline-drift.mjs` | Visual baseline drift |
| `check-baseline-gaps.mjs` | Baseline gaps |
| `check-brand-logo-consistency.mjs` | Brand consistency |
| `check-static-brand-tokens.mjs` | Static brand tokens |
| `check-tailwind-rule-drift.mjs` | Tailwind rule drift |
| `check-rxdb17.mjs` | RxDB 17 compatibility |
| `check-i18n-quality.mjs` | i18n quality |
| `check-code-i18n.mjs` | Code i18n |
| `check-english-only.mjs` | Verifies exclusive English |
| `check-claim-drift.mjs` | Claim drift |

### 📦 Build and Generation (24 scripts)

| Script | Purpose |
|--------|---------|
| `build-ci.mjs` | CI build with additional gates |
| `build-extension.cjs` | Browser extension build |
| `build-landings.cjs` | Generates landing pages |
| `generate-pdf-localized.mjs` | Generates localized PDFs |
| `generate-privacy-pages.mjs` | Generates privacy pages |
| `generate-landing-pages.mjs` | Generates landing pages |
| `nginx-render.mjs` | Renders nginx configuration |
| `ci-local-parallel.mjs` | Local CI in parallel |
| `command-runner.mjs` | Command runner |
| `production-smoke.mjs` | Production smoke test |
| `local-smoke.mjs` | Local smoke test |
| `run-launch-smoke.mjs` | Launch smoke test |
| `extension-smoke.mjs` | Extension smoke test |
| `mock-openai-server.mjs` | OpenAI mock server |
| `webrtc-recovery-history.mjs` | WebRTC recovery history |
| `render-webrtc-recovery-charts.mjs` | WebRTC recovery charts |
| `summarize-webrtc-e2e.mjs` | WebRTC E2E summary |
| `summarize-webrtc-handshake.mjs` | WebRTC handshake summary |
| `check-webrtc-certification.mjs` | WebRTC certification |

### 🧪 Testing and Metrics (22 scripts)

| Script | Purpose |
|--------|---------|
| `test-bounded.mjs` | Bounded test runner |
| `test-fast.mjs` | Fast tests |
| `test-profiles.mjs` | Test profiles |
| `test-timing-baseline.json` | Test timing baseline |
| `check-test-timing.mjs` | Verifies test timing |
| `test-timing-report.mjs` | Timing report |
| `run-coverage-gates.mjs` | Coverage gates |
| `test-coverage-history.mjs` | Coverage history |
| `run-e2e-batched.mjs` | Batched E2E |
| `run-launch-smoke.mjs` | Launch smoke test |
| `run-mobile-smoke.mjs` | Mobile smoke test |
| `test-ollama-contract.mjs` | Ollama contract |
| `benchmark-storage.mjs` | Storage benchmark |
| `benchmark-import-csv.mjs` | CSV import benchmark |
| `calibrate-first-summary.mjs` | First summary calibration |
| `rollback.mjs` | Rollback |
| `gate-refresh.mjs` | Refreshes gates |

### 📊 Monitoring and DevOps (18 scripts)

| Script | Purpose |
|--------|---------|
| `check-env-config.mjs` | Environment configuration |
| `check-quick.mjs` | Quick gate tier (~2.5s) |
| `check-quick.mjs` | Quick pre-commit tier |
| `validate-input-contracts.mjs` | Input contracts |
| `validate-input-contracts.mjs` | Input contract checks |
| `doctor-docs-index.mjs` | Docs index doctor |
| `doctor-legacy-schema-map.mjs` | Legacy schema doctor |
| `env-direct-reads.baseline.json` | Direct reads baseline |
| `pull-prod-images.mjs` | Pull production images |
| `push-images-lib.mjs` | Image push library |
| `registry-policy.mjs` | Registry policy |
| `monitoring-alerts.mjs` | Monitoring alerts |
| `nightly-consistency.mjs` | Nightly consistency |
| `nightly-trends.mjs` | Nightly trends |
| `merge-nightly-blobs.mjs` | Merge nightly blobs |

### 🎨 Generation and Utilities (various scripts)

| Script | Purpose |
|--------|---------|
| `i18n-completeness.mjs` | i18n completeness |
| `i18n-quality-baseline.json` | i18n quality baseline |
| `i18n-backlog-baseline.json` | i18n backlog baseline |
| `translations/` | Translations directory |
| `locales/` | Locales directory |
| `public-export/` | Public export |
| `tooling/` | Auxiliary tooling |
| `templates/` | Templates |
| `structured-data/` | Structured data |
| `check-sitemap-coverage.mjs` | Sitemap coverage |
| `check-sitemap-coverage.mjs` | Sitemap coverage check |
| `check-hreflang-graph.mjs` | Hreflang graph |
| `generate-privacy-pages.mjs` | Generates privacy pages |
| `privacy-translations.json` | Privacy translations |
| `landing-translations.json` | Landing translations |
| `og-image-locale-gen.mjs` | Generates OG images per locale |
| `generate-legacy-schema-map.mjs` | Generates legacy schema map |
| `build-legacy-schema-map.mjs` | Builds legacy schema map |

## Naming Conventions

- `check-*`: Verification scripts (fail fast)
- `validate-*`: Configuration validation scripts
- `build-*`: Build scripts
- `generate-*`: Content generation scripts
- `run-*`: Execution scripts
- `test-*`: Testing-related scripts
- `check-*`: Verification scripts
- `drill-*`: Emergency simulation scripts
- `benchmark-*`: Benchmarking scripts
- `merge-*`: Data merge scripts
- `render-*`: Rendering scripts
- `summarize-*`: Summary scripts
- `doctor-*`: Diagnostic scripts
- `sync-*`: Synchronization scripts
- `pin-*`: Version pinning scripts
- `plan-*`: Planning scripts
- `deploy-*`: Deployment scripts

## Execution

All scripts are executable from the project root:

```bash
# Directly
node scripts/check-secrets-in-commit.mjs
node scripts/export-public-repo.mjs --dry-run
node scripts/build-ci.mjs

# Through npm scripts
npm run check:env
npm run test:fast
npm run build:ci
```

## Contributing New Scripts

1. Place the script in the appropriate category
2. Use the correct naming prefix
3. Document the purpose in the file header
4. Add an entry to this README
5. If it is a CI gate, make sure it works in `npm run check:quick`

## Performance

- `check:quick`: ~2.5s (sub-second gates)
- `npm run check`: ~62s (full chain)
- `npm run test:fast`: ~30s
- `npm run test:slow`: ~5 min
- `npm run build:ci`: ~2 min

## Permissions and Security

- Scripts that touch secrets are in `check-secrets-in-commit.mjs`
- Deploy scripts require explicit tokens
- Build scripts (`build-ci.mjs`) scan for secrets in the resulting bundle
