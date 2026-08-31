# Operaciones

## Preflight de release

Ejecutar en CI y antes de una release:

```bash
npm ci
npm run typecheck:prod
npm run lint
npm run test
npm run build:ci
npm run check
npm run check:secrets-in-commit
npm run check:launch-checklist:strict  # falla si algún 🔴 bloqueante está sin completar
```

El despliegue de producción debe ser aprobado, usar imágenes identificadas por SHA y conservar el artefacto y los resultados de los gates. El `check:launch-checklist:strict` se ejecuta además automáticamente: cada noche en `nightly.yml` (job `launch-readiness`) y como Punto 10 del gate pre-deploy `check-blindeo.mjs` (bloquea despliegues a producción con bloqueantes abiertos).

## Health y observabilidad

- `GET /health` es liveness y no expone contadores ni identificadores operativos.
- `SIGNALING_ADMIN_TOKEN` protege diagnósticos del servidor de señalización.
- `CSP_REPORT_ADMIN_TOKEN` protege informes CSP.
- Los eventos de cliente se almacenan de forma acotada y pueden generar alertas mediante webhook HTTPS.
- Los logs deben ser estructurados y no contener secretos, contraseñas, prompts ni documentos.
- Correlacionar frontend, API, IA y señalización mediante un identificador de trazabilidad sin PII.

## SLOs y objetivos (baseline pre-lanzamiento)

Valores de referencia definidos; revisar trimestralmente o al alcanzar 5× el tráfico actual.

| Métrica | Objetivo | Ventana | Medición |
|---|---|---|---|
| Disponibilidad de api + web | 99.9% | 30 días | healthchecks + uptime probe |
| Latencia p95 del proxy de IA | < 3 s | 28 días | `GET /api/services/ai/metrics` |
| Latencia p95 de señalización (join) | < 500 ms | 28 días | logs de señalización |
| Tasa de errores 5xx | < 0.5% | 5 minutos | logs estructurados |
| Saturación de conexiones WS | < 70% del límite | 5 minutos | diagnósticos admin |
| Error-spike de clientes críticos | 0 eventos | 10 minutos | collector `/api/client-events` |

**RPO:** 24 h — el cliente genera backups automáticos cifrados diarios (cliente + copia
local). El servidor no aloja datos del vault; el RPO de estado operativo (Redis) es
inmaterial y no se usa como backup del vault.

**RTO:** 24 h para restauración completa de un vault; 4 h para recuperar la topología
servidor (imágenes por SHA) + Redis si procede.

Guardia: responsables y canal de alertas deben registrarse antes del lanzamiento
público; severidades según la plantilla de incidentes.

## Simulacro de restauración (drill mensual)

El drill automatiza el procedimiento mensual completo (crear backup de una
instalación de referencia → restaurar en perfil limpio → comparar conteos y
hashes):

```bash
npm run drill:backup-restore
```

Ejecuta `tests/e2e/drill-backup-restore.spec.ts` contra el stack de staging:

1. **BASELINE** — vault con 3 bookmarks + 1 documento sembrados; conteo y hashes.
2. **EXPORT** — fase A: `.bmf` cifrado real vía UI; fase B: JSON en claro.
3. **DISASTER** — IndexedDB borrada + reload; el vault queda bloqueado, nunca
   se crea un vault vacío silencioso.
4. **RESTORE** — importación desde el archivo; tiempo del camino medido y gateado
   (RTO de referencia < 120 s).
5. **VERIFY** — conteos y títulos idénticos a la línea base.

El script reporta una tabla PASS/FAIL por fase y sale 0/1 (CI-ready). Programa
la ejecución mensual (cron) y regístrala en el checklist operativo.

## Prueba de carga del companion server

`npm run test:load` arranca un servidor aislado (límites propios + mock upstream
de IA) y valida los presupuestos de los SLO de esta sección:

- **Señalización:** p95 join < 500 ms y p95 relay en sala < 500 ms con carga
  concurrente; saturación: rechazo 1013 por encima de `MAX_CONNECTIONS` y
  `/health` 200 tras la ráfaga.
- **Proxy IA:** p95 de `/api/services/ai/generate` < 3 s contra el mock
  (latencia simulada configurable), tasa de éxito ≥ 99 % y cero 5xx del proxy.

Los límites anti-abuso se elevan a propósito (se mide capacidad, no throttling);
ese aspecto lo cubren los tests unitarios del servidor. Salida 0/1 (CI-ready),
con `--json` para consumo por pipelines. Presupuestos en `BUDGETS` al inicio
[del script](../scripts/load-test-server.mjs). Ejecutar trimestralmente y
registrar el resultado; primer run contra staging queda pendiente.

## Backups

El cliente dispone de backups automáticos cifrados en almacenamiento local y copia de disco cuando el navegador lo permite. El backup manual debe ser cifrado salvo decisión explícita del usuario.

Procedimiento mínimo mensual:

1. Crear backup cifrado de una instalación de referencia.
2. Verificar tamaño, formato y metadatos.
3. Restaurar en un perfil limpio de staging.
4. Comparar conteo y hashes de documentos no sensibles.
5. Registrar duración, resultado y versión.

No guardar contraseñas junto con backups. Las claves y los datos deben tener ciclos de vida y controles de acceso separados.

## Recuperación ante desastre

1. Declarar incidente y congelar despliegues.
2. Confirmar alcance y última copia válida.
3. Restaurar infraestructura desde imágenes por SHA.
4. Restaurar Redis sólo si contiene estado necesario; no usarlo como backup del vault.
5. Ejecutar smoke tests y healthchecks.
6. Verificar autenticación, licencias, IA y señalización.
7. Comunicar estado y documentar causa raíz.
8. Ejecutar postmortem y actualizar runbooks.

## Rollback

El rollback debe apuntar a una imagen previamente validada, no reconstruir desde `latest`. No debe borrar IndexedDB ni datos locales del usuario. Probar el procedimiento en staging antes de habilitarlo para producción.

## Rotación

Rotar inmediatamente cualquier secreto expuesto y, como mínimo, de forma periódica:

- claves de IA,
- API keys de licencias,
- tokens administrativos,
- claves TURN,
- claves de firma.
