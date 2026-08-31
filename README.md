# BookmarkForge

Aplicación local-first de conocimiento personal, con almacenamiento cifrado, funcionamiento offline, sincronización P2P opcional y servicios de IA con proxy server-side.

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
- Mantén `AI_SESSION_REQUIRE_LICENSE=1` en producción.
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
