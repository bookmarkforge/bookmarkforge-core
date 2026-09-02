# ADR-027: Hardening post-auditoría — wave 2 (servidor de señalización)

- **Estado:** aceptado (implementado; este registro formaliza la decisión existente)
- **Fecha:** 2026-09-02 (retro-documentado desde el código y `docs/audit.md`)

## Contexto

La wave 1 del hardening post-auditoría (`docs/ADR-026-post-audit-hardening-wave-1.md`)
cubrió el cliente (sincronización WebRTC, almacenamiento, resolución de
conflictos). La auditoría también identificó que el servidor de señalización
self-hosted — exposible a Internet por diseño, pues coordina el handshake P2P —
necesitaba límites de recursos y endurecimiento de autenticación propios. El
compañero server no recibe contenido del vault (ver `docs/architecture.md`),
pero un atacante puede abusar de sus recursos y de su superficie de join.

## Decisión

1. **Enteros acotados por entorno.** Todos los límites numéricos del servidor
   (conexiones, rooms, peers por room, tamaños de payload, ventanas de tiempo)
   se leen del entorno validados como enteros acotados — sin defaults
   ilimitados ni coerción silenciosa de strings.
2. **Ventana anti-replay.** Los mensajes firmados del protocolo de señalización
   se validan contra una ventana de tiempo/replay; mensajes fuera de la ventana
   se rechazan (protección de reenvío de handshakes capturados).
3. **Autenticación en tiempo constante.** La comparación de credenciales
   admin/token (`SIGNALING_ADMIN_TOKEN`) usa comparación en tiempo constante
   para no filtrar longitud ni prefijo por timing.
4. **Rate-limit de join aislado.** El límite de tasa de entradas a rooms usa un
   mapa aislado por identidad, de modo que un cliente abusivo no pueda agotar
   el presupuesto de rate-limit global ni provocar colisión de claves con
   otros clientes (ancla `signaling-server-bounded-resources`).
5. **Ancla de regresión.** El conjunto completo está anclado en
   `src/tests/sync/signaling-server.test.*` vía `scripts/audit-anchors.mjs`
   (ADR-027 / wave 2): la eliminación o renombrado del test falla el gate
   `check:audit-drift`.

## Consecuencias

- El servidor de señalización es fail-closed: sin configuración de límites
  explícita, los defaults son restrictivos, no permisivos.
- Los límites son operables vía entorno sin redeploy de código; los cambios de
  defaults estructurales requieren ADR.
- La política de webhooks/secretos del operativo nocturno (P92/H5) y el
  presupuesto WoW de duración (ADR-019) viven en `docs/ops-nightly.md` y
  `docs/audit.md` — este ADR cubre solo la superficie de señalización.
