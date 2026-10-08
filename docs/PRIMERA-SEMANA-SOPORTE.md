# Plan de Soporte — Primera Semana de Lanzamiento

> Para operador único. Este plan te ayuda a gestionar la carga inicial de soporte sin quemarte.

---

## 📅 Día por Día

### Día 1 (Lanzamiento)

**Expectativa**: Muy alta carga inicial. Pueden llegar 20-50 mensajes en el primer día.

**Tu checklist**:
- [ ] Monitorear GitHub Issues (pestaña "Issues")
- [ ] Monitorear reviews de la tienda (Chrome + Firefox)
- [ ] Monitorear Whop (dashboard de pedidos)
- [ ] Responder a TODO en <24h
- [ ] Documentar cada ticket en los logs

**Prioridad**:
1. 🔴 Compras que no se activan (licencia)
2. 🔴 Extensión que no funciona
3. 🟡 Preguntas generales
4. 🟢 Feature requests

**Templates listos para copiar/pegar**:
- ✅ FAQ → `docs/FAQ-SOPORTE.md`
- ✅ Runbook → `docs/support-license-runbook.md`
- ✅ Reembolsos → `docs/POLITICA-REEMBOLSOS.md`

---

### Días 2-3

**Expectativa**: Menos carga que el Día 1, pero preguntas repetitivas empiezan a aparecer.

**Acciones**:
- [ ] Actualizar FAQ con las preguntas más frecuentes del Día 1
- [ ] Escribir plantillas de respuesta para las preguntas repetitivas
- [ ] Verificar que el servidor sigue funcionando
- [ ] Revisar logs del servidor
- [ ] Verificar que Whop sigue procesando correctamente

**Métricas**:
- Tickets recibidos: ¿cuántos?
- Tiempo promedio de respuesta
- Tiempo promedio de resolución
- Categoría más común

---

### Días 4-5

**Expectativa**: Carga estabilizándose. Primeras reseñas en la tienda.

**Acciones**:
- [ ] Responder a TODAS las reseñas (positivas y negativas)
- [ ] Si hay reseñas negativas:
  - Responder cortésmente
  - Preguntar el Order ID
  - Intentar resolver
- [ ] Verificar que el reembolso funciona
- [ ] Revisar el `support-chargebacks-log.md` y `support-refunds-log.md`
- [ ] Actualizar FAQ con nuevas preguntas

---

### Días 6-7

**Expectativa**: La semana inicial se estabiliza. Evaluar métricas.

**Acciones**:
- [ ] Resumen semanal de tickets
- [ ] Resumen de reseñas
- [ ] Revisar métricas de instalación y uso
- [ ] Planificar la siguiente semana
- [ ] Verificar que los procesos funcionan bien

---

## 🎯 Templates de Respuesta Rápida

### Para ventas/preguntas generales
```
¡Gracias por tu interés en BookmarkForge!

Para comprar: https://whop.com/bookmarkforge
Para ayuda: incluye tu Order ID en el ticket.

Todos los datos están encriptados y locales. 
Nunca te pedimos contraseña ni frase de recuperación.

Tiempo de respuesta: <24h
```

### Para problemas técnicos
```
Gracias por reportar esto. Para ayudarte mejor:

1. ¿Qué navegador y versión usas?
2. ¿Pasó desde que actualizaste algo?
3. ¿Puedes compartir un screenshot?

Mientras tanto:
- Limpia la caché del navegador
- Actualiza a la última versión
- Prueba en modo incógnito

Si es un problema de licencia, incluye tu Order ID.

Tiempo de respuesta: <24h
```

### Para reembolsos
```
Entiendo que deseas un reembolso. Para procesarlo:

1. Ve a https://whop.com/orders
2. Solicita el reembolso allí
3. El reembolso toma 3-7 días hábiles
4. Una vez procesado, tu licencia se revoca automáticamente
5. Tus datos del vault NO se ven afectados

Si necesitas ayuda con Whop, puedo escalar.

Tiempo de respuesta: <12h
```

### Para spam/tickets vacíos
```
Hola,

Gracias por contactarnos. Para que podamos ayudarte, por favor incluye:
- Tu Order ID (si compraste)
- El problema específico que tienes
- Qué navegador usas

Sin estos datos no podemos investigar tu caso.

Gracias,
El equipo BookmarkForge
```

---

## 📊 Métricas Semanales (para llevar)

| Métrica | Día 1 | Día 2-3 | Día 4-5 | Día 6-7 |
|---------|-------|---------|---------|---------|
| Tickets recibidos | ? | ? | ? | ? |
| Tiempo promedio respuesta | ? | ? | ? | ? |
| Tiempo promedio resolución | ? | ? | ? | ? |
| Reembolsos procesados | ? | ? | ? | ? |
| Reseñas positivas/negativas | ? | ? | ? | ? |
| Instalaciones (Chrome) | ? | ? | ? | ? |
| Instalaciones (Firefox) | ? | ? | ? | ? |
| Ventas Whop | ? | ? | ? | ? |

---

## 🔴 Escalación

### Cuando escalar (no puedes resolver solo)

| Situación | Escalar a | Tiempo |
|-----------|-----------|--------|
| Bug crítico en el servidor | GitHub Issues + fix inmediato | <24h |
| Whop API no responde | Whop support | <2h |
| Dominio perdido | Registrador + compra nuevo | Inmediato |
| SSL expirado | Let's Encrypt + renew | Inmediato |
| Servidor caído | Reiniciar Docker + verificar | <1h |
| Demasiados tickets para 1 persona | Considerar contratar ayuda | Planificar |

### Escalamiento a Whop

Contactar a Whop para:
- Disputas bancarias (chargebacks) complejas
- Problemas técnicos con la API de Whop
- Cuenta bloqueada o limitada
- Webhooks no entregando

---

## 🧠 Consejos para Operador Único

### Productividad
1. **Responde en lotes**: No contestes ticket por ticket. Responde cada 2h en bloque.
2. **Usa templates**: Cada respuesta debe tomar <5 min con templates.
3. **Documenta todo**: Cada ticket, resolución, y lección aprendida.
4. **Bloquea tiempo**: Dedica bloques de 2h para soporte, luego vuelve al desarrollo.

### Salud mental
1. **No respondas enojado**: Si un ticket te frustra, espera 30 min.
2. **No prometas lo que no puedes**: Si no sabes, di "Investigo y te respondo en <24h".
3. **Distingue urgencia de importancia**: Un bug crítico es urgente; un feature request no.
4. **Descansa**: No trabajes más de 12h seguidas los primeros días.

### Prevención de tickets
1. **FAQ clara**: Cuantas más respuestas estén en la FAQ, menos tickets recibes.
2. **Documentación excelente**: Si un usuario puede resolver solo, no necesitas soporte.
3. **Onboarding claro**: Guía al usuario desde la compra hasta el uso exitoso.
4. **Proactive communication**: Anuncia mantenimiento antes de que los usuarios noten.

---

## 📞 Contactos de Emergencia

| Servicio | Contacto | Tiempo de respuesta |
|----------|----------|---------------------|
| Whop Support | https://whop.com/support | <2h |
| Whop Status | https://status.whop.com | Tiempo real |
| Chrome Web Store | https://support.google.com/chrome_webstore | <24h |
| Firefox AMO | https://support.mozilla.org | <24h |
| GitHub Issues | Tu repo issues | Variable |
| Let's Encrypt | https://letsencrypt.org/docs/ | 1-3 días |

---

> **Recuerda**: Como persona sola, no puedes resolver todo al instante. Estás lanzando un producto excelente — los usuarios lo entenderán. Lo importante es responder, ser honesto, y resolver.
