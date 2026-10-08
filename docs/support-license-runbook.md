# Support Runbook — Licencias

> Operado por una sola persona. Cada resolución debe ser reproducible sin acceder a datos locales del usuario.

## Principio fundamental

**Nunca solicites ni accedas a:** contraseña, frase de recuperación, contraseñas del vault, contenido del vault, o datos personales. Nunca.

## Flujo estándar de ticket de licencia

### 1. Recibir ticket

Solo acepta estos datos del usuario:
- **Order ID** (de Whop)
- **Email de compra**
- **instanceId** (del dispositivo)

Rechaza cualquier solicitud de contraseña, frase de recuperación o acceso al vault.

### 2. Verificar licencia

```
POST /api/license/entitlement
Body: { payload, signature }
Respuesta: { plan: "pro" | "free", source, reason }
```

Consulta el estado firmado en el servidor. Verifica:
- ¿La licencia está activa?
- ¿El estado es "active" o "completed"?
- ¿El deviceId coincide?
- ¿Está revocada o expirada?

### 3. Escenarios y resolución

| Escenario | Acción | Estado resultado |
|-----------|--------|-----------------|
| Licencia activa, acceso denegado | Verificar que `LICENSE_SIGNING_PRIVATE_KEY_FILE` existe y la clave pública coincide | Resolver servidor, notificar usuario |
| Clave inválida | Confirmar con Whop si el pedido existe | Si existe → activar. Si no → guiar al usuario |
| Licencia expirada | Verificar fecha de expiración en Whop | Informar al usuario |
| Reembolso procesado | Verificar que Whop confirmó el reembolso | Revocar licencia → usuario vuelve a Free |
| Proveedor sin respuesta | Verificar `WHOP_API_KEY` y `WHOP_LICENSE_API_URL` | Fall-closed: mantener estado actual |
| Error 503 (firma inválida) | Verificar `LICENSE_SIGNING_PRIVATE_KEY_FILE` | No revocar usuarios — es problema del operador |

### 4. Reembolso y chargeback

1. **Antes de anything**: confirma el reembolso en Whop (dashboard o API)
2. **Revoca la licencia**: `POST /api/license/deactivate` con el deviceId
3. **Registra**: fecha, order ID, ticket reference, resultado
4. **Verifica**: el usuario vuelve a Free correctamente
5. **Archiva**: en `support-chargebacks-log.md` y `support-refunds-log.md`

### 5. Registro

Para cada intervención:
```
Fecha: YYYY-MM-DD
Ticket: TICKET-XXXX
Order: ORDER-XXXX
Acción: activar / revocar / verificar
Resultado: éxito / parcial / falló
Licencia revocada: sí/no
```

## Red de contacto

- **Whop soporte**: https://whop.com/support
- **Whop status**: https://status.whop.com
- **GitHub issues**: https://github.com/bookmarkforge/bookmarkforge/issues

## Emergency: servidor caído

Si el servidor de companion no responde:
1. Los clientes con licencia ya validada **mantienen acceso Pro** offline (la verificación es client-side con firma previa)
2. Nuevos intentos de verificación reciben 503 (fail-safe)
3. No revocar a nadie durante una caída del servidor
4. Documentar el incidente y duración

## No-hacer lista (nunca)

- ❌ Nunca pidas la contraseña maestra
- ❌ Nunca accedas al vault del usuario
- ❌ Nunca resetees la vault sin consentimiento explícito
- ❌ Nunca compartas claves privadas o signing keys
- ❌ Nunca generes licencias manualmente sin verificar pago
- ❌ Nunca hables de detalles internos del servidor con el usuario
