# ADR-053: Registro único de salts por-bóveda — consolidación de `kdf_salt` y `vault_salt`

- **Estado:** propuesto
- **Fecha:** 2026-09-17

## Contexto

Hoy coexisten **dos** salts aleatorios persistidos por bóveda, con dos regímenes
de registro completamente distintos:

1. **`kdf_salt`** (`SECURE_STORAGE_KEYS.KDF_SALT`, clave de disco
   `"kdf_salt"`) — el salt Argon2id del corpus maestro (ADR-046) y, desde su
   extensión de alcance, del índice Voy. Tiene ciclo de vida completo:
   aprovisionamiento (`ensureVaultKdfSalt`), snapshot/rollback de rotación
   (`snapshotVaultKdfSalt`/`restoreVaultKdfSalt`), rotación con la contraseña
   (`rotateVaultKdfSalt`) y sincronización cross-tab (`kdf-salt-sync.ts`).
   Vive en `src/services/security-vault/kdf-salt.ts`.
2. **`vault_salt`** — el salt de entrada de `deriveDbKey`
   (`crypto-core.deriveDbKey`), que produce la clave de almacenamiento de RxDB.
   Acuñado una vez con CSPRNG en `src/db/database.ts` (con migración legacy
   desde localStorage), referenciado como **string literal** `"vault_salt"`
   sin constante compartida, sin snapshot, sin sync. Nunca rota: rotarlo
   cambiaría la entrada del KDF de la DB key y dejaría ilegible todo el
   almacén RxDB existente.

El statu quo tiene tres problemas, todos de gobernanza y ninguno criptográfico:

- **Propiedad difusa**: nada en el árbol declara que `vault_salt` es un salt
  por-bóveda deliberadamente *no rotatorio*, ni que su valor no debe tocarse.
  El siguiente agente que "limpie" salts tiene ante sí dos claves parecidas y
  ninguna documentación de por qué son distintas.
- **Riesgo de drift por refactor**: una "unificación" ingenua de valores
  (usar `kdf_salt` como entrada de `deriveDbKey`, o viceversa) re-key-earía
  silenciosamente el almacén RxDB o el corpus maestro. Hoy solo la disciplina
  y los tests de ADR-046 lo impiden.
- **Doble inventario**: ADR-052 (Fase 1) necesita reportar el estado de los
  secretos por-bóveda; hacerlo exige un único registro consultable en vez de
  rastrear literales dispersos.

Lo que este ADR consolida es el **registro**, no el material: los valores de
los salts no pueden fusionarse (ver A-1) ni renombrarse en disco (ver A-2).

## Decisión

1. **Módulo registro único**: `src/services/security-vault/salt-registry.ts`
   exporta descriptores tipados (sin valores, solo contratos):

   ```ts
   // Boceto de contrato — la implementación real llega con la Fase A.
   export interface VaultSaltDescriptor {
     /** Constante de clave compartida (p. ej. SECURE_STORAGE_KEYS.KDF_SALT). */
     storageKey: string;
     /** Propósito legible, para diagnóstico y logs (sin secretos). */
     purpose: "master-kdf" | "db-key-kdf";
     /** ADR que gobierna el ciclo de vida de este salt. */
     governance: string;
     /** ¿Rota cuando rota la contraseña maestra? */
     rotatesWithPassword: boolean;
     /** ¿Requiere propagación cross-tab (kdf-salt-sync)? */
     syncCrossTab: boolean;
   }
   ```

   Con dos entradas iniciales: `kdf_salt` (`rotatesWithPassword: true`,
   `syncCrossTab: true`, gobernanza ADR-046) y `db_salt` — el nombre de
   código para el salt de `deriveDbKey` — (`rotatesWithPassword: false`,
   `syncCrossTab: false`, gobernanza de este ADR). Todos los lectores y
   escritores importan la constante desde el registro; queda prohibido el
   literal `"vault_salt"` disperso por el árbol.

2. **La clave de disco `vault_salt` no cambia.** El nombre en disco es formato
   persistido, no detalle de implementación: las bóvedas existentes siguen
   leyéndose sin migración con valor. Solo cambia el registro a nivel de
   código.

3. **La no-rotación de `db_salt` es deliberada y queda documentada en el
   descriptor.** La tabla de rollback de ADR-046 (§4) solo incluye `kdf_salt`
   porque la rotación **nunca escribe** `db_salt`; este ADR eleva esa exclusión
   de accidente a contrato (`snapshotVaultKdfSalt` no debe "completarse" con
   `db_salt` en el futuro). Al rotar la contraseña, el siguiente unlock deriva
   una DB key nueva con la **misma** `db_salt` y re-envuelve
   `encrypted_db_key` bajo la capa maestra v6 — sin tocar el almacén RxDB.

4. **Independencia de acuñación.** Ambos salts se acuñan con CSPRNG y nunca
   uno a partir del otro, ni de identificadores de dispositivo (misma razón
   que A-9 en ADR-046: acoplar ciclos de vida convierte una re-envoltura de
   device key en una re-derivación silenciosa de todo lo demás).

5. **Diagnóstico unificado (enlace ADR-052).** El contador de exposición de la
   Fase 1 del sunset reporta por entrada del registro (formato detectado,
   `v5:`/`v6:`), un solo inventario para ambos salts.

6. **Gobernanza de entradas nuevas.** Añadir un tercer salt por-bóveda exige
   una entrada en el registro con su ADR de referencia; el catálogo
   `audit-anchors` es candidato a anclar el módulo registro como
   security-critical source (mismo patrón que `secure-storage-source`).

7. **Fases de implantación:**
   - **Fase A — registro.** Crear `salt-registry.ts` con los dos descriptores,
     migrar `database.ts` y `kdf-salt.ts` a las constantes compartidas,
     test unitario de invariantes (ver Consecuencias). Cambio puramente
     estructural: cero cambios de comportamiento, cero toques a disco.
   - **Fase B — diagnóstico.** Conectar el contador de ADR-052 al registro.
   - **Fase C — ancla.** Alta del módulo en `audit-anchors` como source.

## Consecuencias

- **+** Inventario único y tipado: un refactor que toque cualquier salt falla
  typecheck o salta en el diff del registro, no en un literal escondido.
- **+** La asimetría de ciclos de vida (rota / no rota) pasa de tribal a
  declarativa, en el propio código.
- **+** ADR-052 obtiene su inventario sin duplicar descubrimiento.
- **−** Un módulo más de indirección; el coste es una importación por
  consumidor.
- **−** El nombre histórico `vault_salt` en disco convive con el nombre de
  código `db_salt`; se acepta por compatibilidad (A-2) y queda documentado en
  el descriptor.
- **Tests que anclan el contrato (Fase A):** invariantes del registro —
  claves de disco distintas entre entradas, `kdf_salt.rotatesWithPassword ===
  true`, `db_salt.rotatesWithPassword === false`, ningún valor compartido —
  más la suite existente de `database.ts` (comportamiento intacto) y la P0 de
  ADR-046 (rollback sin cambios).

## Alternativas descartadas

- **A-1. Fusionar valores: un solo salt para ambos KDF.** Cambiar la entrada
  de `deriveDbKey` produce una DB key distinta → almacén RxDB ilegible para
  toda bóveda existente. Además acoplaría ciclos de vida: si `kdf_salt` rotase
  con la contraseña, cada rotación re-key-earía el almacén completo. Es
  exactamente la clase de pérdida de datos que A-3/A-6 de ADR-046 rechazaron.
- **A-2. Renombrar la clave de disco `vault_salt`.** Rompe bóvedas existentes
  sin una migración con valor (leer clave vieja, escribir clave nueva,
  borrar la vieja) que no compra nada: la unicidad ya está garantizada y el
  objetivo es el registro de código, no la estética del disco.
- **A-3. Rotar también `db_salt` con la contraseña.** Re-key O(corpus) del
  almacén RxDB en cada cambio de contraseña, con riesgo de pérdida masiva si
  el re-encryptado falla a medias, y sin beneficio: la DB key ya vive cifrada
  bajo la capa maestra v6 — un atacante necesita romper esa capa antes de que
  la constancia de `db_salt` le aporte nada.
- **A-4. Blob único JSON (`vault_salts`) en SecureStorage.** Exige migración
  con valor (A-2 de nuevo), crea un punto único de corrupción para ambos salts
  y complica el rollback de ADR-046, que opera sobre la clave `kdf_salt`
  individual. El registro a nivel de código con claves en disco estables logra
  el objetivo sin tocar datos.
