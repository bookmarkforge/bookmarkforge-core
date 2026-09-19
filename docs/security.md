# Seguridad de producción

## Configuración obligatoria

La API companion se ejecuta con:

```text
NODE_ENV=production
AI_SESSION_ORIGINS=https://<dominio-publico>
ENFORCE_SIGNAL_HMAC=1
LICENSE_SIGNING_PRIVATE_KEY_FILE=/run/secrets/license_signing_key
WHOP_LICENSE_API_URL=https://<adaptador-verificado>
WHOP_API_KEY=<secreto-del-gestor-de-secretos>
```

`TRUST_PROXY=1` solo se permite detrás de un reverse proxy administrado que sobrescriba `X-Forwarded-For`. `WS_ALLOWED_ORIGINS` debe configurarse con los orígenes públicos autorizados. Los secretos no se almacenan en el repositorio ni en variables `VITE_*`.

## Controles

- CSP, HSTS, COEP, COOP, `nosniff` y `frame-ancestors` se validan mediante los gates HTTP/CSP.
- Las imágenes Docker se fijan por digest y el servidor web se ejecuta sin root.
- Los endpoints administrativos requieren token y están deshabilitados si no hay token configurado.
- Los endpoints sensibles aplican validación de origen, límites de cuerpo y rate limiting.
- La señalización P2P usa room secrets, HMAC y límites de conexiones, rooms y payloads.
- Los eventos y errores deben estar redactados; nunca registrar passwords, claves ni contenido del vault.

## Validación previa al despliegue

Ejecutar `npm run check:security-internal`, `npm audit --omit=dev --audit-level=high`, `npm run check:runtime-config`, `npm run check:http-config`, `npm run check:compose-config` y el smoke de producción. Cualquier fallo de configuración bloquea el release.

## Incidentes de seguridad

Contener el servicio, rotar las credenciales afectadas, preservar evidencia sin datos de usuario, invalidar imágenes comprometidas y documentar la causa raíz. No solicitar nunca passwords ni frases de recuperación a usuarios.
