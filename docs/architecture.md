# Arquitectura

## Modelo Open Core

El repositorio privado combina un Core MIT con componentes Pro propietarios.
La separación de distribución no se basa únicamente en carpetas: el
exportador mantiene una lista explícita de archivos Pro y el gate
`check:open-core` comprueba el resultado materializado. El Core incluye vault,
CRUD, notas, importación/exportación básica, búsqueda, seguridad e interfaz.
Pro incluye IA avanzada, RAG, agentes, sincronización P2P, flashcards, PDF/OCR,
exportaciones avanzadas y backups avanzados. La clasificación normativa vive
en `OPEN-CORE.md` y `scripts/export-public-repo.mjs`.

## Componentes

- **Frontend:** React + TypeScript + Vite. Las rutas y funcionalidades pesadas se cargan de forma diferida.
- **Persistencia local:** RxDB sobre IndexedDB. Los esquemas viven en `src/db`.
- **Criptografía:** `EncryptionService` delega en `crypto.worker.ts`; el formato actual usa AES-GCM con derivación Argon2id/HKDF.
- **Servicios de dominio:** `src/services` encapsula backup, recuperación, sincronización, licencias, IA y sanitización.
- **Companion server:** `server/src` implementa HTTP mínimo, licencias/entitlement, eventos de cliente, analítica agregada, healthcheck y señalización WebSocket. **No hay proxy de IA**: las llamadas salen del navegador directamente al proveedor que el usuario configuró.
- **Sincronización:** WebRTC transporta los datos entre clientes; WebSocket sólo realiza señalización. TURN es opcional y usa credenciales efímeras.
- **Operación:** Docker Compose separa `web` y `api`, ambos stateless. El reverse proxy termina TLS y sirve los assets.

## Límites de confianza

1. El navegador contiene el vault desbloqueado sólo mientras la sesión lo necesita.
2. El servidor de señalización no debe considerarse confiable para la confidencialidad del vault.
3. Las credenciales de proveedores de IA viven cifradas en el vault del usuario y se usan desde el navegador. El servidor no las recibe, no las almacena y no las necesita; la clave de firma de licencias es la única credencial del servidor y vive en un gestor de secretos.
4. El servidor no mantiene estado compartido entre instancias: no hay Redis, base de datos ni caché de sesiones.
5. Las integraciones cloud se consideran terceros y requieren consentimiento, scopes mínimos y manejo de revocación.

## Escalabilidad

El servidor tiene límites de conexiones, rooms, peers, payloads y rate limits. Los endpoints HTTP son stateless y escalan en horizontal sólo con un balanceador. La **señalización WebSocket no**: el estado de rooms y peers vive en memoria del proceso, así que escalarla requiere un adaptador compartido o enrutamiento por afinidad (sin uno de los dos, las rooms se dividen entre réplicas y las señales dejan de entregarse).

Para crecer hace falta además:

- Balanceador con soporte WebSocket y política de afinidad.
- Métricas de conexiones, rooms, memoria, latencia y errores.
- Pruebas de carga antes de aumentar límites.

La capacidad del cliente está limitada por memoria IndexedDB, coste de indexación, tamaño del vault y potencia del dispositivo. No se debe prometer capacidad ilimitada.

## Decisiones registradas (baseline 2026-08-31)

- **Retirada del proxy de IA (2026-09):** el servidor ya no proxya llamadas a proveedores de IA. La clave del usuario vive cifrada en su vault y las llamadas salen del navegador directamente, así que el servidor dejó de necesitar `GEMINI_API_KEY`, la sesión CSRF de IA, los cupos por identidad, el circuit breaker y el Redis que compartía ese estado entre réplicas. Se eliminaron también del compose, de los validadores y de `openapi.yaml`; `check:compose-config` y `check:runtime-config` ahora fallan si reaparece configuración de IA sin lector.
- **SLO/RPO/RTO:** valores de referencia registrados en `docs/operations.md` → "SLOs y objetivos" (disponibilidad 99,9 %/30 días, p95 señalización < 500 ms, 5xx < 0,5 %, saturación WS < 70 %; **RPO 24 h**, **RTO 24 h** vault / **4 h** topología). Pendiente solo la confirmación oficial del responsable y su revisión trimestral (punto 3 del launch-checklist).
- **Contratos versionados:** `docs/openapi.yaml` (OpenAPI 3.1.0) cubre los endpoints HTTP del companion server; el contrato con el proveedor de licencias (Whop) queda documentado como deuda P2.
- **Prueba de carga del companion server:** implementada y validada (`scripts/load-test-server.mjs`, `npm run test:load`) con presupuestos de señalización (join/relay/saturación) alineados a los SLO; el cron nocturno la ejecuta con 50 conexiones. Ya no mide el proxy de IA: el servidor no proxya proveedores y su mock de upstream se retiró con él (2026-09).
- **Analítica de negocio opt-in:** `server/src/business-analytics.ts` + `src/services/analyticsForwarder.ts` (ver `docs/audit.md` §5 y ROPA §3 T8).

## Decisiones pendientes

- Persistencia central multiusuario si el producto deja de ser exclusivamente local-first (mantenido abierto a propósito).
- Política formal de migraciones RxDB (mantenido abierto a propósito).
- Confirmación oficial (firma del responsable) de SLO/RPO/RTO y simulacro de desastre trimestral ejecutado.
