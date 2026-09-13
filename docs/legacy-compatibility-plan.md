# Plan de retirada de compatibilidad heredada

- **Estado:** activo; ninguna ruta heredada se elimina automáticamente.
- **Propietario:** mantenedor del proyecto.
- **Revisión:** en cada release mayor y antes de modificar formatos persistidos.
- **Última revisión técnica:** 2026-09-05.

## Objetivo

Reducir el coste de mantener formatos, claves de almacenamiento y APIs de
compatibilidad sin romper vaults existentes ni provocar pérdida de datos. Una
ruta solo puede retirarse cuando existe evidencia de que no quedan consumidores
compatibles o cuando se introduce una migración explícita y reversible.

## Inventario actual

| Superficie | Compatibilidad | Política actual | Criterio de retirada |
|---|---|---|---|
| Cifrado `v2:`/PBKDF2 | Lectura heredada, escritura nueva deshabilitada | Descifrar y migrar a un formato actual durante una operación segura; nunca escribir `v2:` | Métrica o diagnóstico local que demuestre cero filas `v2:` en las instalaciones soportadas, más una migración de lectura probada |
| Envelopes de almacenamiento internos | Lectura de filas legacy y autenticadas | Leer ambos formatos; las escrituras nuevas usan el envelope autenticado | Todas las filas migradas y tests de downgrade/upgrade conservados |
| Claves antiguas de consentimiento | Lectura de migración acotada | Las claves `forge_consent_*` son la autoridad; las claves antiguas no conceden permisos nuevos y se limpian cuando corresponde | Una versión mayor con migración documentada y prueba de que la ausencia de la clave antigua no cambia la privacidad |
| Claves antiguas de vault/licencia | Migración de lectura | Copiar al almacenamiento seguro y limpiar la superficie antigua; el estado legacy no concede Pro | Evidencia de migración completa y soporte de recuperación para instalaciones no abiertas durante la transición |
| Migraciones de esquema RxDB | Migraciones históricas | Se conservan porque son necesarias para abrir instalaciones antiguas; cada versión se prueba | Solo después de una política explícita de versión mínima y una herramienta de exportación/migración para versiones fuera de soporte |
| APIs sin `batchId` en analítica | Semántica de cliente antiguo | Se acepta como compatibilidad de lectura; clientes nuevos envían `batchId` | Retirada coordinada del cliente y del servidor en una versión de protocolo documentada |
| Re-exportaciones de contenedores | Compatibilidad de imports | Se mantienen mientras existan consumidores; el contenedor es la vía canónica | Censo de imports igual a cero durante una release completa y migración de consumidores |

## Reglas de decisión

1. **No confundir `fallback` con legacy.** Los `Suspense fallback`, degradaciones
   de navegador y rutas fail-closed son comportamiento operativo actual, no deuda
   de compatibilidad.
2. **No borrar migraciones por antigüedad aparente.** La antigüedad del código no
   prueba que no existan datos antiguos en producción.
3. **No usar telemetría remota para identificar contenido del vault.** Las
   decisiones deben apoyarse en diagnósticos agregados, opt-in y sin contenido,
   o en una inspección local explícita.
4. **Cada retirada requiere:** ADR o actualización de ADR relevante, test de
   regresión del formato vigente, nota de release y una ruta de recuperación.
5. **Eliminación por fases:** marcar como solo lectura → medir/admitir una
   versión mínima → migrar → retirar en una versión mayor.

## Acciones próximas

- [ ] Añadir a la documentación de cada formato la versión mínima de lectura y
      la versión que dejó de escribirlo.
- [ ] Incorporar un diagnóstico local de formatos legacy encontrados, sin enviar
      contenido ni identificadores del vault.
- [ ] Crear una matriz de soporte por versión de aplicación antes de retirar
      cualquier migración RxDB.
- [ ] Revisar los consumidores de re-exportaciones de `src/container` y registrar
      el resultado en el ADR correspondiente.
- [ ] Al cerrar una ruta, actualizar el inventario, los tests y la nota de
      release en el mismo cambio.

## Higiene documental de esta transición

- **Se conservan los ADRs** que aparecen en el catálogo de anchors o justifican
  gates activos; no se elimina un ADR por antigüedad aparente.
- **Se conservan los informes de auditoría fechados** como evidencia histórica,
  pero `docs/audit.md`, `docs/launch-checklist.md` y los gates son la fuente
  operativa vigente. Un informe antiguo no autoriza una decisión actual.
- **Se conservan los registros de drills** cuando documentan un fallo, causa
  raíz o recuperación reproducible; sirven como evidencia de aprendizaje y no
  como estado actual del sistema.
- **Las notas de release** se mantienen como historial de releases. Los datos
  temporales (commits, conteos y estados de una ejecución) no deben copiarse a
  runbooks vivos sin una nueva verificación.
- **Los índices de deuda pre-lanzamiento** que dupliquen las fuentes vivas deben
  retirarse o marcarse como archivados en un cambio separado, después de
  comprobar que no son consumidos por un gate. No se borran aquí porque el
  checkout ya contiene modificaciones ajenas en esos documentos.

## Convención de tooling durante la migración

La raíz de `scripts/` sigue siendo una superficie de entrypoints compatible.
Los módulos nuevos se ubican por responsabilidad:

| Área | Ubicación | Regla |
|---|---|---|
| Calidad y empaquetado | `scripts/tooling/` | lint, análisis estático y presupuestos |
| Pruebas y perfiles | `scripts/` durante la transición | los entrypoints no cambian de nombre mientras CI los consuma |
| Seguridad y cumplimiento | `scripts/` durante la transición | mover internals solo con actualización de referencias y tests |
| Operaciones | `scripts/` durante la transición | no mover despliegues/drills sin revisar workflows y runbooks |

La reducción de superficie se hace eliminando primero entrypoints sin
referencias y después fusionando duplicados, siempre con un test de contrato.
Un simple movimiento de archivos no se considera reducción: cada migración debe
reducir comandos, duplicación o coste de mantenimiento.


Este documento no autoriza eliminar código, borrar datos locales, cambiar
formatos criptográficos ni desactivar migraciones. Es un control de decisión;
la retirada efectiva requiere evidencia y revisión separada.
