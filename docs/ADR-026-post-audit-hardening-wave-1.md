# ADR-026: Hardening post-auditoría — wave 1

- **Estado:** aceptado (implementado; este registro formaliza la decisión existente)
- **Fecha:** 2026-09-02 (retro-documentado desde el código y `docs/audit.md`)

## Contexto

La auditoría de seguridad completa (`docs/audit.md`) produjo un conjunto de
hallazgos de severidad crítica y alta sobre la superficie de sincronización,
almacenamiento y resolución de conflictos. La corrección se organizó en dos
olas (`scripts/audit-anchors.mjs` — "ADR-026 wave 1, ADR-027 wave 2"), cada una
con tests de regresión adversariales anclados por el gate `check:audit-drift`.

## Decisión

1. **Firewall de sincronización y listas de acceso restringido.**
   - Whitelist de servidores ICE: los endpoints STUN/TURN se restringen a una
     lista permitida — defensa contra endpoints hostiles que actúen como relay
     (ancla `p0-ice-whitelist`).
   - Los registros privados nunca se replican a un par: el filtro de
     privacidad corre antes de la transferencia (ancla `p1-private-sync`).
   - La superficie de desbloqueo no revela si existe un vault cuando el
     fencing privado está activo (ancla `p3-verify-password-private`).
2. **Guard de producción para SecureStorage.** Los builds de producción
   rechazan montar un `SecureStorage` sin cifrar — fail-closed en la capa de
   almacenamiento en reposo (ancla `p2-secure-storage-prod-guard`).
3. **Serialización de la clave de dispositivo.** La generación criptográfica de
   la clave de dispositivo se serializa entre pestañas para evitar carreras que
   produzcan claves divergentes (ancla `secure-storage-device-key-lock`,
   ADR-026 D2).
4. **Comparador numérico de revisión para LWW.** La resolución de conflictos
   last-writer-wins de RxDB compara alturas de revisión numéricas
   (`src/utils/syncVersion.ts`) en lugar de orden léxico, que rompía con `9 > 10`
   (anclas `sync-version-comparator` + `sync-version-comparator-source`,
   ADR-026 D8). El fichero fuente está anclado además del test: un refactor no
   puede eliminar el comparador silenciosamente.
5. **Fuentes de seguridad crítica ancladas.** `src/services/SecureStorage.ts` y
   `src/services/WebRTCSyncService.ts` están anclados como fuente (no solo sus
   tests): su desaparición silenciosa rompería el cifrado en reposo y el
   filtrado de privacidad de la sincronización.
6. **Anclas como contrato.** Cada corrección lleva su test de regresión bajo
   `src/tests/security/p<severidad>-<slug>.regression.test.ts` y su entrada en
   `scripts/audit-anchors-baseline.json`. Añadir o quitar un ancla es un cambio
   a nivel ADR (`AGENTS.md` §2).

## Consecuencias

- `npm run check:audit-drift` falla si un test o fuente anclada desaparece o se
  renombra fuera de su ubicación esperada; el gate es parte de la cadena
  `npm run check`.
- La whtielist de ICE y el firewall de sync son configuración estructural, no
  opcional: relajarlas requiere ADR y revisión de seguridad.
- La wave 2 de este hardening (límites del servidor de señalización) está
  registrada en `docs/ADR-027-post-audit-hardening-wave-2.md`; los trabajos
  posteriores de WebRTC/DR vieron luz en ADR-029+ (referenciados en el catálogo
  de anclas).
