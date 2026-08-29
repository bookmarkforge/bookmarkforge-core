# Arquitectura

## Componentes

- **Frontend:** React + TypeScript + Vite. Las rutas y funcionalidades pesadas se cargan de forma diferida.
- **Persistencia local:** RxDB sobre IndexedDB. Los esquemas viven en `src/db`.
- **Criptografía:** `EncryptionService` delega en `crypto.worker.ts`; el formato actual usa AES-GCM con derivación Argon2id/HKDF.
- **Servicios de dominio:** `src/services` encapsula backup, recuperación, sincronización, licencias, IA y sanitización.
- **Companion server:** `server/src` implementa HTTP mínimo, sesiones de IA, proxy, licencias, eventos, healthcheck y señalización WebSocket.
- **Sincronización:** WebRTC transporta los datos entre clientes; WebSocket sólo realiza señalización. TURN es opcional y usa credenciales efímeras.
- **Operación:** Docker Compose separa web, API y Redis opcional. El reverse proxy termina TLS y sirve los assets.

## Límites de confianza

1. El navegador contiene el vault desbloqueado sólo mientras la sesión lo necesita.
2. El servidor de señalización no debe considerarse confiable para la confidencialidad del vault.
3. Las credenciales de proveedores deben permanecer en el servidor o en un gestor de secretos.
4. Redis sólo contiene estado operativo; nunca debe recibir contenido del vault.
5. Las integraciones cloud se consideran terceros y requieren consentimiento, scopes mínimos y manejo de revocación.

## Escalabilidad

El servidor tiene límites de conexiones, rooms, peers, payloads y rate limits. Para escalar horizontalmente se requiere:

- Redis compartido para el estado que deba sobrevivir entre instancias.
- Balanceador con soporte WebSocket y política de afinidad cuando sea necesaria.
- Métricas de conexiones, rooms, memoria, latencia y errores.
- Pruebas de carga antes de aumentar límites.

La capacidad del cliente está limitada por memoria IndexedDB, coste de indexación, tamaño del vault y potencia del dispositivo. No se debe prometer capacidad ilimitada.

## Decisiones pendientes

- Persistencia central multiusuario si el producto deja de ser exclusivamente local-first.
- Objetivos SLO/RPO/RTO.
- Contratos versionados para integraciones externas.
- Política formal de migraciones RxDB.
