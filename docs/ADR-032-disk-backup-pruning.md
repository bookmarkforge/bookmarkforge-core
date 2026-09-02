# ADR-032: Contrato de pruning de backups en disco

- **Estado:** aceptado (implementado; este registro formaliza la decisión existente)
- **Fecha:** 2026-09-02 (retro-documentado desde el código y el catálogo de anclas)

## Contexto

El `DiskBackupService` (backup cifrado del vault a una carpeta elegida por el
usuario vía File System Access API) escribe backups con prefijo propio
`bookmarkforge-backup-*.bmf` y fechados. Sin límite, la carpeta crecería sin
tope; con un pruning imprudente, el servicio podría borrar archivos del usuario
que nada tienen que ver con BookmarkForge. La decisión D1 fija el contrato de
retención; el follow-up de seguridad (quién puede borrar qué, y por qué nunca
archivos ajenos) se formaliza en ADR-037, y el ancla de regresión compartida
(`disk-backup-pruning-contract`) referencia ambos.

## Decisión

1. **D1 — Retención acotada a `MAX_BACKUP_FILES`.** El servicio conserva solo
   los **60** backups propios más recientes (`MAX_BACKUP_FILES = 60`): al escribir
   un backup nuevo, poda los más antiguos en exceso dentro de su propio prefijo
   (test: 62 propios → conserva 60 → elimina los 2 más antiguos), y nunca toca
   archivos ajenos (`notes.md`, `other-backup.bmf` en la misma carpeta quedan
   intactos — ancla `disk-backup-pruning-contract` en
   `src/tests/services/DiskBackupService.test.ts`).
2. **D1 (detalle) — Poda solo del prefijo propio.** La poda itera los names de la
   carpeta, filtra exclusivamente `bookmarkforge-backup-*`, ordena por fecha y
   elimina con `removeEntry` únicamente el exceso sobre `MAX_BACKUP_FILES`. Un
   fallo de `removeEntry` se loguea con `logger.warn` y no aborta el resto de la
   operación (fail-open en el borrado individual, fail-closed en el contrato: los
   nombres incorrectos nunca entran en la lista de eliminación).

## Consecuencias

- El uso de disco de los backups está acotado a ~60 rotaciones independientemente
  de la frecuencia de exportación manual.
- La poda es de "prefijo estricto": el contrato nunca borra archivos que no sean
  del propio servicio, lo que hace seguro apuntar el backup a una carpeta que
  contenga más cosas.
- El ancla `disk-backup-pruning-contract` está catalogada como
  `ADR-032 D1 / ADR-037` en `scripts/audit-anchors.mjs`: el test de regresión
  protege ambas mitades del contrato (retención + propiedad del prefijo).