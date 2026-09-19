# Operaciones y continuidad

## SLOs

- Disponibilidad objetivo del companion server: **99.9% mensual**.
- Healthcheck `/health`: p95 menor de 500 ms bajo carga normal.
- Señalización WebSocket: p95 de relay menor de 1 s bajo carga normal.

## RPO y RTO

- **RPO:** 24 horas para respaldos operativos configurados; el vault local depende de la exportación del usuario.
- **RTO:** 2 horas para restaurar el companion server y su configuración desde imágenes y secretos respaldados.
- Los datos primarios del vault permanecen localmente en el dispositivo del usuario; el servidor no almacena contenido del vault.

## Backups y restauración

Los drills de backup/restore se ejecutan con `npm run drill:backup-restore`. Cada ejecución debe conservar evidencia de duración, resultado y cualquier desviación del RTO. Las claves de licencia y secretos de despliegue se restauran desde el gestor de secretos, nunca desde el repositorio.

## Incidentes

1. Confirmar el incidente mediante `/health`, logs y métricas administrativas autenticadas.
2. Contener: limitar tráfico, aislar el servicio afectado o activar rollback.
3. Preservar logs y artefactos sin incluir contenido de vault ni credenciales.
4. Restaurar desde la última imagen verificada y ejecutar smoke checks.
5. Registrar causa raíz, impacto, RPO/RTO observado y acciones preventivas.

## Releases y rollback

Todo release debe pasar typecheck, lint, tests, build, auditorías de seguridad y los checks de configuración. El rollback usa imágenes Docker etiquetadas por commit y no debe modificar datos del usuario.
