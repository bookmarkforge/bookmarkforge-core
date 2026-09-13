# Runbook de soporte — pérdida de datos

Objetivo: responder tickets de "perdí mis datos / olvidé la contraseña" en <10 min con el
camino correcto. Este runbook no requiere acceso al vault (zero-knowledge por diseño).

## Regla de oro antes de responder

Preguntar SIEMPRE primero:

1. ¿Tienes tu **frase de recuperación** (24 palabras que anotaste al crear el vault)?
2. ¿Tienes un **archivo `.bmf`** (kit de recuperación o backup exportado)?
3. ¿Dónde guardaste esas copias? (¿mismo dispositivo o fuera — nube/USB/email?)

Nunca responder "los datos se han perdido" antes de agotar los 3 caminos.

## Camino 1 — Tiene la frase de recuperación (caso más común)

- En la pantalla de bloqueo: **"Forgot password?"** → pegar las 24 palabras.
- La frase recupera la **contraseña maestra** (no los datos directamente). El vault
  descifra la contraseña guardada y arranca normal.
- Sanitización: mayúsculas, saltos de línea y espacios múltiples se normalizan solos.
- Rate-limit: 10 intentos → lockout 5 min. Si el usuario se bloquea, esperar y reintentar.
- Plantilla (EN): *"Open the app, click 'Forgot password?' and paste your 24-word
  recovery phrase. It restores your master password — your data will appear exactly
  as you left it. Tip: paste it in one block; capitals and line breaks are fine."*

## Camino 2 — Tiene un archivo `.bmf` (backup/kit)

- Pantalla de bloqueo no lo pide: usar **restaurar desde backup** (visible cuando la
  base de datos falla al abrir, o desde Settings → Storage → Export/Import).
- El `.bmf` está cifrado con la **contraseña maestra** (no con la frase). Necesita
  la contraseña para abrirlo.
- Regla práctica:
  - Tiene `.bmf` + contraseña → restauración completa (datos + ajustes).
  - Tiene `.bmf` pero no contraseña → si además tiene la frase, usar Camino 1
    primero para recuperar la contraseña y luego restaurar.
  - Tiene `.bmf` de otro dispositivo → válido igualmente (formato portátil BMF1).
- Si el navegador da error al restaurar: probar en el mismo navegador (perfiles
  distintos no comparten IndexedDB), no mezclar navegadores.

## Camino 3 — No tiene frase ni `.bmf`

- Por diseño (cifrado AES-256-GCM + Argon2id, zero-knowledge): **no existe
  recuperación**. Ni el soporte ni nadie puede descifrar el vault.
- Comunicarlo con claridad y empatía; es el mismo aviso que el usuario aceptó al
  crear el vault ("I have safely saved the recovery phrase").
- Ofrecer limpieza: `/?reset=true` destruye el vault y permite empezar de cero.
- Reembolso: según política de 30 días vía Whop. Acreditar sin fricción si el
  usuario lo solicita — retenerlo no recupera la confianza ni evita la review.

## Prevención (lo que ya hace el producto)

- Wizard de creación: descarga del kit obligatoria antes de crear el vault
  (checkbox bloqueante).
- Avisos multi-dispositivo: en el setup ("no lo guardes solo en este dispositivo")
  y en el banner de backup (regla de oro: copia en el mismo dispositivo no es
  backup — nube/USB/email).
- Recordatorio de backup >48h (banner) + auto-backup al desbloquear.
- Toast tras exportar: indica guardar copia fuera del dispositivo.

## Política de reembolsos y anti-fraude

El fraude de reembolso existe, pero el modelo lo hace poco rentable:
**reembolso = revocación de licencia**. El defraudador recupera el dinero y
pierde el Pro (cae al tier Free), así que su mentira no compra nada.

### Reglas por caso

- **≤ 30 días:** reembolso sin preguntas + revocación inmediata de la
  licencia. Sin interrogatorio: el fraude a este plazo no da beneficio.
- **> 30 días con alegato de pérdida:** caso a caso. Pedir mínimo de
  evidencia: ID de pedido + captura de la pantalla de bloqueo. La fricción
  mínima disuade al oportunista sin castigar al cliente honesto.
- **Reincidente:** ban del comprador en Whop. Sin segunda oportunidad.

### Chargebacks (el riesgo real)

Un comprador puede disputar el cargo con su banco sin avisar. Evidencia
para la disputa, sin violar la privacidad del vault:

- ID de pedido, fecha e importe (dashboard de Whop).
- Registro de activaciones de licencia del license-server (instanceId,
  timestamps): prueba objetiva de entrega y uso del producto.
- Nota de que el producto es zero-knowledge: el soporte nunca tuvo acceso
  al contenido y no existe mécanismo de recuperación forzada.

### Procedimiento de revocación

1. Procesar el reembolso desde el dashboard de Whop.
2. Marcar la licencia como revocada en el license-server (`status`
   revocado): la validación Pro deja de pasar en la siguiente comprobación
   y el cliente queda en tier Free.
3. Reincidente: ban del comprador en Whop.

Nunca condicionar la amabilidad del trato a la sospecha de fraude: la
estructura (revocación + ban + evidencia) es la defensa, no el trato seco.

## Métrica a vigilar

- Tickets por pérdida de datos / total tickets. Si sube del 20%, revisar si los
  avisos del wizard son suficientemente visibles (posible A/B del texto del kit).
