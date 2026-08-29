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
| GET/POST | `/csp-report` | Informes CSP y diagnóstico | GET requiere token |
| POST/GET | `/api/client-events` | Eventos y diagnósticos de cliente | Política del collector |

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

## Versionado

Los cambios incompatibles requieren una versión de protocolo nueva o compatibilidad explícita. Añadir pruebas de contrato para cada integración y endpoint sensible.
