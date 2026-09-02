# ADR-034: Frescura de la fecha de backup manual y aviso de cuota de almacenamiento

- **Estado:** aceptado (implementado; este registro formaliza las decisiones existentes)
- **Fecha:** 2026-09-02 (retro-documentado desde el código y el catálogo de anclas)

## Contexto

Dos defectos de UX de almacenamiento quedaron registrados en el flujo F0-3
(feedback del usuario en Settings/StorageStatus):

1. **La fecha del último backup no se refrescaba tras una exportación manual.**
   Los indicadores de estado (`StorageStatus`, banner del dashboard) leían la
   fecha desde `forge_last_manual_backup_date` en localStorage, pero el dataset
   era un snapshot viejo: tras exportar, la edad seguía la de la última escritura
   previa hasta un reload — el usuario veía "backup de hace 30 días" justo
   después de exportar.
2. **No había aviso de cuota casi llena.** Con almacenamiento web al 85–95 %, el
   usuario no tenía señal para liberar espacio antes de que fallaran escrituras.

## Decisión

1. **D1 — La exportación manual escribe `LAST_MANUAL_BACKUP_DATE`.** El flujo de
   export desde Settings (`StorageSection` → `Export backup`) persiste la marca
   `forge_last_manual_backup_date` con el timestamp actual inmediatamente tras el
   export, de modo que `StorageStatus` y el banner del dashboard pueden leer la
   edad fresca **sin reload** (ancla `manual-export-refreshes-backup-age` en
   `src/tests/components/settings/StorageSection.test.tsx`, regresión F0-3, que
   verifica timestamp reciente < 5 s y el contrato de escritura vía `safeSet`).
2. **D5 — Aviso de cuota con umbrales.** Cuando `navigator.storage.estimate()`
   supera el **85 %** (warning) o el **95 %** (crítico), el pill de
   `StorageStatus` muestra el botón "Free up space", que abre el
   `StorageCleanupDialog` con acciones concretas ("Export backup first",
   "Clear AI models", "Compact Database"); por debajo del **70 %** el botón no
   aparece (spec E2E `tests/e2e/storage-quota-warning.spec.ts`, anotado como
   F0-3 / ADR-034 D5). El stub de `storage.estimate()` se instala con
   `addInitScript` para sobrevivir al reload del vault setup.

## Consecuencias

- Los indicadores de edad de backup reflejan la verdad del dispositivo tras cada
  exportación; el test D1 es un ancla de regresión (falla `check:audit-drift` si
  la escritura desaparece).
- El aviso de cuota es proporcional (85 % warning / 95 % crítico), accionable y
  testeado E2E con umbrales simulados (el navegador real en CI no llega al 95 %).
- El ancla `manual-export-refreshes-backup-age` se cataloga como
  `ADR-034 D1 / ADR-032` porque comparte dominio con el contrato de backups en
  disco de ADR-032 — cada ADR formaliza su propia mitad del ecosistema de backup.