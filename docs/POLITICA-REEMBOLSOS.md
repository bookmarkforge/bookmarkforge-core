# Política de Reembolsos — BookmarkForge Pro

> Esta política cubre el flujo de reembolsos para licencias Pro compradas a través de Whop.
> Whop gestiona el procesamiento del reembolso; BookmarkForge maneja la revocación de la licencia.

---

## Resumen

BookmarkForge utiliza Whop como procesador de pagos. Los reembolsos son gestionados por Whop. Tu responsabilidad como operador es:

1. Verificar que el reembolso fue procesado por Whop
2. Revocar la licencia Pro correspondiente
3. Asegurarse de que el usuario vuelve a Free
4. Registrar la transacción

## Política de reembolsos (lo que le comunicas al usuario)

### Reembolsos aceptados

Los reembolsos se procesan a través de Whop. Los usuarios deben solicitarlos en:
- https://whop.com/orders → Seleccionar pedido → Solicitar reembolso

**Criterios típicos de aceptación:**
- El producto no fue utilizado (o fue utilizado menos de 24h)
- Problemas técnicos que impiden el uso del producto
- Compra accidental

**Criterios típicos de rechazo:**
- El producto fue utilizado extensivamente (>7 días)
- El usuario ya recibió un reembolso anterior para la misma licencia
- La licencia fue revocada por abuso

### Tiempos

| Paso | Tiempo estimado |
|------|----------------|
| Solicitud del usuario en Whop | Inmediato |
| Procesamiento por Whop | 3-7 días hábiles |
| Revocación de licencia | <1 hora después de confirmar reembolso |
| Usuario vuelve a Free | Inmediato tras revocación |

## Flujo operativo (para el operador)

### Paso 1: Recibir solicitud de reembolso

El usuario solicita reembolso a través de Whop o contacta al soporte de BookmarkForge.

Si contacta a soporte:
1. Solicita el **Order ID** de Whop
2. Verifica el estado del pedido en Whop (dashboard o API)
3. Si el pedido no existe → informar al usuario

### Paso 2: Verificar estado del reembolso

**Opción A: El usuario ya procesó en Whop**
```
Verificar en Whop Dashboard:
- Pedido → Estado: "Refunded" o "Partially Refunded"
```

**Opción B: El usuario necesita ayuda**
- Guiar al usuario a https://whop.com/orders
- El usuario debe iniciar el proceso allí

### Paso 3: Revocar la licencia

Una vez confirmado el reembolso en Whop:

```bash
# En el servidor:
POST /api/license/deactivate
Body: { license_key: "...", instance_name: "deviceId" }
```

Verificar:
- La respuesta es `{ ok: true }`
- La licencia fue revocada exitosamente

### Paso 4: Verificar reversión a Free

1. Solicitar al usuario que verifique en Settings → Pro
2. El plan debe mostrar "Free" o "Free Plan"
3. Las funciones Pro deben estar bloqueadas

Si no vuelve a Free:
- Verificar que `WHOP_API_KEY` está configurado en el servidor
- Verificar que la respuesta de Whop refleja el reembolso
- Documentar como caso de escalación

### Paso 5: Registrar

En `support-refunds-log.md`:
```
Fecha: YYYY-MM-DD
Ticket: TICKET-XXXX
Order: ORDER-XXXX
Motivo: desistimiento / técnico / otro
Importe: $59.00 USD
Licencia revocada: sí/no
Operador: [tu nombre]
```

En `support-chargebacks-log.md`:
- Si el usuario contacta a su banco para disputar el cargo (chargeback) en lugar de pedir reembolso directamente a Whop, registrar aquí

## Escenarios especiales

### Escenario: El usuario pide reembolso pero la licencia sigue activa

**Causa**: Whop procesó el reembolso pero el servidor no recibió la notificación.

**Solución**:
1. Verificar en el servidor que el usuario sigue con plan "pro"
2. Ejecutar manualmente la revocación: `POST /api/license/deactivate`
3. Confirmar que vuelve a Free

### Escenario: El usuario solicita chargeback (disputa bancaria)

**Causa**: El usuario contactó a su banco en lugar de Whop.

**Acción**:
1. Registrar en `support-chargebacks-log.md`
2. Contactar a Whop para notificar
3. No revocar la licencia hasta que Whop confirme
4. El usuario probablemente no recibirá reembolso (chargebacks son más difíciles)
5. Documentar como referencia para futuros casos

### Escenario: El usuario tiene un bug que impide usar Pro

**Acción**:
1. Evaluar si el bug es crítico (impide uso completo de Pro)
2. Si es crítico → procesar reembolso sin penalización
3. Si es menor → informar al usuario y dar plazo para resolver
4. Documentar en `support-data-loss-runbook.md` si aplica

### Escenario: Reembolso pero el usuario tiene datos en el vault

**Acción**:
- Los datos del vault NO se ven afectados por reembolsos
- El usuario mantiene todos sus datos locales
- La licencia revierte a Free pero los datos persisten
- Informar al usuario: "Tus datos están seguros. Solo pierdes acceso a funciones Pro."

## No-hacer lista

- ❌ NUNCA proceses un reembolso manualmente sin confirmar en Whop
- ❌ NUNCA revoques una licencia sin confirmar el reembolso
- ❌ NUNCA devuelvas datos del vault al usuario como compensación (son su responsabilidad)
- ❌ NUNCA hables de detalles internos del servidor con el usuario
- ❌ NUNCA aceptes reembolso fuera de Whop (no envíes dinero por PayPal, transferencia, etc.)
- ❌ NUNCA ignores un chargeback — siempre respóndelo

## Métricas

Lleva registro mensual:
- Total de reembolsos solicitados
- Total procesados
- Tiempo promedio de procesamiento
- Razón principal de reembolsos
- Tasa de chargebacks vs reembolsos
- Satisfacción post-reembolso (si aplica)

**Meta**: Menos del 2% de reembolsos sobre ventas totales.

## Contacto Whop para soporte

- Soporte Whop: https://whop.com/support
- Whop status: https://status.whop.com
- Para disputas complejas: contacta a Whop directamente
