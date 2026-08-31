# Checklist de seguridad interna

Este documento delimita lo que puede verificarse desde el repositorio, sin acceso a GitHub, staging, producción ni proveedores externos.

## Gates locales obligatorios

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

## Controles cubiertos

- Imágenes de producción identificadas por `IMAGE_TAG`, nunca por `latest`.
- API ejecutada como usuario no-root.
- Redis configurado en modo `fail-closed`.
- Licencia requerida en producción.
- Puertos publicados de staging ligados a loopback.
- CSP, HSTS y headers HTTP de seguridad presentes.
- Upstream Nginx con puerto explícito.
- Secretos y archivos `.env` reales excluidos de commits.
- Workflows con permisos declarados y sin interpolación de secretos en Docker.
- Tests unitarios de los gates de seguridad.
- SAST independiente (CodeQL + Semgrep) en CI con gate de severidad High/Critical (`scripts/check-sarif-severity.mjs`).
- Contexto DAST autenticado opt-in, limpieza garantizada y archivos temporales con permisos restrictivos.
- Workflows DAST/staging sin comandos dinámicos ni referencias mutables de imágenes.

## No se puede verificar localmente

- Existencia real de equipos y usuarios de `CODEOWNERS`.
- Protección efectiva de `main` en GitHub.
- Hashes actuales de actions remotas e imágenes Docker de ZAP; deben verificarse contra sus releases oficiales antes de incorporarse.
- Secretos de GitHub Actions.
- Configuración de environments y revisores.
- Seguridad de la infraestructura de staging/producción.
- DAST real, pentest, carga, restore y rollback operativo.
- Hallazgos reales de CodeQL/Semgrep (requieren ejecución en CI).
- Activación del DAST autenticado: permanece deshabilitado hasta verificar contexto, digest de imagen y SHA de la action.
- Cumplimiento jurídico RGPD.
