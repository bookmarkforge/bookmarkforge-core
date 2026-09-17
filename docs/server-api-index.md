# API del Companion Server — BookmarkForge

El companion server es el backend mínimo de BookmarkForge. Reside en `server/src` y se ejecuta con:

```bash
npx tsx server/src/index.ts
```

Por defecto escucha en `ws://0.0.0.0:8787`. En producción debe ir detrás de un
reverse proxy que termine TLS; el servidor mismo habla HTTP para los endpoints
documentados abajo y WebSocket para la señalización P2P.

Este documento está alineado con los handlers reales del servidor
(`server/src/index.ts` y los módulos que monta). No es una especificación aparte:
si el código cambia, este índice debe actualizarse.

---

## 1. Diseño general

- **HTTP mínimo:** el servidor es un `http.createServer` manual, no usa framework.
- **Sin proxy de IA:** el servidor no habla con proveedores de IA ni guarda
  credenciales de IA. Las llamadas salen del navegador directamente, con la
  clave que el usuario guardó en su propio vault.
- **Sin contenido del vault:** ninguno de los endpoints recibe ni almacena
  marcadores, notas, documentos ni prompts.
- **Fail-closed:** los handlers validan cuerpo, orígenes, tokens y límites de
  forma explícita; ante una configuración ausente responden `503` antes que
  degradar la seguridad.
- **Respuestas no cacheables:** la mayoría de handlers fijan `Cache-Control:
  no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer` y `Content-Security-Policy:
  default-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
- **Cualquier otra petición HTTP:** devuelve `426 Upgrade Required`. El servidor
  solo habla HTTP para los paths documentados; todo lo demás es WebSocket.
- **Sin estado compartido:** la topología de producción son dos servicios
  stateless. No hay Redis ni base de datos del servidor.

---

## 2. Endpoints HTTP

La tabla autoritativa de rutas y su nivel de acceso vive en
`server/src/route-table.ts`. `npm run check:pro-routes` falla si el router
despacha una ruta no declarada, si una ruta declarada nunca se despacha, o si el
dispatcher deja de estar conectado al guard de entitlement.

### 2.1 `GET /health`

- **Propósito:** liveness mínimo para healthchecks y uptime probes.
- **Autenticación:** ninguna.
- **Respuesta:** texto plano breve, sin contadores operativos ni identificadores.
- **Caché:** no-store.

---

### 2.2 `GET /api/license/health`

- **Propósito:** salud de la integración con el proveedor de licencias.
- **Autenticación:** ninguna; origin allow-list + rate limit por IP.
- **Respuesta:** `200` si el proveedor responde, `503` si el servicio de firma no
  está configurado.

---

### 2.3 `POST /api/license/activate`

- **Propósito:** canjear una clave comprada por una prueba de entitlement firmada.
  Es pública por diseño: el llamante todavía no tiene prueba que presentar.
- **Cuerpo:** JSON con la identidad de licencia (`licenseKey`, `deviceId`).
- **Respuesta:** `200 { payload, signature }` con la prueba firmada.
- **Errores:** `400` cuerpo inválido · `403` origen · `429` rate limit ·
  `502` fallo del proveedor · `503` servicio de firma no configurado.

---

### 2.4 `POST /api/license/validate`

- **Propósito:** revalidar una clave existente. Se alcanza mientras el vault
  puede seguir bloqueado, así que no lleva prueba.
- **Errores:** mismos códigos que `activate`.

---

### 2.5 `POST /api/license/deactivate`

- **Propósito:** liberar una activación (equipo perdido). Exigir una prueba aquí
  dejaría varado a un dispositivo perdido.
- **Respuesta:** `200 { ok: true }`.

---

### 2.6 `POST /api/license/entitlement`

- **Propósito:** respuesta autoritativa del **plan** verificando la prueba que el
  cliente ya posee.
- **Cuerpo:** `{ payload, signature }`.
- **Respuesta `200`:**
  - `{ plan: "pro", source: "license", deviceId, validatedAt, … }`
  - `{ plan: "free", source: "none", reason, message }` — una respuesta
    definitiva, no un error: permite degradar explícitamente a Free en vez de
    quedarse en la ventana de gracia offline.
- **`503 SIGNING_KEY_INVALID`:** la clave pública del despliegue es inutilizable.
  No es una degradación; el cliente conserva su estado verificado offline.
- **Otros:** `400` cuerpo inválido · `403` origen · `405` método · `413` prueba
  demasiado grande · `429` rate limit.
- **Orígenes:** allow-list `AI_SESSION_ORIGINS` (nombre histórico: el endpoint
  responde el plan de licencia, no una sesión de IA). Vacío solo se tolera fuera
  de producción.

---

### 2.7 `GET /admin`

- **Propósito:** diagnóstico del servidor de señalización.
- **Autenticación:** `X-Signaling-Admin-Token`.
- **Notas:** nunca transporta datos de cliente.

---

### 2.8 `POST /csp-report` y `GET /csp-report`

- **Propósito:** recibir informes de violación CSP y leer los recogidos.
- **`POST`:** pública; el navegador no adjunta credenciales. Se filtra por origen
  y se limita por IP. Responde `204`.
- **`GET`:** requiere `X-CSP-Admin-Token`.
- **Retención:** anillo en memoria acotado; persistencia JSONL opcional.

---

### 2.9 `POST /api/client-events` y `GET /api/client-events`

- **Propósito:** telemetría de degradación del cliente (presión de
  almacenamiento, picos de integridad del bundle).
- **`POST`:** se envía **solo** tras consentimiento explícito del usuario.
  Payload pseudónimo y sin contenido; validación de forma + rate limit por IP.
- **`GET`:** diagnóstico del collector con `X-Client-Events-Admin-Token`;
  responde `503` si no está configurado.
- **Umbral CRÍTICO:** puede disparar un webhook HTTPS si está configurado.
- **Retención:** anillo en memoria acotado; no persiste por defecto.

---

### 2.10 `GET /api/client-events/retry-stats`

- **Propósito:** contadores acumulados de reintentos del reporter del cliente.
- **Autenticación:** ninguna; rate limit por IP.

---

### 2.11 `POST /api/analytics/events`

- **Propósito:** ingesta de un bucket diario agregado opt-in.
- **Cuerpo:** `{ iid, batchId, counts }`. `iid` es el SHA-256 de un id aleatorio
  por instalación (nunca una identidad de usuario); `counts` son totales diarios
  de una lista cerrada de tipos de evento.
- **Idempotencia:** `batchId` hace la ingesta aditiva; un reintento del mismo
  lote no duplica. Sin `batchId` se conserva la semántica de reemplazo por día.
- **Respuesta:** `204`. `503` con `Retry-After` si el estado por instalación
  alcanza su tope (fail-closed, sin descartar datos en silencio).
- **Privacidad:** la IP se hashea con sal; sin PII y sin contenido.

---

### 2.12 `GET /api/analytics/kpis`

- **Propósito:** KPIs agregados (DAU/WAU/MAU, retención por cohorte, funnel).
- **Autenticación:** `X-Analytics-Admin-Token`; `503` si no está configurado.
- **Privacidad:** solo agregados.

---

## 3. Ruteo y seguridad HTTP general

- **Orígenes:** `hasValidOrigin()` compara el `Origin` recibido con una
  allow-list explícita y, en su defecto, con el origen derivado de `Host` (más
  `X-Forwarded-Proto` cuando `TRUST_PROXY` está activo). Los endpoints que
  reciben navegadores —licencias y entitlement— la aplican.
- **Una sola admisión por request:** el guard de entitlement resuelve el contexto
  una vez por request y lo adjunta bajo un símbolo no escribible; los handlers
  posteriores leen ese contexto y **no vuelven a verificar**.
- **Tokens:** los tokens de administración se comparan en tiempo constante. Los
  tokens de identidad se hashean antes de usarse como clave de política.
- **Cuerpo:** todos los endpoints con body validan tamaño máximo. JSON malformado
  o no-objeto produce `400`.
- **Códigos de error comunes:**
  - `400`: request inválido o JSON malformado.
  - `403`: origen no permitido (`CSRF_ORIGIN`) o token inválido.
  - `405`: método no permitido.
  - `413`: body demasiado grande.
  - `426`: ruta HTTP no soportada (WebSocket esperado).
  - `429`: rate limit.
  - `502`: error del proveedor upstream.
  - `503`: servicio no configurado o no disponible.

---

## 4. WebSockets (señalización P2P)

El servidor también es un servidor de señalización WebSocket. No es un API REST,
pero es parte de su contrato.

- **Upgrade:** cualquier conexión que no coincida con los paths HTTP anteriores
  recibe `426`; el cliente debe usar WebSocket para el resto.
- **Orígenes:** si `WS_ALLOWED_ORIGINS` está definido, los upgrades desde otros
  orígenes se rechazan con `403`. Vacío = sin comprobación (desarrollo local).
- **Mensajes principales:**
  - `init`: servidor → cliente con `yourPeerId` y opcionalmente `iceServers`
    (credenciales TURN efímeras cuando el relay está configurado).
  - `join`: cliente → servidor con `room` y opcional `roomSecret`. El cliente
    solo lo envía a su servidor autoalojado configurado
    (`VITE_P2P_SIGNALING_URL`); los relays públicos nunca lo reciben (A-3),
    así que en modo relay la sala no tiene secreto que validar.
  - `joined`: servidor → todos los miembros de la sala con los peer IDs.
  - `signal`: cliente ↔ servidor para relayar señales entre peers.
- **Protección:** las salas con secreto exigen HMAC en cada señal
  (`ENFORCE_SIGNAL_HMAC=1` en producción); el servidor valida emisor, sala, peer
  destinatario, tamaño del payload, rate limits y ventana anti-replay.
- **Límites:** conexiones, rooms, peers por room, tamaño de payload y tasa de
  `join` están acotados y son configurables por entorno.

---

## 5. Estado y persistencia

- **Analítica:** memoria + archivo opcional `ANALYTICS_STATE_FILE` con escritura
  atómica.
- **Client events:** anillo en memoria acotado; no persiste por defecto.
- **CSP reports:** anillo en memoria acotado; persistencia JSONL opcional.
- **Licencias:** sin estado propio; depende del proveedor externo y de la clave
  de firma.
- **Señalización:** estado en memoria del proceso; no persiste entre reinicios.

---

## 6. Configuración mínima relevante para la API

Los valores por defecto están documentados en los handlers. Estas son las
variables de entorno que afectan directamente a los endpoints:

- `PORT`, `HOST`
- `NODE_ENV`
- `TRUST_PROXY`
- `WS_ALLOWED_ORIGINS`
- `AI_SESSION_ORIGINS` — allow-list de `POST /api/license/entitlement`
  (obligatoria en producción)
- `LICENSE_SIGNING_PRIVATE_KEY_FILE` / `LICENSE_SIGNING_PRIVATE_KEY_PKCS8`
- `WHOP_LICENSE_API_URL`, `WHOP_API_KEY`, `LICENSE_PROVIDER_ALLOW_HTTP`
- `SIGNALING_ADMIN_TOKEN`
- `CSP_REPORT_ADMIN_TOKEN`, `CSP_REPORT_*`
- `CLIENT_EVENTS_ADMIN_TOKEN`, `CLIENT_EVENTS_*`, `CLIENT_EVENTS_WEBHOOK_URL`
- `ANALYTICS_ADMIN_TOKEN`, `ANALYTICS_*`
- `TURN_RELAY_HOST`, `TURN_STATIC_AUTH_SECRET`, `TURN_*`
- `ENFORCE_SIGNAL_HMAC`

Los defaults están en el código; valores malformados caen al default documentado.

---

## 7. Relación con la documentación existente

- `docs/api.md` es la vista general del protocolo y los endpoints.
- `docs/openapi.yaml` es la especificación OpenAPI 3.1 de esta misma superficie.
- Este índice es la referencia de endpoints alineada con los handlers reales.

---

## 8. Próximos pasos opcionales

- Añadir ejemplos de request/response por endpoint extraídos de los tests.
- Generar el spec OpenAPI desde la tabla de rutas para que no pueda derivar.
