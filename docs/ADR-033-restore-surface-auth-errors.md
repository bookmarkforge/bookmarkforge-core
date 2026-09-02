# ADR-033: Superficie de restore — los errores de autenticación nunca ofrecen restaurar

- **Estado:** aceptado (implementado; este registro formaliza la decisión existente)
- **Fecha:** 2026-09-02 (retro-documentado desde el código y el catálogo de anclas)

## Contexto

La pantalla de error de base de datos de `AppContent` ofrece un camino de
recuperación "Restore from backup file" cuando el storage está dañado
(corrupción `INACCESSIBLE`/`UNKNOWN` — legacy F0-2: el DB error screen debe
ofrecer la ruta de recovery, no solo un Retry infinito). Pero no todos los
errores de BD significan corrupción: los flujos de autenticación
(`WRONG_PASSWORD`, `VAULT_LOCKED`) indican que la BD está **sana** y solo hace
falta la credencial/desbloqueo correctos. Ofrecer un restore destructivo ahí
confundiría al usuario y provocaría un borrado innecesario de datos.

## Decisión

1. **D3 — `WRONG_PASSWORD` y `VAULT_LOCKED` nunca muestran la acción de
   restore.** Cuando el `dbErrorClass` es `WRONG_PASSWORD` o `VAULT_LOCKED`, la
   pantalla de error de BD no renderiza: el botón "Restore from backup file", el
   texto de hint de corrupción ("Your database appears damaged…") **ni** el file
   input oculto (`restore-backup-input`). Los tres deben estar ausentes (ancla
   `wrong-password-no-restore` en `src/tests/app/AppContent.test.tsx`, que cubre
   ambos classes por separado).
2. **Contraste explícito con la corrupción.** El restore sigue presente
   únicamente para clases de error que indican storage dañado
   (`INACCESSIBLE`/`UNKNOWN`, DB3), donde la recuperación desde backup es la
   ruta correcta. La superficie se decide por clase de error, no por el mensaje
   crudo — el clasificador (`dbErrorClass`) ya está normalizado en la capa de
   inicio de BD (ADR-019 / `database.ts`).

## Consecuencias

- El usuario con password equivocado o vault bloqueado ve únicamente el aviso de
  autenticación y reintenta; no hay riesgo de borrado accidental desde la pantalla
  de error.
- La distinción corrupción-vs-autenticación queda anclada por test de regresión:
  un refactor que reintroduzca el restore para errores de auth rompe
  `check:audit-drift` (ancla en el catálogo como `ADR-033 D3`).
- Los flujos D1/D2 de la serie ADR-033 (clasificación y presentación genérica de
  errores de BD) quedan fuera del catálogo de anclas y no se formalizan aquí —
  solo D3 tiene ancla de regresión.