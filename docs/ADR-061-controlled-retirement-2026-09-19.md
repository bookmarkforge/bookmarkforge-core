# ADR-061: Retiro controlado de documentación — primer lote (2026-09-19)

- **Estado:** Aceptada (2026-09-19)
- **Fecha:** 2026-09-19
- **Relacionadas:** [ADR-026 — retiro controlado de documentación](ADR-059-documentation-retirement.md), [ADR-028 — gate drift detection](ADR-028-gate-drift-detection.md), [ADR-040 — fusión del gate de markdown](ADR-040-docs-markdown-gate-fusion.md)

## Contexto

El retiro masivo de documentación de septiembre de 2026 se ejecutó **sin pasar por el mecanismo de consentimiento** de ADR-026: el gate `check:docs-retire` consiente únicamente filas marcadas `retirable` cuyos archivos **siguen existiendo**, y no estaba cableado en `npm run check`, así que nada impidió que 79 documentos desaparecieran de golpe — incluido material de cumplimiento sin reemplazo equivalente. La restauración del corpus dejó el mecanismo intacto pero inerte: el gate existía, tenía contrato probado, y nadie lo ejecutaba.

Este ADR registra el **primer retiro controlado real** ejecutado a través de ese mecanismo, archivo a archivo, con el rationale exigido por ADR-026.

## Decisión

El retiro se ejecuta con el mecanismo de ADR-026 completo: consentimiento previo del gate sobre filas `retirable`, borrado, revisión de referencias vivas, regeneración de índice y baseline, y registro durable del rationale archivo a archivo.

### 1. El gate pasa a ser obligatorio

`check:docs-retire` (`scripts/check-docs-retire.mjs`) se integra en la cadena `npm run check`, inmediatamente después de `check:docs-markdown`. Desde ahora, cualquier fila `retirable` que no cumpla las condiciones de consentimiento (nota vacía, archivo ausente, ruta fuera de `docs/`) rompe CI, y el estado transitorio `retirable` no puede sobrevivir a un commit (el índice canónico no lo expresa y `doctor-docs-index` lo rechaza).

En el export público el índice es privado y no viaja: el gate hace un *skip* explícito cuando detecta la ausencia del índice junto al `manifest.json` del export. Sin manifest, la ausencia del índice sigue siendo fallo (exit 2).

### 2. Archivos retirados (consentimiento obtenido: 3/3 filas `retirable`)

| Archivo retirado | Por qué es prescindible | Referencias actualizadas |
|---|---|---|
| `docs/audit-report-2026-09-04.md` | Delta de auditoría sobre el informe del 2026-09-02, declarado **superado por el ledger** `docs/audit.md` en su propio hallazgo A6-6. Su contenido vive en el ledger y en el informe primario. | Fila A6-6 de `docs/audit.md` reescrita para reflejar el retiro y explicar por qué se conserva el informe primario. |
| `docs/drill-run-2026-08-31-rollback-docker.md` | Registro de una ejecución **FAIL** del drill de rollback Docker (falló en PREP). La evidencia vigente es la re-ejecución **PASS** documentada en `docs/operations.md` y en el ledger; el registro fallido describía un estado ya corregido. | Enlace eliminado de `docs/launch-checklist.md` (evidencia 13) y cita retirada de la fila del ledger `docs/audit.md`. |
| `docs/release-note-r3-4.md` | Nota de release puntual (2026-08-31, rondas 3/4) con **cero referencias vivas** en el repositorio; su alcance está cubierto por `docs/RELEASE-STATUS.md`, el ledger `docs/audit.md` y los runbooks de operaciones. | Ninguna (no tenía referencias). |

### 3. Archivos evaluados y **rechazados** (se conservan)

| Archivo | Motivo de conservación |
|---|---|
| `docs/audit-report-2026-09-02.md` | Es la **provenance** de los hallazgos M-1 y B-1, citados por ADR-038, ADR-039, `scripts/sw-integrity-runtime.js` y un test de regresión de seguridad. Retirarlo exigiría reescribir citas en ADRs de seguridad y en código. |
| `docs/que-nos-falta.md` | ~~Retirado~~ (2026-09-19, este commit). Las 4 deudas únicas (bucket S3 lifecycle, action compuesta de sign/rewrite, paridad de rampa streak en SVG de consistencia, test flaky monitoring-alerts) se migraron a `docs/ops-nightly.md` §8 y `docs/PENDIENTES.md` P2. Contenido operativo restante (bloqueantes de infraestructura, cierre legal, orden de ejecución) verificado como cubierto por las 4 fuentes vivas. |
| `docs/legacy-compatibility-plan.md` | **Activo** (política de retirada de compatibilidad con propietario y criterios de retirada por superficie). |
| `docs/scripts-inventory-scanner-limits.md` | **Activo** (documentación operativa del gate `check:audit-script-snapshot`). |
| `docs/ios-day0-session-sheet.md`, `docs/p2p-sync-session-prep.md` | Material operativo vivo: referenciados por `docs/launch-checklist.md` y por `scripts/capture-p2p-desk-drill.mjs`. |
| `docs/history-attribution.md` | Registro de decisión único (por qué no se reescribió el historial); no existe fuente alternativa. |
| Resto del corpus (seguridad, cumplimiento, RPO/RTO, contratos de API, ADRs, manuales) | Categorías protegidas por ADR-026 o documentación de producto viva. |

## Consecuencias

- El inventario canónico baja a 101 documentos y el baseline de `check:docs-markdown` a 100 archivos; ambos regenerados en el mismo cambio.
- **Posteriormente** (2026-09-19, mismo día): `docs/que-nos-falta.md` se retiró tras migrar sus 4 deudas únicas a `ops-nightly.md` §8 y `PENDIENTES.md` P2; el inventario queda en **102 documentos** (101 − 1 + `CHANGELOG.md`).
- El retiro queda trazado aquí (ADR-026 acepta PENDIENTES.md o un ADR como registro) y las referencias vivas apuntan ahora a las fuentes vigentes, no a artefactos superados.
- Los retiros futuros repiten el flujo: marcar `retirable` con nota, pasar el gate, borrar, actualizar referencias, regenerar índice y baseline, y registrar el rationale. El estado intermedio `retirable` nunca se commitea.
- El gate en CI impide que una marca de retiro con razón insuficiente o referencias sin revisar llegue a `main`.
