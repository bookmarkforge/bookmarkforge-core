# Checklist de licencia en producción

## Preparación técnica

- [ ] `LICENSE_SIGNING_PRIVATE_KEY_FILE` existe únicamente en el gestor de secretos.
- [ ] `WHOP_LICENSE_API_URL` apunta al adaptador aprobado y usa HTTPS.
- [ ] `WHOP_API_KEY` está configurada en el entorno, nunca en `VITE_*`.
- [ ] La clave pública de verificación y el formato de entitlement están versionados.
- [ ] Activación, renovación, clave inválida, revocación y reloj incorrecto tienen pruebas.

## Operación y cobros

- [ ] Merchant Agreement y política de reembolso archivados fuera del repositorio público.
- [ ] Compra real de prueba y reembolso registrados sin datos del vault.
- [ ] Canal de soporte y procedimiento de chargeback definidos.
- [ ] Logs de activación redactados y con retención limitada.

## Release

Ejecutar `npm run check:security-internal`, `npm run check:launch-checklist:strict`, `npm run build:ci` y los smoke de licencia. Las casillas externas solo se marcan tras verificarlas en el proveedor.
