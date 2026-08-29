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
```

El despliegue de producción debe ser aprobado, usar imágenes identificadas por SHA y conservar el artefacto y los resultados de los gates.

## Health y observabilidad

- `GET /health` es liveness y no expone contadores ni identificadores operativos.
- `SIGNALING_ADMIN_TOKEN` protege diagnósticos del servidor de señalización.
- `CSP_REPORT_ADMIN_TOKEN` protege informes CSP.
- Los eventos de cliente se almacenan de forma acotada y pueden generar alertas mediante webhook HTTPS.
- Los logs deben ser estructurados y no contener secretos, contraseñas, prompts ni documentos.
- Correlacionar frontend, API, IA y señalización mediante un identificador de trazabilidad sin PII.

Definir antes de producción:

- disponibilidad objetivo,
- latencia p95,
- tasa máxima de errores,
- umbral de saturación,
- RPO,
- RTO,
- responsables de guardia,
- canal y severidad de alertas.

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
