# Informe de estado de release — BookmarkForge

**Fecha:** 19-sep-2026 · **Estado: release candidate (verde técnico)** — pendientes externos/operativos antes de etiquetar.

Este informe consolida la verificación completa de regresión ejecutada el 19-sep-2026 tras la auditoría y remediación de la sesión. Debe regenerarse (o actualizarse manualmente) antes de cada corte de release; el índice documental lo lista automáticamente al existir en `docs/`.

## Verificación completa de regresión

| Verificación | Resultado | Detalle |
|---|---|---|
| `npm run check` | PASS | Todos los gates (docs, seguridad, i18n, SEO, workflows), freeze intacto |
| `npm run test:fast` | PASS | 152 archivos, todos dentro de presupuestos de tiempo |
| `npm run test:extension` | PASS | 61/61 tests |
| `npm run build:ci` | PASS | Entry 0,55 MB · precache 7,25/10 MB · total 15,89 MB · 342 chunks |
| `npm audit --omit=dev --audit-level=high` | PASS | 0 vulnerabilidades |
| `npm run typecheck` | PASS | Sin errores |
| `npm run lint` | PASS | 1.407 archivos |

## Trabajo consolidado en la sesión

| Área | Cambio | Verificación |
|---|---|---|
| Documentación | Retiro masivo no conforme (ADRs, legal, runbooks) revertido conforme a ADR-026; ADR-059 registra la política de retiro controlado | Gates documentales en verde con corpus completo |
| SecurityVault | La clave del dispositivo se bloquea si falla la tokenización durante `unlock()` | 117/117 + regresión específica |
| KDF salt sync | Cola secuencial anti-carrera entre pestañas y generación de ciclo de vida | 45/45 |
| SecureStorage | Comprobación de ciclo de vida antes de persistir wrappers tras lock/close | 86/86 |
| Backups locales | Normalización de contraseñas con espacios en export/import | 179/179 |
| Restauración | Parser Base64 defensivo único compartido por todas las rutas (cloud, auto-restore, adjuntos, TTS, FolderSync, exporter) | 15/15 parser + 231/231 flujos |
| Cloud sync | Retención remota configurable en UI y 7 adaptadores, pruebas hostiles de restauración, sidecar HMAC por versión verificado antes de descifrar | 210/210 |

## Bloqueantes restantes

Ninguno verificable de forma automatizada en el repositorio. Quedan:

1. **Pentest manual** y revisión WCAG de accesibilidad: externos, no automatizables.
2. **Operaciones**: responsable y canal de alertas, secretos y permisos reales de despliegue, confirmación del entorno del proveedor.
3. **Git**: sin remote configurado (advisory). La sesión está commiteada por áreas (7 commits). Quedan sin commit: el renumerado ADR-026→ADR-059 con su retirada revertida (a ejecutar archivo a archivo vía `check:docs-retire`, no cableado en `check`), baselines documentales regenerados y ediciones ajenas (package.json/lock, navigation.ts, importer.markdown.ts).

## Riesgos menores conocidos (no bloqueantes)

- Aviso de build `INEFFECTIVE_DYNAMIC_IMPORT` en `src/services/security-vault/integrity.ts`: resuelto — importaciones unificadas a estáticas sin impacto en presupuestos.
- Los backups remotos anteriores a la versión del sidecar HMAC no llevan tag de integridad; siguen autenticados por AES-GCM.
- Los avisos `zeroPasswordBytes` durante los tests son diagnósticos de doble zeroización; no implican fuga.

## Procedimiento de actualización

1. Ejecutar la matriz de regresión de la tabla superior.
2. Actualizar fecha, tablas y bloqueantes en este documento.
3. Regenerar el inventario con `node scripts/doctor-docs-index.mjs --update`.
4. Verificar con `npm run check:docs-markdown` y `npm run check`.
