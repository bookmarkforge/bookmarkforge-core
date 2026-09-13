# BookmarkForge

Aplicación local-first de conocimiento personal, con almacenamiento cifrado, funcionamiento offline, sincronización P2P opcional y servicios de IA con proxy server-side.

## Estado del proyecto

<!-- ADR-019: reemplazar OWNER por el owner real de GitHub (no hay remote
     configurado en el checkout). El badge de CI (ci.yml) refleja cada push;
     el del nightly (nightly.yml) las caídas de las suites
     human-like/multiuser/performance. El enlace de runs fallidos filtra por
     conclusion=failure; el de release apunta al último release publicado.
     Cobertura: el badge de codecov es el servicio externo (se activa con el
     secret CODECOV_TOKEN en el nightly); el enlace 'cobertura del nightly'
     apunta a los artifacts del último run exitoso y funciona sin servicio
     externo. -->

[![CI](https://github.com/OWNER/bookmarkforge/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/bookmarkforge/actions/workflows/ci.yml) · [![Nightly validation](https://github.com/OWNER/bookmarkforge/actions/workflows/nightly.yml/badge.svg)](https://github.com/OWNER/bookmarkforge/actions/workflows/nightly.yml) · [![Cobertura](https://codecov.io/gh/OWNER/bookmarkforge/branch/main/graph/badge.svg)](https://codecov.io/gh/OWNER/bookmarkforge) · [runs fallidos](https://github.com/OWNER/bookmarkforge/actions/workflows/nightly.yml?query=conclusion%3Afailure) · [último release](https://github.com/OWNER/bookmarkforge/releases/latest) · [cobertura del nightly](https://github.com/OWNER/bookmarkforge/actions/workflows/nightly.yml?query=conclusion%3Asuccess) · [operación del nightly](docs/ops-nightly.md)

## Requisitos

- Node.js `>=20.19.0`
- npm
- Docker Compose para los entornos containerizados

## Desarrollo local

```bash
npm ci
cp .env.example .env
npm run typecheck
npm run lint
npm run test:fast
npm run dev
```

El frontend se ejecuta con Vite. El servidor auxiliar se inicia con `npm run server` y expone señalización WebSocket, healthcheck, proxy de IA, licencias y eventos operativos.

## Verificación antes de fusionar

```bash
npm run typecheck
npm run lint
npm run test
npm run build:ci
npm run check
```

No se deben introducir secretos reales en el repositorio. Usa un gestor de secretos o variables de entorno fuera del control de versiones. El chequeo `scripts/check-secrets-in-commit.mjs` debe ejecutarse como gate de CI.

## Arquitectura

```text
Browser / PWA / Extension
          |
          | HTTPS/WSS
          v
Reverse proxy (TLS, CSP, static assets)
          |
          +--> Web frontend (React/Vite)
          |
          +--> Companion server (Node/ws)
                  +--> AI proxy y sesiones CSRF
                  +--> licencias y eventos
                  +--> señalización WebSocket
                  +--> Redis opcional para estado compartido

Cliente: React + TypeScript + RxDB/IndexedDB + Web Workers + WebRTC
Criptografía: AES-GCM, Argon2id/HKDF, claves gestionadas en workers
```

El cliente es la fuente principal de los datos del vault. El servidor no debe recibir contenido del vault salvo que una funcionalidad concreta lo documente y el usuario lo autorice.

## Producción

La topología de producción está en `docker-compose.prod.yml`. Requiere configurar secretos y endpoints mediante el entorno de despliegue. El despliegue debe usar imágenes identificadas por SHA, ejecutar todos los gates y conservar un procedimiento probado de rollback.

```bash
npm run check:env
npm run check:secrets-in-commit
npm run build:ci
npm run production-smoke
```

No ejecutes scripts de despliegue contra producción sin aprobación operativa explícita.

## Seguridad y privacidad

- TLS debe terminar en el reverse proxy con redirección HTTPS y HSTS.
- Configura `AI_SESSION_ORIGINS` con orígenes exactos; no dependas del fallback derivado de `Host`.
- Deja `AI_SESSION_REQUIRE_LICENSE` sin definir (o en `1`): una sesión de IA exige un proof de licencia firmado en TODOS los entornos. `AI_SESSION_REQUIRE_LICENSE=0` emite sesiones anónimas — se rechaza en producción y solo vale para test/staging aislado, con aviso en el arranque.
- La clave pública de licencias vive en dos copias (`src/services/licenseKeys.ts` y `server/src/license-public-key.ts`, la imagen de la API solo copia `server/`). `node scripts/generate-license-keys.mjs --sync-server-key` las alinea y `npm run check:license-keys` falla si divergen.
- Mantén `ENFORCE_SIGNAL_HMAC=1` en producción.
- No publiques Redis ni expongas sus puertos al host.
- No registres contraseñas, claves, prompts ni contenido del vault.
- Los backups automáticos son cifrados; la restauración debe probarse periódicamente.

El cifrado y las medidas técnicas no constituyen por sí solos una declaración de cumplimiento RGPD. El responsable debe mantener inventario de tratamientos, retención, derechos, proveedores y base jurídica.

## Operación mínima

- `/health` es un endpoint de liveness sin datos sensibles.
- Configura `SIGNALING_ADMIN_TOKEN` y `CSP_REPORT_ADMIN_TOKEN` únicamente en el gestor de secretos.
- Revisa eventos estructurados, errores críticos, saturación, conexiones, latencia y fallos del proxy de IA.
- Define y registra RPO/RTO antes del lanzamiento público.
- Ejecuta un restore de backup al menos mensualmente y un simulacro de desastre trimestral.

## Documentación adicional

- [Arquitectura](docs/architecture.md)
- [Seguridad](docs/security.md)
- [Operaciones](docs/operations.md)
- [API](docs/api.md)
- [Especificación OpenAPI](docs/openapi.yaml)
- [Auditoría](docs/audit.md)
- [ROPA (RGPD)](docs/ROPA.md)
- [Checklist de lanzamiento](docs/launch-checklist.md)
