# API y protocolos

El companion server se ejecuta con `npm run server`. En producción debe estar detrás de un reverse proxy TLS.

No existe proxy de IA: las llamadas a proveedores salen del navegador directamente, con la
clave del usuario. El servidor sólo sirve señalización P2P, licencias, salud, informes CSP y
telemetría opt-in.

## HTTP

| Método | Ruta | Función | Protección |
|---|---|---|---|
| GET | `/health` | Liveness mínimo | Pública; no-store |
| GET/POST | `/api/license/health` | Salud de la integración de licencias | Origin allow-list + rate limit por IP |
| GET/POST | `/api/license/activate` | Canje de una clave comprada por una prueba firmada | Origin allow-list + rate limit por IP |
| GET/POST | `/api/license/validate` | Revalidación de una clave existente | Origin allow-list + rate limit por IP |
| GET/POST | `/api/license/deactivate` | Libera una activación (equipo perdido) | Origin allow-list + rate limit por IP |
| POST | `/api/license/entitlement` | Respuesta autoritativa del plan (`pro` \| `free`) verificando la prueba del propio cliente | Verifica la prueba; origin allow-list (`AI_SESSION_ORIGINS`) + rate limit |
| GET | `/admin` | Diagnóstico señalización | `X-Signaling-Admin-Token` |
| GET/POST | `/csp-report` | Informes CSP y diagnóstico | GET requiere `X-CSP-Admin-Token` |
| POST | `/api/client-events` | Eventos de degradación del cliente (opt-in en el cliente) | Rate limit por IP; sin contenido |
| GET | `/api/client-events` | Diagnóstico del collector | `X-Client-Events-Admin-Token` (503 si no está configurado) |
| GET | `/api/client-events/retry-stats` | Contadores acumulados de reintentos del reporter | Rate limit por IP |
| POST | `/api/analytics/events` | Bucket diario agregado de analítica opt-in (`iid` + `batchId` + `counts`) | Rate limit por IP (hash con sal); sin PII |
| GET | `/api/analytics/kpis` | KPIs agregados (DAU/WAU/MAU, cohortes, funnel) | `X-Analytics-Admin-Token` (503 si no está configurado) |

Cualquier otra petición HTTP responde `426 Upgrade Required`: el servidor sólo habla
WebSocket más allá de esas rutas. La tabla autoritativa de rutas y su clasificación
(pública / con entitlement) vive en `server/src/route-table.ts`, y
`npm run check:pro-routes` falla si el router despacha una ruta que la tabla no declara,
si una ruta declarada no se despacha nunca, o si el dispatcher deja de estar conectado al
guard de entitlement.

`AI_SESSION_ORIGINS` es el nombre histórico de la allow-list de orígenes de
`/api/license/entitlement`: el endpoint responde el *plan* de licencia, no una sesión de IA.

Las rutas y contratos exactos deben mantenerse sincronizados con los handlers de
`server/src`. No añadir endpoints que devuelvan secretos, contenido del vault o datos
operativos sin autenticación.

## Entitlement (Pro)

`POST /api/license/entitlement` recibe la prueba de licencia que el cliente ya posee
(`{ payload, signature }`) y responde:

```json
{ "plan": "pro", "source": "license", "deviceId": "…", "validatedAt": 1750000000000 }
```

```json
{ "plan": "free", "source": "none", "reason": "EXPIRED", "message": "…" }
```

- `200` es una respuesta definitiva, incluso cuando degrada a `free`: el cliente pasa a Free
  de forma explícita en vez de quedarse en la ventana de gracia offline.
- `503 SIGNING_KEY_INVALID` significa que la clave pública del despliegue es inutilizable.
  **No** es una degradación: un servidor mal configurado nunca debe revocar a un usuario que
  paga, así que el cliente conserva su estado verificado offline.
- Otros códigos: `400` cuerpo malformado, `403` origen, `405` método, `413` prueba
  demasiado grande, `429` rate limit.

## WebSocket de señalización

Mensajes principales:

```json
{ "type": "init", "yourPeerId": "..." }
{ "type": "join", "room": "room-id", "roomSecret": "..." }
{ "type": "joined", "otherPeerIds": ["..."] }
{ "type": "signal", "senderPeerId": "...", "room": "...", "receiverPeerId": "...", "data": {} }
```

Las rooms con secreto requieren autenticación HMAC de cada señal. El servidor valida el sender, room, peer destinatario, tamaño, rate limits y replay window. Cuando `WS_ALLOWED_ORIGINS` está definido, los upgrades desde otros orígenes se rechazan con `403`; vacío significa "sin comprobación de origen" (desarrollo local).

> **Alcance del `roomSecret` (A-3):** el cliente solo lo envía al servidor de señalización autoalojado que tenga configurado (`VITE_P2P_SIGNALING_URL`). Sobre los relays públicos (rxdb.info/PubNub) el `join` va SIN el secreto: el relay únicamente ve el nombre de sala opaco derivado por HMAC (A-2), y el secreto —que es la capability de la sala y la clave de cada `signalAuth`— nunca sale de los peers. Sin servidor autoalojado configurado no se envía jamás (fail-closed), y el servidor sigue aceptando `roomSecret` opcional para enforcement de salas con secreto. La mitad "relay público" de este contrato se verifica end-to-end (`npm run e2e:relay`): la app se arranca **sin** `VITE_P2P_SIGNALING_URL` contra un relay de prueba dentro de la página y se inspecciona el `join` emitido.

> **Nota de despliegue:** el estado de rooms de señalización vive en memoria del proceso (una sola réplica). Escalar horizontalmente el WebSocket requiere un adaptador compartido o enrutamiento por afinidad; no hacerlo divide rooms entre réplicas y rompe la entrega de señales.

## Analítica opt-in (`/api/analytics/*`)

- El cliente solo envía datos tras el consentimiento explícito (`forge_consent_analytics`); por defecto nada sale del dispositivo.
- El payload es `{ iid, batchId, counts }`: `iid` es el SHA-256 de un id aleatorio por instalación, `counts` son totales diarios de una lista cerrada de tipos de evento, sin contenido.
- `batchId` hace el ingest aditivo e idempotente: los lotes parciales se suman y un reintento del mismo lote no duplica (respuesta 204 sin recontar). Los payloads sin `batchId` (clientes antiguos) conservan la semántica de reemplazo por día.
- Si el estado por instalación alcanza su tope, el endpoint responde `503` con `Retry-After` (fail-closed, sin descartar datos silenciosamente).
- Los KPIs (`GET /api/analytics/kpis`) exigen `X-Analytics-Admin-Token`; sin token configurado el endpoint responde `503`.

## Versionado

Los cambios incompatibles requieren una versión de protocolo nueva o compatibilidad explícita. Añadir pruebas de contrato para cada integración y endpoint sensible.
