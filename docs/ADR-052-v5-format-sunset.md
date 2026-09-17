# ADR-052: Sunset del formato v5 — retirada del path legacy de salt Argon2id estático

- **Estado:** propuesto
- **Fecha:** 2026-09-17

## Contexto

A-1 (provisionamiento y migración, ver `docs/ADR-046-vault-kdf-salt-rotation.md`)
sustituyó el salt Argon2id **constante y compartido por todo el bundle** por un
salt aleatorio por bóveda: los payloads nuevos son `v6:` y **llevan su propio
salt incrustado**. Los `v5:` escritos antes de la migración siguen leyéndose
con el salt fijo legacy — es la decisión deliberada de read-compat que evitó
perder datos en la ola A-1 — y hoy ese es el único lugar del árbol donde
sobrevive la violación de RFC 9106 (un salt para todas las bóvedas):

- `crypto-core.deriveContextSalt(context, null)` deriva el salt legacy como
  `SHA-256(context)`, con contextos `bookmarkforge-v5-master-key` y
  `bookmarkforge-session-master-key-v6`. Una sola pasada de Argon2id sobre una
  contraseña candidata sirve contra **todo** blob `v5:` de **toda** bóveda del
  mundo, para siempre que ese blob exista.
- El re-envoltorio oportunista (`migrateVaultSecretsToVaultSalt`, en cada
  unlock, con la contraseña recién verificada) y la re-acuñación del token de
  verificación mueven el corpus de `SecureStorage` a `v6:` de forma incremental.
  Toda **escritura** nueva ya es `v6:` (invariante anclada en
  `p0-vault-kdf-salt.regression.test.ts`).
- El parque residual que se resiste a la migración es, por construcción, el que
  **nunca se re-abre** con una build reciente: dispositivos abandonados, secretos
  en rutas que ningún unlock recorre, y **backups en disco escritos pre-A-1**
  (los backups se re-clavan solo cuando el usuario los restaura con la
  contraseña de su creación).

El sunset, por tanto, no puede ser una fecha: es una condición sobre el parque
real de blobs. Retirar el parser v5 mientras exista data real en v5 es una
decisión de pérdida de datos, no de seguridad; mantenerlo indefinidamente es
mantener un diccionario global válido. Este ADR fija el mecanismo para pasar de
uno a otro de forma medible, reversible y fail-closed.

## Decisión

1. **Sunset condicionado, no calendarizado.** La retirada procede cuando el
   parque esté migrado, medido — no cuando pase el tiempo. El criterio objetivo
   de "parque migrado" es: **cero secretos en formato v5 reportados por la
   instrumentación de exposición durante dos unlocks consecutivos** en una
   bóveda dada, más la expiración natural de los backups antiguos por edad
   (ya acotada por ADR-032/ADR-034: poda de backups en disco y cuota de
   almacenamiento).
2. **Fases:**
   - **Fase 0 — hoy (ya implementada).** `v5:` read-only + re-envoltorio
     oportunista en unlock + escritura siempre `v6:`. La matriz ejecutable
     (`src/utils/legacy-compat-matrix.ts`) documenta el estado
     `legacy-read-only` de cada formato.
   - **Fase 1 — instrumentación de exposición.** Un contador persistido y
     consultable (DiagnosticService → panel de diagnósticos) que reporte
     cuántos secretos de `SecureStorage` persisten en formato `v5:` por
     bóveda, y cuántos se re-envolvieron en el último unlock. Sin telemetría:
     el dato es local; este repositorio lo consume el propio usuario/mantenedor.
   - **Fase 2 — aviso de residuo.** Si tras N unlocks consecutivos el contador
     no llega a cero, la UI de seguridad muestra un aviso no bloqueante que
     explica qué significa (diccionario global sigue aplicando a esos blobs) y
     cómo forzar el re-envoltorio (unlock con la contraseña correcta /
     restauración del backup con build actual). Nunca bloquea la lectura.
   - **Fase 3 — corte tras el criterio.** Retirar la rama legacy de derivación
     (`salt = null` en `deriveContextSalt`) y el parseo `v5:` en decrypt,
     tras un **flag de build de reversibilidad**
     (`VITE_ALLOW_V5_LEGACY_READ`, default OFF). Sin el flag, un blob `v5:`
     produce un error **tipado y accionable** ("formato legacy retirado;
     actualice desde una build anterior o restaure desde el backup convertido"),
     nunca un fallo críptico. Con el flag, una build de puente mantiene la
     lectura un ciclo de releases para los casos de soporte.
   - **Fase 4 — eliminación.** Borrar flag y código muerto, pasar la fila de la
     matriz de compatibilidad a `removed`, y retirar los tests de read-compat
     v5 (los que hoy anclan la compatibilidad en
     `p0-vault-kdf-salt.regression.test.ts`, `real-crypto.integration.test.ts` y
     el seeder `tests/e2e/legacy-vault-seeder.ts`), dejando el ADR como
     referencia histórica del formato.
3. **Invariantes durante todo el sunset:**
   - Ninguna escritura nueva en `v5:` desde la Fase 0 (hoy).
   - La retirada del parser no puede romper un `v6:`: los formatos se
     autodescriben por prefijo (`v6:`/`v5:`) y por marker byte en el layout de
     session-key, así que el corte es seguro por construcción.
   - Cada salto de fase es un cambio de código revisable en PR; el flag de la
     Fase 3 es la válvula de reversibilidad operativa.
   - El salt por-vault (`kdf_salt`, ADR-046) y el `vault_salt` de `deriveDbKey`
     no se tocan: este ADR solo retira el path `salt = null` (constante).
4. **Lo que este ADR no hace:**
   - No migra backups antiguos: no se puede sin la contraseña con la que se
     escribieron. Siguen leyéndose mientras exista el read path; después de la
     Fase 3 requieren la build de puente (flag) o la conversión manual
     (restaurar con build antigua → unlock → re-exportar, ya en `v6:`).
   - No unifica `kdf_salt` y `vault_salt` en un registro único (mejora de
     higiene independiente, no de seguridad).

## Consecuencias

- **+** El diccionario global deja de servir en cuanto el último blob `v5:`
  desaparece, y el deadline deja de ser una promesa: es un contador medible por
  bóveda. RFC 9106 vuelve a cumplirse para el 100% del parque una vez cerrada
  la Fase 3.
- **+** Reversibilidad: cualquier fase puede detenerse; el flag de la Fase 3
  permite dar soporte a casos límite sin reabrir el formato por defecto.
- **−** Hasta la Fase 3, la exposición bundle-wide persiste para blobs que
  nunca se re-abren (dispositivos abandonados es el caso dominante). Es el
  compromiso explícito: read-compat primero, cierre medible después.
- **−** Coste de soporte en la Fase 3: usuarios que actualicen saltándose la
  build de puente no podrán leer bóvedas/respaldos `v5:`. Mitigación: el aviso
  de la Fase 2 y mantener el flag disponible un ciclo de releases.
- **Superficie de tests afectada por fase:** los tests que hoy anclan la
  read-compat v5 se retiran en la Fase 4 con el mismo PR que elimina el código
  (la retirada de un test anclado por el paraguas
  `security-tier-4-p-regression-suite` exige actualización del catálogo
  `audit-anchors` — cambio de nivel ADR, coherente con este documento).

## Alternativas descartadas

- **A-1. Sunset calendarizado (fecha fija de corte).** No mide el parque real:
  o rompe datos de usuarios que aún tienen blobs `v5:`, o se pospone
  indefinidamente en cuanto aparece un caso de soporte. La condición medible
  hace el corte honesto.
- **A-2. Migración forzada (re-key sin interacción del usuario).** Imposible
  criptográficamente: re-envolver requiere la contraseña, que solo existe en
  un unlock. Forzar reset de bóveda es pérdida de datos, no migración.
- **A-3. Mantener v5 para siempre.** Mantiene un diccionario global válido
  contra todo blob legacy del mundo y contradice RFC 9106 de forma permanente;
  contradice también la dirección ya tomada por ADR-046.
- **A-4. Doble escritura v5+v6 durante la transición** para "garantizar"
  compatibilidad hacia atrás con builds antiguas. Duplica el corpus cosechable
  en lugar de reducirlo y re-introduce escritura v5, que la Fase 0 ya cerró.
- **A-5. Re-encryptar backups del usuario en background.** Los backups solo
  pueden re-clavarse cuando el usuario los abre o restaura con la contraseña de
  su creación; una re-encryptación "en background" sin ese material no existe.
  La expiración por edad (ADR-032/034) es el mecanismo correcto para acotar su
  vida.
