# API del Companion Server — BookmarkForge

El companion server es el backend mínimo de BookmarkForge. Reside en `server/src` y se ejecuta con:

```bash
npx tsx server/src/index.ts
```

Por defecto escucha en `ws://0.0.0.0:8787`. En producción debe ir detrás de un
reverse proxy que termine TLS; el servidor mismo habla HTTP para los endpoints
documentados abajo y WebSocket para la señalización P2P.

Este documento está generado directamente desde los handlers reales del
servidor (`server/src/index.ts` y los módulos que monta). No es una
especificación aparte: si el código cambia, este índice debe actualizarse.

---

## 1. Diseño general

- **HTTP mínimo:** el servidor es un `http.createServer` manual, no usa framework.
- **Sin PublicKey de FQ:** los handlers validan cuerpo, orígenes, tokens y límites
  de forma explícita; fallan cerrado por defecto.
- **Sin contenido del vault:** ninguno de los endpoints recibe ni almacena
  marcadores, notas, documentos ni prompts.
- **Respuestas no cacheables:** la mayoría de handlers fijan `Cache-Control:
  no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, y `Content-Security-Policy:
  default-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
- **Cualquier otra petición HTTP:** devuelve `426 Upgrade Required`. El servidor
  solo habla HTTP para los paths documentados; todo lo demás es WebSocket.

---

## 2. Endpoints HTTP

### 2.1 `GET /health`

- **Propósito:** liveness mínimo para healthchecks y uptime probes.
- **Método:** `GET`
- **Autenticación:** Ninguna.
- **Cuerpo de respuesta:** texto plano breve, sin contadores operativos ni
  identificadores.
- **Caché:** no-store.
- **Notas:** no expone métricas, estados internos ni identifies de instancia.
  Diseñado para ser público pero poco informativo.

---

### 2.2 `POST /api/services/ai/session`

- **Propósito:** crear una sesión efímera de IA.
- **Método:** `POST`
- **Cuerpo:** JSON con proof de licencia (según configuración).
- **Respuesta:**
  - `200` con `{ csrfToken, expiresAt }` y dos cookies:
    - `bf_ai_session` (HttpOnly, Secure bajo HTTPS, SameSite=Strict)
    - `bf_ai_csrf` (no HttpOnly, SameSite=Strict)
- **Protección:**
  - Verificación de origen (allow-list `AI_SESSION_ORIGINS` o derivado de Host
    fuera de producción).
  - Rate limit por IP al crear sesiones.
  - En producción requiere `AI_SESSION_ORIGINS` explícito; el servidor falla
    al arrancar si falta y `NODE_ENV=production`.
  - En producción requiere license proof a menos que `AI_SESSION_REQUIRE_LICENSE=0`.
- **Notas:**
  - Las sesiones tienen TTL configurable (`SESSION_TTL_MS`, por defecto 30 min).
  - El CSRF token se compara en tiempo constante en peticiones posteriores.
  - El estado de sesión puede persistirse en Redis si se configura
    `AI_PROXY_REDIS_URL`.

---

### 2.3 `POST /api/services/ai/generate`

- **Propósito:** proxy de generación de texto de IA.
- **Método:** `POST`
- **Autenticación:** Cookie de sesión + CSRF, o bearer token si se configura.
- **Cuerpo:** JSON con el prompt y parámetros del modelo.
- **Respuesta:**
  - `200` con la respuesta del modelo (texto).
  - Posibles errores: `401`, `429`, `503`, `502`.
- **Protección:**
  - Sesión autenticada o token bearer entre los configurados.
  - Rate limit por IP y política de cuotas por identidad.
  - Circuit breaker sobre el upstream.
  - Límites de tamaño de body y de respuesta.
- **Notas:**
  - El proxy reemplaza `gemini` por `models/` si es necesario en el modelo.
  - Respeta `AI_SESSION_REQUIRE_LICENSE` y los orígenes de sesión.
  - No almacena prompts ni respuestas.

---

### 2.4 `POST /api/services/ai/generate-tts`

- **Propósito:** síntesis de voz (TTS) vía proxy.
- **Método:** `POST`
- **Autenticación:** Igual que el proxy de generación.
- **Cuerpo:** `{ text, lang? }`
- **Respuesta:** `200` con `{ audioBase64 }`.
- **Protección:** misma política de sesión, rate limit y circuit breaker que el
  proxy de texto.
- **Notas:**
  - Modelo configurable con `AI_TTS_MODEL` (por defecto
    `gemini-2.5-flash-preview-tts`).
  - El texto está limitado en longitud; la respuesta base64 también tiene límite.

---

### 2.5 `POST /api/services/ai/generate-image`

- **Propósito:** generación de imagen vía proxy.
- **Método:** `POST`
- **Autenticación:** Igual que el proxy de generación.
- **Cuerpo:** `{ prompt }`
- **Respuesta:** `200` con `{ imageBase64 }`.
- **Protección:** misma política de sesión, rate limit y circuit breaker.
- **Notas:**
  - Modelo configurable con `AI_IMAGE_MODEL` (por defecto
    `imagen-3.0-generate-002`).
  - El prompt y la imagen resultante tienen límites de tamaño.

---

### 2.6 `GET /api/services/ai/admin`

- **Propósito:** diagnóstico de identidades y presupuestos del proxy.
- **Método:** `GET`
- **Autenticación:** Token administrativo (`AI_PROXY_ADMIN_TOKEN` o Bearer con
  token configurado). Sin token → `503`.
- **Respuesta:** `200` con estadísticas por identidad (hash, no token crudo).
- **Protección:**
  - Token separado del de generación para que las credenciales de generación
    no puedan leer presupuestos.
  - Comparación en tiempo constante del token.
- **Notas:**
  - Expone patrones de tráfico, no secretos.
  - Sin token configurado el endpoint responde `503`.

---

### 2.7 `GET /api/services/ai/metrics`

- **Propósito:** métricas del proxy en formato Prometheus.
- **Método:** `GET`
- **Autenticación:** Igual que `/api/services/ai/admin`.
- **Respuesta:** `200` con texto Prometheus.
- **Protección:** misma gating de token que `/admin`.
- **Notas:**
  - Sin token configurado → `503`.
  - no expone secretos ni prompts.

---

### 2.8 `GET /api/license/health`

- **Propósito:** salud del servicio de licencias.
- **Método:** `GET`
- **Autenticación:** Ninguna.
- **Respuesta:**
  - `200` si el servicio está configurado.
  - `503` si faltan componentes (clave de firma o configuración del proveedor).
- **Notas:**
  - No requiere body.
  - Sirve para verificar que el servicio de licencias está operational.

---

### 2.9 `POST /api/license/activate`

- **Propósito:** activar una licencia en el proveedor externo y firmar el
  estado resultante.
- **Método:** `POST`
- **Cuerpo:** `{ license_key, instance_name?, instance_id? }`
- **Respuesta:**
  - `200` con `{ payload, signature }` si el proveedor confirma activación.
  - `400/401/429/502/503` según el caso.
- **Protección:**
  - Rate limit por IP.
  - Clave de firma requerida.
  - Validación estricta de respuesta del proveedor (expiración parseable,
    estado explícito, sin otorgamiento desde respuestas ambiguas).
- **Notas:**
  - El payload firmado es la prueba de estado que el cliente usa para las
    sesiones de IA.
  - El servidor puede firmar con clave PKCS#8 cargada del entorno.

---

### 2.10 `POST /api/license/validate`

- **Propósito:** validar una licencia activa sin activar.
- **Método:** `POST`
- **Cuerpo:** `{ license_key, instance_name?, instance_id? }`
- **Respuesta:**
  - `200` con `{ payload, signature }` si la licencia es válida y activa.
  - `400/401/429/502/503` según el caso.
- **Protección:** igual que `/activate`.
- **Notas:**
  - Usado para verificación sin nuevas activaciones.
  - Los mismos criterios de validez que activación.

---

### 2.11 `POST /api/license/deactivate`

- **Propósito:** desactivar una licencia en el proveedor externo.
- **Método:** `POST`
- **Cuerpo:** `{ license_key, instance_name?, instance_id? }`
- **Respuesta:**
  - `200` si el proveedor confirma desactivación.
  - `400/401/429/502/503` según el caso.
- **Protección:**
  - Rate limit por IP.
  - El proveedor debe confirmar explícitamente la desactivación; una respuesta
    2xx vacía no es suficiente.
- **Notas:**
  - Diseñado para liberar slots de activación.
  - Si el proveedor no confirma, el servidor responde error.

---

### 2.12 `GET /admin`

- **Propósito:** diagnóstico del servidor de señalización.
- **Método:** `GET`
- **Autenticación:** Token administrativo de señalización
  (`SIGNALING_ADMIN_TOKEN`). Sin token → `503`.
- **Respuesta:** JSON con estado del servidor de señalización.
- **Protección:**
  - Token separado de los otros endpoints.
  - Comparación en tiempo constante del token presentado.
- **Notas:**
  - Revela información operativa del estado de las salas y conexiones.
  - Solo habilitado si se configura el token.

---

### 2.13 `POST /csp-report` y `GET /csp-report`

- **Propósito:** recolección de informes de violaciones de CSP.
- **Método:** `POST` para recibir, `GET` para diagnóstico.
- **Autenticación:**
  - `POST`: sin autenticación (el navegador envía el informe sin token).
  - `GET`: token administrativo `CSP_REPORT_ADMIN_TOKEN` → `503` si no está
    configurado.
- **Respuesta:**
  - `POST`: `204` o `400` según validación.
  - `GET`: JSON con diagnósticos del colector.
- **Protección:**
  - Límite de tamaño de body.
  - Tasa por IP.
  - Solo HTTPS en webhook de alertas (con opt-out explícito fuera de producción).
- **Notas:**
  - Los informes se reducen antes de persistir o enviar a webhook.
  - El operador puede habilitar persistencia JSONL opcional.

---

### 2.14 `POST /api/client-events` y `GET /api/client-events`

- **Propósito:**
  - `POST`: recibir eventos operativos de client-side (presión de almacenamiento,
    picos de integridad de bundle, picos de error, picos de CSP).
  - `GET`: diagnósticos del colector.
- **Método:** `POST` para enviar, `GET` para diagnóstico. También acepta
  subrutas como `/api/client-events/retry-stats`.
- **Autenticación:**
  - `POST`: sin autenticación (el cliente no puede adjuntar token admin).
  - `GET`: token administrativo `CLIENT_EVENTS_ADMIN_TOKEN` → `503` si no está
    configurado.
- **Cuerpo:** JSON con el tipo de evento y datos relevantes.
- **Respuesta:**
  - `POST`: `204` o `400/413/429`.
  - `GET`: JSON con estado del colector y eventos recientes.
- **Protección:**
  - Límite de tasa por IP.
  - Hash salted de IP para conteo de clientes distintos (no almacena la IP).
  - Umbral configurable de clientes críticos en ventana para disparar alerta.
  - Webhook de alertas HTTPS-only por defecto.
- **Notas:**
  - Los eventos críticos disparan log estructurado + webhook de alerta.
  - La actividad de reintento del cliente se usa para detectar pérdida de
    eventos.

---

### 2.15 `POST /api/analytics/events`

- **Propósito:** recibir buckets diarios agregados de analítica opt-in.
- **Método:** `POST`
- **Autenticación:** Ninguna (el cliente no adjunta token admin).
- **Cuerpo:** `{ iid, counts, batchId? }`
  - `iid`: SHA-256 hex de un id de instalación aleatorio.
  - `counts`: map de tipo de evento → conteo.
  - `batchId` opcional para idempotencia.
- **Respuesta:**
  - `204` aceptado o duplicado.
  - `400/413/429/503` según el caso.
- **Protección:**
  - Allow-list de tipos de evento.
  - Conteos enterospositivos y limitados.
  - Límite de tasa por IP.
  - Estado por instalación acotado (`ANALYTICS_MAX_INSTALLS`).
  - Retención de días acotada (`ANALYTICS_MAX_DAYS`).
- **Notas:**
  - Sin contenido del vault, prompts, URLs, títulos ni timestamps de acciones.
  - La idempotencia se gestiona con `batchId`; sin `batchId` se usa semántica
    legacy por día.
  - Estado persistible opcional con archivo atómico.

---

### 2.16 `GET /api/analytics/kpis`

- **Propósito:** reportar KPIs agregados de analítica opt-in.
- **Método:** `GET`
- **Autenticación:** Token administrativo `ANALYTICS_ADMIN_TOKEN`. Sin token → `503`.
- **Respuesta:** `200` con KPI report (DAU/WAU/MAU, cohortes, funnel, diario,
  contadores, instancia del servidor).
- **Protección:**
  - Token separado para diagnóstico.
  - Comparación en tiempo constante del token.
- **Notas:**
  - Sin token configurado → `503`.
  - Expone agregados, no datos individuales de usuarios.

---

## 3. Ruteo y seguridad HTTP general

- **Orígenes:**
  - Los endpoints de sesión de IA validan `Origin` o derivan origen de `Host`
    (con advertencia/excepción según entorno).
  - La validación de origen es una defensa principal contra CSRF en el proxy de
    IA.
- **Cookies de sesión:**
  - `bf_ai_session` y `bf_ai_csrf` con `SameSite=Strict`.
  - `Secure` bajo HTTPS; `HttpOnly` solo para la cookie de sesión.
- **Una sola admisión por request (rutas pagadas):**
  - El guard de entitlement del router resuelve la credencial (sesión con
    cookie + CSRF, o bearer heredado) y adjunta el contexto resuelto al request
    bajo un símbolo no escribible; los handlers de IA consumen ese contexto y
    **no vuelven a autenticar**. Dos admisiones por request serían dos
    veredictos sobre lo mismo, y la identidad de cuota se deriva del contexto:
    la misma con la que se cobraba antes, así que ningún usuario pierde cupo.
  - Un handler montado sin el router (uso embebido, tests) no tiene contexto y
    cae a su propia admisión; un request sin credencial válida sigue siendo
    `401 { code: "UNAUTHORIZED" }`.
- **Tokens:**
  - Los tokens de autorización y administración se comparan en tiempo constante
    donde corresponde.
  - Los tokens de identidad se hashean antes de almacenar/uso en política.
- **Cuerpo:**
  - Todos los endpoints con body validan tamaño máximo.
  - JSON malformado o no objeto genera `400`.
- **Códigos de error comunes:**
  - `400`: request inválido o JSON malformado.
  - `401`: autenticación requerida/fallida.
  - `403`: origen no permitido.
  - `405`: método no permitido.
  - `413`: body demasiado grande.
  - `426`: ruta HTTP no soportada (WebSocket esperado).
  - `429`: rate limit.
  - `502`: error del proveedor upstream.
  - `503`: servicio no configurado o no disponible.
- **Encabezados de respuesta:**
  - `Cache-Control: no-store` en la mayoría de handlers protegidos.
  - `Content-Type` explícito según respuesta.
  - Headers de protección aplicados por helpers comunes.

---

## 4. WebSockets (señalización P2P)

El servidor también es un servidor de señalización WebSocket. Este no es un API
REST, pero es parte del contrato del companion server.

- **Upgrade:** cualquier conexión que no coincida con los paths HTTP anteriores
  recibe `426`; el cliente debe usar WebSocket para el resto.
- **Mensajes principales:**
  - `init`: servidor → cliente con `yourPeerId` y opcionalmente `iceServers`.
  - `join`: cliente → servidor con `room` y opcional `roomSecret`. El cliente
    solo lo envía a su servidor autoalojado configurado
    (`VITE_P2P_SIGNALING_URL`); los relays públicos nunca lo reciben (A-3),
    así que en modo relay la sala no tiene secreto que validar.
  - `joined`: servidor → todos los miembros de la sala con los peer IDs.
  - `signal`: cliente ↔ servidor para relayar señales entre peers.
- **Protección:**
  - Límites de conexiones, salas, peers por sala y tamaño de payload.
  - Tasa de joins por IP.
  - Un join por conexión.
  - Validación de room secret si la sala tiene secreto.
  - Anti-spoofing de senderPeerId (un socket solo puede actuar como su propio
    peerId).
  - Verificación de señales con HMAC si se habilita `ENFORCE_SIGNAL_HMAC`.
- **Estado:**
  - Las salas viven en memoria del proceso (una sola réplica).
  - Escalar horizontalmente requiere un adaptador compartido (p. ej. Redis
    pub/sub) o enrutamiento por afinidad, o rompe la entrega de señales.

---

## 5. Estado y persistencia

- **Sesiones de IA:** memoria + Redis opcional para persistencia entre
  reinicios.
- **Analítica:** memoria + archivo opcional `ANALYTICS_STATE_FILE` con escritura
  atómica.
- **Client events:** anillo en memoria acotado; no persiste por defecto.
- **CSP reports:** anillo en memoria acotado; persistencia JSONL opcional.
- **Licencias:** sin estado propio de licencias; depende del proveedor externo
  y de la clave de firma.
- **Señalización:** estado en memoria del proceso; no persiste entre reinicios.

---

## 6. Configuración mínima relevante para la API

Los valores por defecto están documentados en los handlers, pero estos son los
variables de entorno que afectan directamente a los endpoints:

- `PORT`, `HOST`
- `NODE_ENV`
- `TRUST_PROXY`
- `AI_SESSION_ORIGINS`
- `AI_SESSION_REQUIRE_LICENSE`
- `AI_PROXY_REDIS_URL` / `AI_PROXY_REDIS_FAILURE_MODE`
- `GEMINI_API_KEY` / `GEMINI_API_BASE`
- `AI_PROXY_AUTH_TOKEN` / `AI_PROXY_AUTH_TOKENS`
- `AI_PROXY_IP_RATE_LIMIT`, `AI_PROXY_IDENTITY_RATE_LIMIT`,
  `AI_PROXY_DAILY_QUOTA`
- `AI_PROXY_TOKEN_QUOTAS`, `AI_PROXY_TOKEN_RATE_LIMITS`
- `AI_PROXY_ADMIN_TOKEN`
- `AI_PROXY_CIRCUIT_BREAKER_THRESHOLD`,
  `AI_PROXY_CIRCUIT_BREAKER_COOLDOWN_MS`
- `AI_PROXY_STATE_FILE`
- `AI_TTS_MODEL`, `AI_IMAGE_MODEL`
- `LICENSE_SIGNING_PRIVATE_KEY_FILE` / `LICENSE_SIGNING_PRIVATE_KEY_PKCS8`
- `WHOP_LICENSE_API_URL`, `WHOP_API_KEY`, `LICENSE_PROVIDER_ALLOW_HTTP`
- `SIGNALING_ADMIN_TOKEN`
- `CSP_REPORT_ADMIN_TOKEN`, `CSP_REPORT_*`
- `CLIENT_EVENTS_ADMIN_TOKEN`, `CLIENT_EVENTS_*`,
  `CLIENT_EVENTS_WEBHOOK_URL`
- `ANALYTICS_ADMIN_TOKEN`, `ANALYTICS_*`

Los defaults están en el código; valores malformados caen al default documentado.

---

## 7. Relación con la documentación existente

Existe `docs/api.md` como vista general del protocolo y los endpoints. Este
índice es más explícito y está más alineado con la estructura real de los
handlers. Si se mantiene este archivo, `docs/api.md` debería tratarse como
documentación de alto nivel y este como referencia de endpoints.

---

## 8. Próximos pasos opcionales

- Convertir este índice en un spec OpenAPI 3.1 si el equipo decide llevar
  contratos versionados.
- Añadir ejemplos de request/response por endpoint desde los tests existentes.
- Añadir tabla de rutas con métodos, auth y codes esperados para integración
  con generación de docs automática.
