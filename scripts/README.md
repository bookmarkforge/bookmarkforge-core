# Scripts de BookmarkForge

Este directorio contiene **todas las herramientas de build, verificación y operaciones** del proyecto. Cada script está diseñado para un propósito específico y es invocado desde `package.json`.

## Clasificación de scripts

### 🔒 Seguridad y verificación (42 scripts)

| Script | Propósito |
|--------|-----------|
| `check-secrets-in-commit.mjs` | Escanea el historial git en busca de secretos |
| `check-server-log-ip-privacy.mjs` | Verifica que los logs del servidor no expongan IPs |
| `check-blindeo.mjs` | Escáner de seguridad Blindeo |
| `check-zap-baseline.mjs` | OWASP ZAP baseline scan |
| `validate-zap-workflow.mjs` | Valida el workflow de ZAP |
| `check-workflow-security.mjs` | Verifica seguridad de CI/CD workflows |
| `check-workflow-vars-documented.mjs` | Asegura que las variables de workflow estén documentadas |
| `validate-workflow-artifacts.mjs` | Valida los artefactos de los workflows |
| `validate-workflows.mjs` | Valida todos los workflows YAML |
| `validate-http-config.mjs` | Seguridad de configuración HTTP |
| `validate-compose-config.mjs` | Seguridad de Docker Compose |
| `validate-runtime-config.mjs` | Valida configuración runtime |
| `validate-docker-context.mjs` | Seguridad del contexto Docker |
| `validate-image-pins.mjs` | Verifica digest de imágenes de contenedores |
| `validate-repository-hygiene.mjs` | Higiene del repositorio |
| `check-override-cve.mjs` | CVE override gate |
| `check-direct-cve.mjs` | Escaneo directo de CVEs |
| `check-sarif-severity.mjs` | Severidad de resultados SARIF |
| `generate-license-keys.mjs` | Genera claves de licencia |
| `sync-server-key.mjs` | Sincroniza clave pública del servidor |
| `check-license-keys.mjs` | Verifica paridad de claves license |
| `pro-boundary.mjs` | Frontera de compilación Core/Pro |
| `check-pro-imports.mjs` | Detecta imports Pro estáticos en Core |
| `check-open-core-export.mjs` | Verifica la exportación Open Core |
| `check-pro-routes.mjs` | Verifica que las rutas Pro estén protegidas |
| `audit-core.mjs` | Auditoría del Core |
| `audit-anchors.mjs` | Gestiona anclas de auditoría |
| `check-audit-drift.mjs` | Detecta drift en auditorías |
| `check-inspector-freeze.mjs` | Inspector freeze gate |
| `check-csp-sync.mjs` | Sincroniza CSP |
| `check-extension-csp.mjs` | CSP de la extensión |
| `check-docs-markdown.mjs` | Valida docs Markdown |
| `check-baseline-drift.mjs` | Drift de baselines visuales |
| `check-baseline-gaps.mjs` | Gaps en baselines |
| `check-brand-logo-consistency.mjs` | Consistencia de marca |
| `check-static-brand-tokens.mjs` | Tokens de marca estáticos |
| `check-tailwind-rule-drift.mjs` | Drift de reglas Tailwind |
| `check-rxdb17.mjs` | Compatibilidad RxDB 17 |
| `check-i18n-quality.mjs` | Calidad i18n |
| `check-code-i18n.mjs` | i18n en código |
| `check-english-only.mjs` | Verifica inglés exclusivo |
| `check-no-unbounded-text.mjs` | Texto no acotado |
| `check-claim-drift.mjs` | Drift de afirmaciones |
| `check-licensing.mjs` | Verifica licencias |

### 📦 Build y generación (24 scripts)

| Script | Propósito |
|--------|-----------|
| `export-public-repo.mjs` | Exporta el repositorio público MIT |
| `build-ci.mjs` | Build de CI con gates adicionales |
| `build-extension.cjs` | Build de la extensión de navegador |
| `build-landings.cjs` | Genera páginas de aterrizaje |
| `generate-pdf-localized.mjs` | Genera PDFs localizados |
| `generate-privacy-pages.mjs` | Genera páginas de privacidad |
| `generate-landing-pages.mjs` | Genera landing pages |
| `nginx-render.mjs` | Renderiza configuración nginx |
| `ci-local-parallel.mjs` | CI local en paralelo |
| `command-runner.mjs` | Runner de comandos |
| `deploy-prod.mjs` | Despliegue a producción |
| `staging-deploy.mjs` | Despliegue a staging |
| `staging-rollback.mjs` | Rollback de staging |
| `staging-smoke.mjs` | Smoke test de staging |
| `production-smoke.mjs` | Smoke test de producción |
| `local-smoke.mjs` | Smoke test local |
| `launch-smoke.mjs` | Smoke test de lanzamiento |
| `extension-smoke.mjs` | Smoke test de extensión |
| `mock-openai-server.mjs` | Servidor mock de OpenAI |
| `webrtc-recovery-history.mjs` | Historial de recuperación WebRTC |
| `render-webrtc-recovery-charts.mjs` | Gráficos de recuperación |
| `summarize-webrtc-e2e.mjs` | Resumen de E2E WebRTC |
| `summarize-webrtc-handshake.mjs` | Resumen de handshake WebRTC |
| `check-webrtc-certification.mjs` | Certificación WebRTC |

### 🧪 Testing y métricas (22 scripts)

| Script | Propósito |
|--------|-----------|
| `test-bounded.mjs` | Runner de tests acotados |
| `test-fast.mjs` | Tests rápidos |
| `test-profiles.mjs` | Perfiles de test |
| `test-timing-baseline.json` | Baseline de tiempo de tests |
| `check-test-timing.mjs` | Verifica timing de tests |
| `test-timing-report.mjs` | Reporte de timing |
| `run-coverage-gates.mjs` | Gates de cobertura |
| `test-coverage-history.mjs` | Historial de cobertura |
| `run-e2e-batched.mjs` | E2E en batches |
| `run-launch-smoke.mjs` | Smoke test de lanzamiento |
| `run-mobile-smoke.mjs` | Smoke test móvil |
| `test-ollama-contract.mjs` | Contrato de Ollama |
| `load-test-server.mjs` | Load test del servidor |
| `benchmark-storage.mjs` | Benchmark de almacenamiento |
| `benchmark-import-csv.mjs` | Benchmark de import CSV |
| `calibrate-first-summary.mjs` | Calibración de resumen |
| `kpi-report.mjs` | Reporte de KPIs |
| `health-dashboard.mjs` | Dashboard de salud |
| `drill-backup-restore.mjs` | Drill de backup/restore |
| `drill-rollback.mjs` | Drill de rollback |
| `rollback.mjs` | Rollback |
| `gate-refresh.mjs` | Refresca gates |

### 📊 Monitoreo y DevOps (18 scripts)

| Script | Propósito |
|--------|-----------|
| `check-env-config.mjs` | Configuración de entorno |
| `check-quick.mjs` | Tier rápido de gates (~2.5s) |
| `check-quick.mjs` | Tier rápido de pre-commit |
| `validate-input-contracts.mjs` | Contratos de entrada |
| `check-input-contracts.mjs` | Checks de contratos |
| `check-staging-http.mjs` | HTTP de staging |
| `staging-target-policy.mjs` | Política de objetivos |
| `doctor-docs-index.mjs` | Doctor del índice de docs |
| `doctor-legacy-schema-map.mjs` | Doctor del schema legacy |
| `env-direct-reads.baseline.json` | Baseline de lecturas directas |
| `pull-prod-images.mjs` | Pull de imágenes de producción |
| `push-images-lib.mjs` | Biblioteca de push de imágenes |
| `push-images-lib.mjs` | Push de imágenes |
| `registry-policy.mjs` | Política de registro |
| `monitoring-alerts.mjs` | Alertas de monitoreo |
| `monitoring-cron.example` | Cron de monitoreo |
| `nightly-alert.mjs` | Alertas nocturnas |
| `nightly-consistency.mjs` | Consistencia nocturna |
| `nightly-trends.mjs` | Tendencias nocturnas |
| `merge-nightly-blobs.mjs` | Merge de blobs nocturnos |

### 🎨 Generación y utilidades (varios scripts)

| Script | Propósito |
|--------|-----------|
| `i18n-completeness.mjs` | Completitud i18n |
| `i18n-quality-baseline.json` | Baseline de calidad i18n |
| `i18n-backlog-baseline.json` | Backlog i18n |
| `translations/` | Directorio de traducciones |
| `locales/` | Directorio de locales |
| `public-export/` | Exportación pública |
| `tooling/` | Herramientas auxiliares |
| `templates/` | Plantillas |
| `structured-data/` | Datos estructurados |
| `sitemap-coverage.mjs` | Cobertura de sitemap |
| `check-sitemap-coverage.mjs` | Check de sitemap |
| `check-hreflang-graph.mjs` | Grafo de hreflang |
| `check-privacy-pages.mjs` | Páginas de privacidad |
| `generate-privacy-pages.mjs` | Genera páginas de privacidad |
| `privacy-translations.json` | Traducciones de privacidad |
| `landing-translations.json` | Traducciones de landing |
| `patch-landing-copy.mjs` | Parchea copy de landing |
| `og-image-locale-gen.mjs` | Genera OG images por locale |
| `generate-legacy-schema-map.mjs` | Genera schema map legacy |
| `build-legacy-schema-map.mjs` | Build de schema map legacy |

### 🗑️ Retirados / obsoletos (4 scripts)

| Script | Estado | Razón |
|--------|--------|-------|
| `test-upstream-server.mjs` | Retirado | El proxy Gemini fue eliminado |
| `ai-upstream/` | Retirado | El proxy de IA ya no existe |
| `check-webrtc-certification.mjs` | Activo | Solo usado en CI específico |
| `penetration-test.mjs` | Activo | Test de penetración |

## Convenciones de nomenclatura

- `check-*`: Scripts de verificación (fail fast)
- `validate-*`: Scripts de validación de configuración
- `build-*`: Scripts de construcción
- `generate-*`: Scripts que generan contenido
- `run-*`: Scripts que ejecutan algo
- `test-*`: Scripts relacionados con testing
- `check-*`: Scripts de verificación
- `drill-*`: Scripts de simulación de emergencia
- `benchmark-*`: Scripts de benchmarking
- `merge-*`: Scripts de merge de datos
- `render-*`: Scripts de renderizado
- `summarize-*`: Scripts de resumen
- `doctor-*`: Scripts de diagnóstico
- `sync-*`: Scripts de sincronización
- `pin-*`: Scripts de fijación de versiones
- `plan-*`: Scripts de planificación
- `deploy-*`: Scripts de despliegue

## Ejecución

Todos los scripts son ejecutables desde la raíz del proyecto:

```bash
# Directamente
node scripts/check-secrets-in-commit.mjs
node scripts/export-public-repo.mjs --dry-run
node scripts/build-ci.mjs

# A través de npm scripts
npm run check:env
npm run test:fast
npm run build:ci
```

## Contribuir con nuevos scripts

1. Coloca el script en la categoría apropiada
2. Usa el prefijo de nomenclatura correcto
3. Documenta el propósito en el header del archivo
4. Agrega una entrada en este README
5. Si es un gate de CI, asegúrate de que funcione en `npm run check:quick`

## Performance

- `check:quick`: ~2.5s (sub-second gates)
- `npm run check`: ~62s (cadena completa)
- `npm run test:fast`: ~30s
- `npm run test:slow`: ~5 min
- `npm run build:ci`: ~2 min

## Permisos y seguridad

- Los scripts que tocan secretos están en `check-secrets-in-commit.mjs`
- Los scripts de deploy requieren tokens explícitos
- Los scripts de exportación (`export-public-repo.mjs`) nunca exponen código Pro
- Los scripts de build (`build-ci.mjs`) escanean secrets en el bundle resultante
