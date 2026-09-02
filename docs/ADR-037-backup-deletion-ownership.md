# ADR-037: Propiedad del borrado de backups — nunca archivos ajenos

- **Estado:** aceptado (implementado; este registro formaliza la decisión existente)
- **Fecha:** 2026-09-02 (retro-documentado desde el código y el catálogo de anclas)

## Contexto

El `DiskBackupService` poda backups viejos en la carpeta elegida por el usuario
(contrato de retención formalizado en ADR-032 D1). La carpeta es **del
usuario**, no del servicio: puede contener cualquier cosa (notas, documentos,
otros backups de otras herramientas). Un error de filtrado al podar —borrar por
antigüedad *todos* los archivos de la carpeta o por extensión genérica `.bmf`–
destruiría datos que BookmarkForge no creó y sobre los que no tiene derecho de
borrado. El ancla `disk-backup-pruning-contract` se cataloga como
`ADR-032 D1 / ADR-037`: D1 fija la retención, ADR-037 fija la **propiedad** del
borrado.

## Decisión

1. **Solo se eliminan archivos con el prefijo propio.** La poda construye la
   lista de candidatos filtrada exclusivamente por `bookmarkforge-backup-`
   (`BACKUP_FILE_PREFIX`); cualquier archivo que no empiece por ese prefijo se
   ignora aunque sea antiguo, grande o se llame `other-backup.bmf` (test:
   62 propios + `notes.md` + `other-backup.bmf` → se eliminan solo los 2
   propios más antiguos; los ajenos nunca aparecen en las llamadas a
   `removeEntry` — ancla `disk-backup-pruning-contract` en
   `src/tests/services/DiskBackupService.test.ts`).
2. **Fail-closed en la selección, fail-open en el borrado individual.**
   El filtrado de nombres es estricto (fail-closed: un nombre desconocido nunca
   entra en la lista de eliminación); si un `removeEntry` falla, el error se
   loguea con `logger.warn` y la poda continúa con el resto — un borrado
   individual fallido no bloquea la limpieza del exceso.
3. **Contrato de superficie estable.** El prefijo `bookmarkforge-backup-` es un
   contrato de formato de archivo estable: los backups llevan fecha en el nombre
   (`bookmarkforge-backup-YYYY-MM-DD.bmf`) y la antigüedad se ordena por el
   nombre, no por metadatos del sistema de archivos.

## Consecuencias

- La rotación de backups se puede apuntar con seguridad a una carpeta compartida
  (p. ej. raíz de la nube del usuario): el servicio nunca borra nada que no haya
  creado con su propio prefijo.
- El prefijo queda reservado: ningún otro archivo del usuario con un nombre que
  empiece por `bookmarkforge-backup-` debe vivir en la carpeta, o podría ser
  podado si supera la retención.
- La variante de seguridad de la regla (añadir extensiones, prefijos adicionales
  o poda por antigüedad ciego) es un cambio a nivel ADR — el test anclado lo
  bloquea en CI vía `check:audit-drift`, compartiendo ancla con ADR-032 D1.