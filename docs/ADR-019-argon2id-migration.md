# ADR-019: Migración a Argon2id y formatos de cifrado V4/V5

- **Estado:** aceptado (implementado; este registro formaliza la decisión existente)
- **Fecha:** 2026-09-02 (retro-documentado desde el código y `docs/audit.md`)

## Contexto

El vault local-first necesita cifrado en reposo resistente a ataques offline.
El formato heredado `v2:` usaba PBKDF2, un KDF sin resistencia a GPU/ASIC y con
parámetros que quedaron cortos frente al hardware actual. Además, las
operaciones criptográficas corrían en el hilo principal del renderer, lo que
permitía que el KDF bloqueara la UI y complicaba la puesta a cero de memoria.

## Decisión

1. **Argon2id es el único KDF hacia adelante.** La derivación de clave de base
   de datos usa Argon2id con parámetros de memoria elevados; las claves de
   dominio se separan con HKDF (`crypto-core.ts`). El formato heredado `v2:`
   (PBKDF2) queda como **solo lectura** para permitir la migración de vaults
   existentes; el código nuevo nunca escribe `v2:`.
2. **Formatos de wire estables** (contrato documentado en `AGENTS.md` §1):
   - `v5:` = `hkdf_salt(16) || iv(12) || ciphertext` — formato de escritura actual.
   - `v4:` = `salt(16) || iv(12) || ciphertext` — Argon2id por operación (legacy de la propia migración).
   - `v2:` = PBKDF2 — solo lectura.
3. **Criptografía fuera del hilo principal.** La derivación y el cifrado de
   fondo viven en `src/workers/crypto.worker.ts`, de modo que el KDF pesado
   nunca bloquea la UI y el material de clave se materializa en un contexto
   aislado.
4. **Zeroización de memoria como contrato.** Los buffers de contraseña se
   consumen in-place tras derivar (`zeroPasswordBytes`); la puesta a cero de
   máximo esfuerzo es doble relleno (`fill(0)` → XOR `0xAA` → `fill(0)`) para
   derrotar la elisión del compilador. El detalle operativo completo está en
   `AGENTS.md` §1, que es la referencia normativa de este contrato.
5. **Progreso de migración visible.** La reescritura de filas durante el bump
   de versión de esquema (`src/db/migration-progress.ts`) muestra un overlay de
   progreso (`tests/e2e/vault-migration-progress.spec.ts`) porque una migración
   Argon2id puede tardar minutos en hardware lento.
6. **Parámetros de prueba vs producción.** El modo test de Vite usa parámetros
   Argon2id reducidos (8 MiB, t=1) para que la suite E2E no pague el KDF de
   128 MiB (~28 s) en cada setup; producción conserva los parámetros fuertes
   (`isProdBuild()` en `playwright.config.ts`).

## Consecuencias

- Los formatos `v5:`/`v4:`/`v2:` son contratos de wire congelados: cualquier
  cambio requiere un ADR nuevo y un camino de lectura migratorio.
- Los archivos de este dominio llevan el ancla de cabecera `// ADR-019: …`
  (`crypto-core.ts`, `argon2-kdf.ts`, `crypto.worker.ts`, `database.core.ts`,
  `EncryptionService.ts`, `SecureStorage.ts`, `SecurityVault.ts`, etc.).
- El gate `check:audit-drift` vigila las anclas de regresión ligadas a este
  dominio; eliminar o renombrar los tests anclados es un cambio a nivel ADR.
- El costo de la derivación fuerte hace que la creación/desbloqueo del vault
  sea deliberadamente lento; no se relajan los parámetros sin un ADR.
