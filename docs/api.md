# API y protocolos

El companion server se ejecuta con `npm run server`. En producción debe estar detrás de un reverse proxy TLS.

## HTTP

| Método | Ruta | Función | Protección |
|---|---|---|---|
| GET | `/health` | Liveness mínimo | Pública; no-store |
| POST | `/api/services/ai/session` | Crear sesión efímera de IA | Origin allow-list, rate limit, licencia en producción |
| POST | `/api/services/ai/generate` | Proxy de generación | Cookie de sesión + CSRF |
| POST | `/api/services/ai/generate-tts` | TTS | Cookie de sesión + CSRF |
| POST | `/api/services/ai/generate-image` | Imagen | Cookie de sesión + CSRF |
| GET | `/api/services/ai/admin` | Diagnóstico IA | Token administrativo |
| GET | `/api/services/ai/metrics` | Métricas IA | Token/política del proxy |
| GET/POST | `/api/license/*` | Salud, activación, validación y desactivación | Política de licencias |
| GET | `/admin` | Diagnóstico señalización | `X-Signaling-Admin-Token` |
| GET/POST | `/csp-report` | Informes CSP y diagnóstico | GET requiere `X-CSP-Admin-Token` |
| POST | `/api/client-events` | Eventos de degradación del cliente (opt-in en el cliente) | Rate limit por IP; sin contenido |
| GET | `/api/client-events` | Diagnóstico del collector | `X-Client-Events-Admin-Token` (503 si no está configurado) |
| POST | `/api/client-events/retry-stats` | Contadores acumulados de reintentos del reporter | Rate limit por IP |
| POST | `/api/analytics/events` | Bucket diario agregado de analítica opt-in (`iid` + `batchId` + `counts`) | Rate limit por IP (hash con sal); sin PII |
| GET | `/api/analytics/kpis` | KPIs agregados (DAU/WAU/MAU, cohortes, funnel) | `X-Analytics-Admin-Token` (503 si no está configurado) |

Las rutas y contratos exactos deben mantenerse sincronizados con los handlers de `server/src`. No añadir endpoints que devuelvan secretos, contenido del vault o datos operativos sin autenticación.

## Sesión de IA

1. El cliente envía `POST /api/services/ai/session` desde un origen permitido.
2. En producción presenta la prueba de licencia firmada.
3. El servidor establece cookie de sesión `HttpOnly` y cookie CSRF no-HttpOnly.
4. Las peticiones posteriores envían `X-CSRF-Token` con el valor CSRF.
5. La sesión caduca y debe renovarse; no reutilizar tokens en logs.

## WebSocket de señalización

Mensajes principales:

```json
{ "type": "init", "yourPeerId": "..." }
{ "type": "join", "room": "room-id", "roomSecret": "..." }
{ "type": "joined", "otherPeerIds": ["..."] }
{ "type": "signal", "senderPeerId": "...", "room": "...", "receiverPeerId": "...", "data": {} }
```

Las rooms con secreto requieren autenticación HMAC de cada señal. El servidor valida el sender, room, peer destinatario, tamaño, rate limits y replay window.

> **Alcance del `roomSecret` (A-3):** el cliente solo lo envía al servidor de señalización autoalojado que tenga configurado (`VITE_P2P_SIGNALING_URL`). Sobre los relays públicos (rxdb.info/PubNub) el `join` va SIN el secreto: el relay únicamente ve el nombre de sala opaco derivado por HMAC (A-2), y el secreto —que es la capability de la sala y la clave de cada `signalAuth`— nunca sale de los peers. Sin servidor autoalojado configurado no se envía jamás (fail-closed), y el servidor sigue aceptando `roomSecret` opcional para enforcement de salas con secreto. La mitad "relay público" de este contrato se verifica end-to-end (`npm run e2e:relay`): la app se arranca **sin** `VITE_P2P_SIGNALING_URL` contra un relay de prueba dentro de la página y se inspecciona el `join` emitido.

> **Nota de despliegue:** el estado de rooms de señalización vive en memoria del proceso (una sola réplica). Escalar horizontalmente el WebSocket requiere un adaptador compartido (p. ej. Redis pub/sub) o enrutamiento por afinidad; no hacerlo divide rooms entre réplicas y rompe la entrega de señales.

## Analítica opt-in (`/api/analytics/*`)

- El cliente solo envía datos tras el consentimiento explícito (`forge_consent_analytics`); por defecto nada sale del dispositivo.
- El payload es `{ iid, batchId, counts }`: `iid` es el SHA-256 de un id aleatorio por instalación, `counts` son totales diarios de una lista cerrada de tipos de evento, sin contenido.
- `batchId` hace el ingest aditivo e idempotente: los lotes parciales se suman y un reintento del mismo lote no duplica (respuesta 204 sin recontar). Los payloads sin `batchId` (clientes antiguos) conservan la semántica de reemplazo por día.
- Si el estado por instalación alcanza su tope, el endpoint responde `503` con `Retry-After` (fail-closed, sin descartar datos silenciosamente).
- Los KPIs (`GET /api/analytics/kpis`) exigen `X-Analytics-Admin-Token`; sin token configurado el endpoint responde `503`.

## Versionado

Los cambios incompatibles requieren una versión de protocolo nueva o compatibilidad explícita. Añadir pruebas de contrato para cada integración y endpoint sensible.
