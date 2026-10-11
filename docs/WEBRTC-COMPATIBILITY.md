# Compatibilidad WebRTC y sincronización P2P

## Matriz mínima

| Entorno | Señalización | Cámara/QR | DataChannel | Estado |
|---|---|---|---|---|
| Chrome escritorio | local / staging | pendiente | pendiente | por certificar |
| Firefox escritorio | local / staging | pendiente | pendiente | por certificar |
| Safari iOS | local / staging | pendiente | pendiente | por certificar |
| Chrome Android | local / staging | pendiente | pendiente | por certificar |

La automatización ejecutable es `npm run e2e:sync`. Registrar navegador, versión, sistema, red, room, latencia, reconexión, conflicto LWW y resultado. No considerar una prueba localhost como certificación de producción.
