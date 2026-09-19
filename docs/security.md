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

### Procedimiento de violación de datos personales (RGPD)

Toda violación de datos personales se gestiona con las plantillas de `legal/plantillas/` y la checklist `legal/plantillas/checklist-violacion-seguridad.md`. Cada incidente abre un identificador `BMF-INC-[AAAA]-[NNN]` y se anota únicamente su referencia en `legal/REGISTRO.md`, nunca datos personales completos.

**Reloj de 72 horas (art. 33).** La notificación a la autoridad de control (AEPD u otra competente) se hace sin dilación indebida y, cuando sea posible, dentro de las 72 horas desde que el responsable tuvo conocimiento razonable; los retrasos se documentan con su motivo. La plantilla operativa es `legal/plantillas/notificacion-art-33-autoridad.md`: control del plazo, responsable del tratamiento, naturaleza de la violación, categorías y volumen aproximado de datos, consecuencias probables y medidas adoptadas.

**Comunicación a interesados (art. 34).** Cuando la violación sea probable que entrañe un alto riesgo, se comunica a los afectados en lenguaje claro con `legal/plantillas/notificacion-art-34-interesados.md`: qué ocurrió, qué datos pueden estar afectados, qué significa para el usuario, medidas adoptadas y recomendaciones. Si la comunicación individual no es posible, se usa una medida pública equivalente. Nunca se incluyen secretos, credenciales ni detalles que faciliten un ataque en curso.

**Bóveda y credenciales.** Las plantillas exigen diferenciar entre datos locales, cifrados y metadatos, y solo afirmar que la bóveda no estuvo afectada si la investigación técnica lo confirma. BookmarkForge no solicita por email, chat ni teléfono la contraseña del vault, la clave de licencia ni la frase de recuperación.

**Evidencia y cierre.** Preservar logs, configuraciones, mensajes del proveedor y hashes sin datos de usuario; guardar copia final, acuses y fecha de envío en el repositorio cifrado; completar causa raíz, medidas correctoras y revisión de DPAs del proveedor implicado.
