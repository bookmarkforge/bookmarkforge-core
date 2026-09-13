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

## Plantillas de respuesta (copiar y pegar en Whop)

### Plantilla 1 — Reembolso ≤ 30 días (sin preguntas)

> Hi [name],
>
> I'm sorry BookmarkForge didn't work out for you. I've processed your
> refund for order [ORDER_ID] — it should appear on your statement within
> 5-10 business days, depending on your bank.
>
> Your Pro license has been deactivated, and your account is back on the
> free plan (which stays yours forever — no time limit).
>
> No hard feelings at all, and thanks for giving it a try.
>
> — [tu nombre], BookmarkForge

> Hola [nombre]:
>
> Siento que BookmarkForge no fuera para ti. He procesado tu reembolso del
> pedido [ORDER_ID] — aparecerá en tu extracto en 5-10 días laborables,
> según tu banco.
>
> Tu licencia Pro ha sido desactivada y tu cuenta vuelve al plan gratuito
> (que es tuyo para siempre, sin límite de tiempo).
>
> Sin ningún problema, y gracias por probarlo.
>
> — [tu nombre], BookmarkForge

### Plantilla 2 — Pérdida de datos con reembolso (empático + lección)

> Hi [name],
>
> I'm truly sorry about your data. BookmarkForge is zero-knowledge by
> design: everything is encrypted on your device and only your recovery
> phrase can unlock it — that also means nobody, including me, can recover
> a vault without it.
>
> I've refunded your order [ORDER_ID] in full (5-10 business days to
> appear). Your license is deactivated and you owe nothing.
>
> If you ever give v2 a try: the setup wizard walks you through saving the
> 24-word phrase, and keeping one copy in the cloud (Drive, Dropbox) plus
> one on USB means a lost laptop never means a lost vault.
>
> Again, I'm sorry it ended this way.
>
> — [tu nombre], BookmarkForge

> Hola [nombre]:
>
> Lo siento de verdad por tus datos. BookmarkForge es zero-knowledge por
> diseño: todo va cifrado en tu dispositivo y solo tu frase de recuperación
> puede abrirlo — eso también significa que nadie, ni yo, puede recuperar
> una bóveda sin ella.
>
> He reembolsado íntegramente tu pedido [ORDER_ID] (5-10 días laborables en
> aparecer). Tu licencia está desactivada y no debes nada.
>
> Si algún día pruebas la v2: el asistente de creación te guía para guardar
> la frase de 24 palabras, y tener una copia en la nube (Drive, Dropbox) más
> otra en USB hace que perder el portátil nunca signifique perder la bóveda.
>
> De nuevo, lo siento.
>
> — [tu nombre], BookmarkForge

### Plantilla 3 — Respuesta a chargeback (para el banco/Whop)

> Order [ORDER_ID], [FECHA], [IMPORTE]. The customer purchased a lifetime
> Pro license for BookmarkForge and successfully activated it on device
> [INSTANCE_ID] on [FECHA_ACTIVACION] (server activation log attached).
> The product is a local-first application delivered digitally at the
> moment of activation; support correspondence shows [resumen]. We
> respectfully request reversal of the dispute.

> Pedido [ORDER_ID], [FECHA], [IMPORTE]. El cliente compró una licencia
> Pro lifetime de BookmarkForge y la activó correctamente en el dispositivo
> [INSTANCE_ID] el [FECHA_ACTIVACION] (registro de activaciones adjunto).
> El producto es una aplicación local-first entregada digitalmente en el
> momento de la activación; la correspondencia de soporte muestra [resumen].
> Solicitamos respetuosamente la reversión de la disputa.

### Plantilla 4 — Pérdida de datos SIN reembolso solicitado (retención)

> Hi [name],
>
> If you still have your 24-word recovery phrase or your .bmf backup file,
> your data is recoverable — click "Forgot password?" on the lock screen
> and paste the phrase, or restore the .bmf from Settings → Storage. Happy
> to walk you through it step by step.
>
> If neither exists, I'm genuinely sorry — the encryption that protects
> your data from everyone else also means it can't be recovered without
> the phrase. Your refund for [ORDER_ID] is processed (5-10 business
> days), and the free plan remains available with no time limit.
>
> — [tu nombre], BookmarkForge

> Hola [nombre]:
>
> Si aún tienes tu frase de 24 palabras o tu archivo .bmf, tus datos se
> pueden recuperar — pulsa "Forgot password?" en la pantalla de bloqueo y
> pega la frase, o restaura el .bmf desde Ajustes → Almacenamiento. Con
> gusto te guío paso a paso.
>
> Si no existe ninguno, lo siento de verdad — el cifrado que protege tus
> datos de todos los demás también implica que no se pueden recuperar sin
> la frase. Tu reembolso del pedido [ORDER_ID] está procesado (5-10 días
> laborables) y el plan gratuito sigue disponible sin límite de tiempo.
>
> — [tu nombre], BookmarkForge

## Métrica a vigilar

- Tickets por pérdida de datos / total tickets. Si sube del 20%, revisar si los
  avisos del wizard son suficientemente visibles (posible A/B del texto del kit).
