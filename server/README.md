# Servidor Companion de BookmarkForge

Servidor HTTP + WebSocket de señalización P2P, licencias y telemetría.

## Arquitectura

```
server/src/
├── index.ts              # Entry point: HTTP server + WebSocket server
├── proxy-utils.ts        # Utilities: readBoundedInteger, constantTimeUtf8Equal, clientIp
├── route-table.ts        # Política de rutas HTTP (qué es Pro vs Core)
├── license-server.ts     # Manejo de licencias Whop (activate/validate/deactivate)
├── license-signing.ts    # Firma criptográfica de licencias
├── license-public-key.ts # Clave pública de verificación de licencias
├── entitlement-endpoint.ts  # POST /api/license/entitlement
├── entitlement-guard.ts    # Middleware de entitlement para rutas
├── entitlement-context.ts  # Contexto de entitlement
├── client-events.ts        # Recolector de eventos de cliente (storage-pressure)
├── business-analytics.ts   # Analítica opt-in (DAU/WAU/MAU)
└── __tests__/              # Tests del servidor
```

## Características

- **WebSocket signaling**: Salas P2P con secretos, HMAC para señales, rate limiting por IP
- **HTTP endpoints**: `/health`, `/admin`, `/csp-report`, `/api/license/*`, `/api/client-events`, `/api/analytics/*`
- **TURN relay**: Credenciales ephemeral via coturn/REST API
- **CSP reporting**: Recolector de violaciones con persistencia JSONL opcional
- **Rate limiting**: Ventanas de tiempo por IP para joins y reportes
- **Heartbeat**: Sweep de sockets muertos para limpiar salas

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Liveness probe (sin datos sensibles) |
| GET | `/admin` | Diagnostics (requiere SIGNALING_ADMIN_TOKEN) |
| POST | `/csp-report` | Violaciones CSP (per-IP rate limited) |
| GET | `/csp-report` | Dashboard de reportes (requiere CSP_REPORT_ADMIN_TOKEN) |
| POST | `/api/license/activate` | Activa licencia |
| POST | `/api/license/validate` | Valida licencia |
| POST | `/api/license/deactivate` | Desactiva licencia |
| POST | `/api/license/entitlement` | Resuelve plan Pro/Free |
| POST | `/api/client-events` | Eventos de almacenamiento |
| POST | `/api/analytics/events` | Eventos analíticos |
| WS | `/` | WebSocket signaling P2P |

## Configuración

Variables de entorno principales:
- `PORT` / `HOST` — Puerto y host del servidor
- `SIGNALING_ADMIN_TOKEN` — Token para /admin
- `CSP_REPORT_ADMIN_TOKEN` — Token para /csp-report dashboard
- `CSP_REPORT_FILE` — Ruta a archivo JSONL de persistencia CSP
- `TRUST_PROXY` — Si `1`, usa x-forwarded-for para IP real
- `TURN_RELAY_HOST` / `TURN_STATIC_AUTH_SECRET` — Configuración TURN
- `ENFORCE_SIGNAL_HMAC=1` — HMAC obligatorio para señales

## Desarrollo

```bash
npm run server          # Inicia el servidor con tsx
npm run server:watch    # Modo watch
```

## Testing

```bash
# Tests del servidor
npx vitest run server/src/__tests__/
```

## Seguridad

- HMAC constant-time para room secrets y señales
- Rate limiting por IP con ventanas temporales
- WebSocket origin filtering
- CSP report anonymization (IP hash)
- Webhook TLS-only para alertas CSP
- Admin endpoints fail-closed (503 si no hay token)
- Dead socket reaping con heartbeat

## Estado

El servidor es **stateless** — no hay base de datos ni Redis. Todo el estado de salas vive en memoria. Los servicios son:
- **Web**: React + Vite (frontend)
- **API**: Companion server (Node.js + WS)
- Ambos son stateless y despliegables independientemente

Consulta `docs/server-api-index.md` para la especificación completa de la API.
