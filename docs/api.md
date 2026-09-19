# API del servidor companion

BookmarkForge expone un servidor companion para señalización P2P, salud, licencias, eventos de cliente, analytics y diagnósticos administrativos.

El contrato normativo está en [`docs/openapi.yaml`](./openapi.yaml). Los endpoints protegidos aplican validación de origen, rate limiting, límites de cuerpo y tokens administrativos cuando corresponde.

## Endpoints principales

- `GET /health`: healthcheck mínimo.
- `POST /api/license/activate`: activación de licencia.
- `POST /api/license/validate`: validación de licencia.
- `POST /api/license/entitlement`: resolución server-authoritative del plan.
- `POST /api/client-events`: eventos técnicos redactados.
- `POST /api/analytics/events`: analytics agregados y opt-in.
- `GET /admin`: diagnósticos de señalización, protegido por token.

El servidor no recibe el contenido del vault ni actúa como proxy general de proveedores AI.
