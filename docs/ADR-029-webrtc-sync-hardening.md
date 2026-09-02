# ADR-029: Endurecimiento del sync WebRTC (post-wave 2)

- **Estado:** aceptado (implementado; este registro formaliza las decisiones existentes)
- **Fecha:** 2026-09-02 (retro-documentado desde el código, el catálogo de anclas y `docs/audit.md`)

## Contexto

El hardening post-auditoría se organizó en waves 1 y 2 (`docs/ADR-026-post-audit-hardening-wave-1.md`,
`docs/ADR-027-post-audit-hardening-wave-2.md`). Tras esas waves, los seguimientos
de WebRTC/DR vieron luz bajo **ADR-029+**: un conjunto de decisiones de
sincronización punto-a-punto que endurecen el servicio WebRTC en superficie
(sesiones de transferencia, forma del SDP, comparaciones de checksums) y fijan
la dependencia de resolución de conflictos determinista del core de BD.
El catálogo de anclas (`scripts/audit-anchors.mjs`) referencia las decisiones
D1, D2, D5 y D6; el gate `check:extension-csp` se describe a sí mismo como
follow-up de ADR-029.

## Decisión

1. **D1 — Watchdog de transferencias atascadas.** `WebRTCSyncService` mantiene un
   watchdog de transferencia (`SYNC_TRANSFER_TIMEOUT_MS = 30_000`): si un peer
   envía `sync_start` y luego se queda en silencio, la transferencia entrante se
   cancela y se libera el estado de sesión que había reservado. El temporizador
   solo se refresca tras chunks aceptados y se limpia cuando comienza la
   verificación/persistencia — un peer lento no puede reservar al receptor para
   siempre (ancla `p4-sync-transfer-watchdog`).
2. **D2 — Gate de forma del SDP anterior al handoff del navegador.** Antes de
   entregar una descripción de sesión al `RTCPeerConnection`, el servicio
   rechaza SDP malformado, sobredimensionado y con roles no soportados:
   - Encoded descriptions > 64 KiB se rechazan antes de descomprimir
     (`decodeDescription` devuelve `null`).
   - Tipos no soportados (`pranswer`), NUL bytes y forma JSON incorrecta se
     rechazan (validator `isValidSessionDescription` en `webrtc-sync/validation`).
   - `minimizeSDP` filtra candidatos `srflx`/`relay` (solo `host`), excluye
     líneas irrelevantes y conserva la metadata de sesión de data-channel que el
     parser del navegador necesita (ancla `p5-sdp-shape-gate`).
3. **D5 — Comparación en tiempo constante de checksums/HMAC.** El cliente usa
   comparación en tiempo constante (`constantTimeStringEqual` en
   `webrtc-sync/compare`, espejo de la comparación del lado servidor) tanto para
   checksums de sesión como para claves de autenticación del payload; la
   cobertura adversarial está anclada en `WebRTCSyncService.test.ts` (input de 64
   chars, mismatch de un char, longitudes distintas) (ancla `p4-constant-time-cmp`).
4. **D6 — Resolución de conflictos determinista como fuente anclada.**
   `src/db/database.core.ts` queda anclado como *source* (no como test): la
   resolución LWW determinista por `compareRxRevision` no puede desaparecer
   silenciosamente tras un refactor (ancla `database-core-source`). Complementa
   ADR-026 D8 (`sync-version-comparator`).
5. **Fuente de seguridad crítica.** `src/services/WebRTCSyncService.ts` queda
   anclado como source (ancla `webrtc-sync-source`): el filtrado de registros
   privados y el sync autenticado y acotado no pueden eliminarse sin que el gate
   `check:audit-drift` falle.
6. **Follow-up — CSP de la extensión.** El gate `check:extension-csp` impone una
   CSP canónica única y verbatim en los manifests de la extensión (Chrome MV3 +
   Firefox MV2): `script-src 'self'; object-src 'none'; connect-src 'self';
   frame-src 'none'; base-uri 'none'; form-action 'none'; style-src 'self'`. Es
   deliberadamente más estricta que la de la app (la extensión no hace fetch/XHR
   propio), endurecida tras la auditoría de superficie de la extensión.

## Consecuencias

- El sync WebRTC es fail-closed en las tres superficies: sesiones, forma del SDP
  y comparaciones de integridad. Relajar cualquiera de ellas es un cambio a nivel
  ADR (el gate `check:audit-drift` falla si un ancla desaparece).
- El SDP minimizado solo conserva candidatos `host`: los peers dependen de
  conectividad directa o de los STUN/TURN whitelistados por ADR-026/027; un relay
  no whitelistado no puede colarse vía `srflx`/`relay` embebido en el SDP.
- El registro de estos anchors (3 de ellos sobre el mismo
  `WebRTCSyncService.test.ts`, más 2 sources) está en
  `scripts/audit-anchors-baseline.json`; la numeración no es contigua (D1, D2,
  D5, D6) porque solo las decisiones con ancla de regresión entran en el catálogo
  — las decisiones D3/D4 de la serie original no tienen ancla y no se formalizan
  aquí.