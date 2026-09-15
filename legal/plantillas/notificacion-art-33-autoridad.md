# Plantilla privada — notificación de violación de seguridad a la autoridad (RGPD art. 33)

**Uso:** borrador operativo para revisión y envío a la autoridad de control competente. No enviar sin validar hechos, jurisdicción y firma del responsable.

> Regla de tiempo: el responsable debe notificar a la autoridad competente **sin dilación indebida y, cuando sea posible, dentro de las 72 horas desde que tuvo conocimiento** de la violación, salvo que sea improbable que constituya un riesgo para los derechos y libertades de las personas. Si se supera el plazo, explicar los motivos del retraso.

## 1. Control del plazo

- Fecha y hora del primer indicio: `[AAAA-MM-DD HH:MM TZ]`
- Fecha y hora en que el responsable tuvo conocimiento razonable: `[AAAA-MM-DD HH:MM TZ]`
- Fecha y hora límite de 72 horas: `[AAAA-MM-DD HH:MM TZ]`
- Fecha y hora de esta notificación: `[AAAA-MM-DD HH:MM TZ]`
- ¿Se notifica dentro de 72 horas?: `[Sí / No]`
- Si no: motivo del retraso: `[●]`
- Persona que abrió el incidente: `[nombre, cargo, contacto]`
- Número interno del incidente: `BMF-INC-[AAAA]-[NNN]`
- Clasificación provisional: `[confidencialidad / integridad / disponibilidad / combinación]`

## 2. Responsable del tratamiento

- Entidad legal: `[nombre completo]`
- Nombre comercial: `BookmarkForge`
- NIF: `[●]`
- Domicilio: `[●]`
- Contacto del responsable: `[●]`
- Contacto de privacidad / DPO, si existe: `[●]`
- Autoridad a la que se notifica: `[AEPD u otra autoridad principal competente]`
- Canal o expediente de la autoridad: `[●, si ya existe]`

## 3. Resumen ejecutivo

> El día `[fecha y hora]`, BookmarkForge detectó `[descripción breve y factual de la incidencia]`. La incidencia afectó potencialmente a `[categorías de personas]` y a `[categorías de datos]` durante el periodo `[inicio–fin]`. La investigación disponible hasta este momento indica `[hechos confirmados]`. Se han adoptado `[medidas de contención]` y la investigación continúa respecto de `[puntos pendientes]`.

No incluir hipótesis como hechos confirmados. Si la investigación sigue abierta, indicar expresamente que se trata de una notificación inicial y que se enviará información adicional.

## 4. Naturaleza de la violación

Marcar lo que corresponda:

- `[ ]` Acceso o divulgación no autorizados.
- `[ ]` Pérdida o destrucción accidental o ilícita.
- `[ ]` Alteración no autorizada.
- `[ ]` Indisponibilidad temporal.
- `[ ]` Credenciales o claves expuestas.
- `[ ]` Configuración o despliegue incorrecto.
- `[ ]` Proveedor o subencargado implicado.
- `[ ]` Otro: `[●]`

Descripción técnica en lenguaje no especulativo:

`[Qué ocurrió, qué sistema estuvo implicado, cómo se detectó y qué se ha confirmado.]`

## 5. Categorías y volumen aproximado

- Categorías de interesados:
  - `[usuarios registrados / compradores / personas que contactaron con soporte / colaboradores / otros]`
- Número aproximado de interesados afectados: `[número / rango / desconocido todavía]`
- Número aproximado de registros afectados: `[número / rango / desconocido todavía]`
- Datos personales afectados:
  - `[identificación y contacto]`
  - `[datos de licencia o compra]`
  - `[datos técnicos, IP, logs]`
  - `[datos de soporte]`
  - `[otros]`
- Datos que **no** fueron afectados, si está confirmado: `[●]`
- Datos de bóveda local o contenido cifrado: `[no afectados / afectados / no determinado]`
- Datos especialmente protegidos o de alto impacto: `[sí/no/no determinado; explicar]`

No afirmar que una bóveda es inaccesible para siempre salvo que la investigación técnica lo demuestre. Diferenciar entre datos almacenados localmente, datos cifrados en tránsito o reposo, metadatos y contenido descifrado.

## 6. Consecuencias probables

- `[ ]` Riesgo de suplantación o phishing.
- `[ ]` Riesgo de acceso no autorizado a cuentas o licencias.
- `[ ]` Riesgo financiero.
- `[ ]` Riesgo de pérdida de confidencialidad.
- `[ ]` Riesgo de indisponibilidad.
- `[ ]` Riesgo de divulgación de contenido.
- `[ ]` Otro: `[●]`

Evaluación provisional del riesgo:

`[Bajo / medio / alto / todavía no determinado]`

Justificación:

`[Por qué el incidente puede o no puede afectar a los derechos y libertades, considerando tipo de datos, volumen, cifrado, facilidad de identificación y duración.]`

## 7. Medidas adoptadas o propuestas

### Contención inmediata

- `[revocar sesiones o tokens]`
- `[aislar sistema o proveedor]`
- `[rotar credenciales]`
- `[bloquear endpoint]`
- `[preservar logs y evidencias]`
- `[corregir configuración]`
- `[otra]`

### Mitigación para las personas

- `[restablecimiento de credenciales]`
- `[recomendación de vigilancia ante phishing]`
- `[soporte prioritario]`
- `[corrección o recuperación de datos]`
- `[otra]`

### Prevención de recurrencia

- `[parche o cambio de configuración]`
- `[revisión de permisos]`
- `[mejora de monitorización]`
- `[revisión de proveedor/DPA]`
- `[formación o cambio de procedimiento]`

## 8. Comunicación a los interesados

- ¿Es probable que exista un riesgo alto?: `[Sí / No / Pendiente]`
- ¿Se prevé comunicación conforme al art. 34?: `[Sí / No, justificar / Pendiente]`
- Fecha o ventana prevista: `[●]`
- Canal: `[email / aviso destacado / comunicación individual / otro]`
- Plantilla utilizada: `legal/plantillas/notificacion-art-34-interesados.md`

## 9. Información pendiente y seguimiento

- Hecho pendiente: `[responsable y fecha prevista]`
- Proveedor pendiente de confirmar: `[●]`
- Próxima actualización a la autoridad: `[fecha]`
- Expediente interno donde se conserva la evidencia: `[referencia cifrada]`

## 10. Declaración

> La información anterior refleja los hechos conocidos en la fecha de envío. BookmarkForge continuará investigando la incidencia y comunicará sin demora cualquier información material adicional o corrección necesaria.

Firma:

- Nombre: `[●]`
- Cargo: `[●]`
- Entidad: `[●]`
- Fecha y hora: `[●]`
- Firma o aceptación: `[●]`
