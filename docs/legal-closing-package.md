# Paquete de cierre legal — BookmarkForge (RGPD)

- **Propósito:** cerrar el punto 5 del [launch-checklist](launch-checklist.md): rellenar los campos `⚠ DATO PERSONAL` del [ROPA](ROPA.md) y firmar/conservar los DPA de cada proveedor, en el orden correcto.
- **Audiencia:** el operador (tú) o su asesor legal. Este documento es **operativo, no un dictamen jurídico**; la revisión final por un profesional sigue siendo el paso 3 del checklist.
- **Convención de expediente:** crea una carpeta privada `legal/` (fuera del repo público) con subcarpetas `ropa/`, `dpa/<proveedor>/`, `whop/`, `incidents/`. El repo público guarda las plantillas; el expediente guarda las copias firmadas con fecha. Nunca publiques datos personales del operador en el repo.
- **Última actualización:** 2026-09-15. Fuentes: ROPA §7/§8 (inventario), `server/src/license-server.ts` y `server/src/entitlement-endpoint.ts` (superficies de licencias y entitlement actuales), `netlify.toml`/`functions/` (hosting estático), launch-checklist punto 5.

---

## 1. Inventario de proveedores — qué hay que firmar realmente

| # | Proveedor | Rol según ROPA | Qué hay que hacer | Mecanismo | Bloquea |
|---|---|---|---|---|---|
| 1 | **Hosting del origen** (Netlify para el estático ya implícito en TOS; el **origen del servidor API/Node** queda por decidir) | Encargado (T3–T6) | DPA del host del servidor. ⚠ Decisión pendiente: si el origen se queda en Netlify Functions, aplica el DPA/CMR de Netlify; si es VPS (Hetzner, etc.), firmar su DPA (Hetzner lo ofrece bajo demanda) | Click-through / por solicitud | Despliegue a producción |
| 2 | **Google (Gemini API)** | **BYO-key desde el navegador** (T1) — BookmarkForge no transmite prompts: no hay proxy de IA desde 2026-09 | Ya no hay credencial del operador que activar. Aceptar el **Cloud Data Processing Addendum** solo si en el futuro se reintroduce un proxy con clave del servidor | Click-through en consola | No bloquea (BYO-key) |
| 3 | **Sentry (Functional Software, Inc.)** | Encargado (T7) | Aceptar el **DPA de Sentry** (incluye SCC 2021 módulo 3) — en la consola o por firmar la versión current | Click-through en sentry.io | Configurar el DSN del operador |
| 4 | **OpenAI** | Encargado (T1 solo si usuario trae su clave; el operador no trata, pero la landing lo nombra) | Aceptar su **DPA** (portal: Settings → Legal → DPA; click-through con SCC) | Click-through | No bloquea (BYO-key). Recomendado antes de lanzar por la mención en la política |
| 5 | **Anthropic (Claude)** | Ídem | Aceptar **Commercial Terms + DPA** (auto-aceptado al usar la API comercial; versión archivable) | Aceptación por uso | No bloquea |
| 6 | **Groq** | Ídem | DPA referenciado en sus términos API; conservar copia | Click-through | No bloquea |
| 7 | **OpenRouter / Hugging Face** | Ídem | OpenRouter: términos con rol de encargado; HF: DPA disponible + opción hub UE | Click-through | No bloquea |
| 8 | **Whop** | **Controlador independiente de pagos** — NO lleva DPA (no es encargado) | Firmar/aceptar su **Merchant Agreement**; conservar copia y su página de privacidad; verificar reparto de roles (tú = merchant, Whop = controlador de datos de pago) | Contrato al crear la cuenta | **Cobros reales** (punto 7 del checklist) |

**Regla de oro:** cada proveedor nuevo se añade a la tabla del ROPA §7 **antes** de activarse en producción (ya lo exige ROPA §7, nota 2). Esta tabla es la guía de *cómo*; el ROPA es el registro.

---

## 2. Qué rellenar exactamente en el ROPA (campos `⚠ DATO PERSONAL`)

Lista completa de los campos pendientes, con ubicación y cómo rellenarlos:

### §1 Responsable (3 campos + 1 derivado)

1. **Nombre / entidad legal.** Dos opciones válidas:
   - Persona física: tu nombre y apellidos + «operador de BookmarkForge». Válido pero expone tu identidad a cualquier usuario que lo pida (Art. 13 obliga a dar identidad al responsable). Es el precio de operar sin sociedad.
   - Sociedad/autónomo: razón social + CIF/NIF. Recomendado si hay cobros vía Whop (el merchant agreement pide una entidad de facturación).
   - Rellena también la línea equivalente en `public/privacy-and-terms.html` (§ identidad del responsable) y `public/`policy of every locale — deben coincidir palabra por palabra con el ROPA.
2. **Dirección / sede.** La del responsable legal. Si eres persona física y no quieres publicar tu domicilio: una dirección postal de gestión (buzón profesional) es práctica aceptada si el contacto por ese canal es real.
3. **Autoridad de control.** La del país de tu sede. Ejemplos: España → AEPD (www.aepd.es); Dinamarca → Datatilsynet; Alemania → la autoridad del Land; Irlanda → DPC. Escríbela con nombre + URL.
4. **§10 contactos de notificación** (derivado): rellena «autoridad de control ⚠ DATO PERSONAL» con lo del punto 3.

### §3 Inventario (1 campo)

5. **T6 nota de despliegue:** «T6 requiere confirmar la política de logs del despliegue real» → tras el primer despliegue, anota: dónde corren los logs (VPS/Functions), rotación real configurada (≤ 30 días según logrotate o política del PaaS) y pega el fragmento de configuración en `docs/operations.md`. Fecha y firma.

### §7 Encargados (4 campos)

6. **Google (Gemini):** sustituir «⚠ DATO PERSONAL (cláusulas del contrato…)» por: «DPA de Google Cloud aceptado el DD/MM/AAAA (versión DD/MM/AAAA), copia en `legal/dpa/google/`».
7. **OpenAI / Anthropic / Groq / OpenRouter / HF:** una línea por proveedor con fecha + versión + carpeta de copia. Los que NO firmes antes del lanzamiento: quítalos de la fila o marca «no ofrecido por el operador en el lanzamiento; el usuario puede configurarlo por su cuenta y riesgo (sin DPA del operador)» — coherente con T1 (el consentimiento lo da el usuario con su propia clave).
8. **Hosting:** después de elegir origen: proveedor, sede del datacenter (p. ej. Hetzner — Nuremberg/Falkenstein, UE), mecanismo (DPA firmado / CMR del PaaS), fecha.
9. **Sentry:** fecha de aceptación del DPA + versión.

### §8 Transferencias (1 mantenimiento)

10. **Vigencia de certificaciones:** en cada revisión trimestral, verificar que las listadas (Google/OpenAI/Anthropic/Sentry en DPF; Groq/OpenRouter/HF en SCC) siguen certificadas en dpf.dataprivacyframework.gov y anotar fecha de verificación.

### §12 Revisión (1 campo)

11. **Responsable:** nombre/contacto del operador (el mismo de §1).

**Criterio de cierre:** punto 5 del launch-checklist se marca `[x]` cuando los 11 puntos anteriores están en el expediente y la copia del ROPA del expediente no contiene ningún `⚠ DATO PERSONAL` restante.

---

## 3. Qué debe tener un DPA válido (checklist Art. 28(3))

Antes de aceptar/firmar cualquiera de los siguientes, verifica que el documento cubre los **cinco elementos obligatorios**:

1. **Objeto y duración** del tratamiento + naturaleza y finalidad + categorías de datos e interesados.
2. El encargado trata solo siguiendo **instrucciones documentadas** del responsable (incl. transferencias internacionales — ver SCC/anexos).
3. **Confidencialidad:** personal autorizado bajo obligación de confidencialidad.
4. **Seguridad:** medidas técnicas y organizativas (Art. 32) — puede referenciar un anexo.
5. **Subencargados:** reglas de autorización general/específica + lista actual + obligación de informar cambios.
6. **Asistencia** al responsable para derechos de interesados (Arts. 12–22) y para notificaciones (Arts. 32–36).
7. **Al finalizar:** borrar o devolver los datos.
8. **Auditoría:** permitir contribuir a auditorías/inspecciones.

Los DPA grandes (Google, Sentry, OpenAI) cubren todo esto por construcción — tu trabajo es **conservar la versión y la fecha**, no negociar. La plantilla A (§6) existe para el caso raro de un proveedor pequeño sin DPA (p. ej. un TURN autoalojado de un amigo, hosting boutique).

---

## 4. Orden de firma (con dependencias y plazos)

**Semana 1 — en paralelo (todo es click-through o solicitud; ~1–2 h de trabajo total):**

| Día | Acción | Por qué este orden |
|---|---|---|
| 1 | **1. Hosting/origen** — decidir dónde vive el servidor API y firmar su DPA | Todo lo demás se despliega ahí; es el único bloqueante técnico. Si es VPS tipo Hetzner: solicitar DPA por el panel (respuesta 24–72 h) → **empezarlo el día 1** |
| 1 | **2. Google Cloud DPA** (click-through, 10 min) + crear el proyecto/clave Gemini | Requiere tener cuenta de organización/personal creada; la clave es secreto del repo (runbook de secretos) |
| 1 | **3. Sentry DPA** (click-through, 10 min) + crear organización y copiar DSN (todavía sin activar en producción) | El DSN queda listo para el punto 8 del checklist sin abrir el grifo |
| 2 | **4. OpenAI DPA** (click-through, 10 min) | Por la mención en la política publicada; la más Visible de las BYO-key |
| 2 | **5. Anthropic/Groq/OpenRouter/HF** (aceptación/archivo, 20 min en total) | Agrupables; archiva versión+fecha de cada uno |
| 3 | **6. Whop Merchant Agreement** + configuración de cuenta y producto | Dependiente de la identidad legal del §1 → rellena §1 ANTES de esto. El contrato de Whop pide entidad de facturación y datos bancarios |
| 3–5 | **7. Rellenar el ROPA** (los 11 puntos de §2) con fechas y rutas de copias | Necesita las fechas de firma de 1–6 |
| 5 | **8. Compra de prueba con reembolso** en Whop (punto 7 del checklist) | Última pieza: valida el circuito real de cobros |

**Regla de dependencia:** identidad legal (§1) → Whop; hosting → todo lo demás en servidor; todo lo demás → relleno del ROPA → cierre del checklist.

**Plazos de respuesta externa a vigilar:** DPA por solicitud de hosting (24–72 h), soporte de proveedores pequeños (días). Por eso la semana 1 es de papeleo en paralelo, no secuencial.

---

## 5. Evidencia que hay que conservar (por proveedor)

En `legal/dpa/<proveedor>/`:

1. Copia del DPA aceptado (PDF o HTML guardado con fecha) **y** de sus SCC/anexos si existen.
2. Captura o correo de confirmación de la aceptación (los click-through generan pantalla de aceptación: captúrala).
3. Línea en el registro de firmas (plantilla C, §6) con: proveedor, rol, fecha de firma, versión del documento, URL de la versión, mecanismo, carpeta de la copia, fecha de la próxima revisión trimestral.
4. Si el proveedor notifica un cambio de subencargados (los grandes lo hacen por correo/lista pública): guardar la notificación y reevaluar en la revisión trimestral.

---

## 6. Plantillas

### Plantilla A — DPA genérico (Art. 28) para proveedores sin documento propio

> Contrato de encargo de tratamiento (Art. 28 RGPD) entre **[RESPONSABLE — nombre legal de §1]** («el Responsable») y **[ENCARGADO — proveedor]** («el Encargado»).
>
> 1. **Objeto y duración:** el Encargado tratará, en nombre del Responsable, los datos personales necesarios para [servicio contratado: alojamiento del servidor de señalización y aplicación /-relay X], durante la vigencia del contrato de servicios.
> 2. **Naturaleza, finalidad, categorías:** [p. ej. almacenamiento y transmisión de registros técnicos de conexión (dirección IP, user-agent, marcas de tiempo) y metadatos de señalización WebRTC efímeros], con la finalidad de prestar y asegurar el servicio. Interesados: usuarios de BookmarkForge.
> 3. **Instrucciones:** el Encargado tratará los datos únicamente conforme a instrucciones documentadas del Responsable, incluidas las transferencias internacionales, que requerirán garantías adecuadas (cláusulas contractuales tipo de la Decisión 2021/914).
> 4. **Confidencialidad:** el personal autorizado queda sujeto a obligación de confidencialidad.
> 5. **Seguridad:** medidas del Art. 32 RGPD adecuadas al riesgo: [mínimo: cifrado en tránsito TLS, control de acceso, registro de accesos, copias de seguridad].
> 6. **Subencargados:** no se autoriza ningún subencargado sin autorización previa y por escrito del Responsable; el Encargado informará de cualquier cambio con 30 días de antelación para permitir objeción fundamentada.
> 7. **Asistencia:** el Encargado asistirá al Responsable en la respuesta a derechos de interesados (Arts. 12–22) y en las obligaciones de los Arts. 32–36, en la medida en que sea posible.
> 8. **Fin del contrato:** a su terminación, el Encargado borrará los datos personales y destruirá los soportes, salvo obligación legal de conservación, y certificará la eliminación.
> 9. **Auditorías:** el Encargado permitirá y contribuirá a auditorías e inspecciones del Responsable o auditor designado, previo acuerdo de alcance y frecuencia razonables.
>
> Firmado: [Responsable, fecha] / [Encargado, fecha]

### Plantilla B — Correo de solicitud de DPA (para hosting/proveedores sin formulario)

```
Asunto: Solicitud de Acuerdo de Encargo de Tratamiento (DPA) — cliente [nº cuenta]

Hola,

Somos clientes de [proveedor] para [servicio] y, para cumplir el artículo 28
del RGPD, necesitamos un acuerdo de encargo de tratamiento vigente entre
[RESPONSABLE — identidad de §1] y [proveedor].

¿Podrían enviarnos su DPA estándar (idealmente con las SCC 2021 como anexo,
si se prevé transferencia fuera del EEE) para su firma, o indicarnos el
procedimiento para aceptarlo?

Gracias,
[Nombre, cargo, contacto]
```

### Plantilla C — Registro de firmas del expediente (`legal/dpa/REGISTRO.md`)

| Proveedor | Rol (ROPA) | Documento firmado | Versión/fecha del doc | Mecanismo | Firmado el | Copia en | Próxima revisión |
|---|---|---|---|---|---|---|---|
| [hosting] | Encargado (T3–T6) | DPA + SCC | v…, DD/MM/AAAA | firma electrónica | DD/MM/AAAA | `legal/dpa/hosting/` | [trimestre] |
| Google | Encargado (T1) | Cloud DPA | v…, DD/MM/AAAA | click-through | | `legal/dpa/google/` | |
| Sentry | Encargado (T7) | DPA + SCC M3 | | click-through | | `legal/dpa/sentry/` | |
| OpenAI | Encargado (T1, BYO-key) | DPA | | click-through | | `legal/dpa/openai/` | |
| Anthropic | Encargado (T1, BYO-key) | DPA (Commercial Terms) | | aceptación por uso | | `legal/dpa/anthropic/` | |
| Groq | Encargado (T1, BYO-key) | DPA | | click-through | | `legal/dpa/groq/` | |
| OpenRouter | Encargado (T1, BYO-key) | Términos API (rol encargado) | | aceptación | | `legal/dpa/openrouter/` | |
| Hugging Face | Encargado (T1, BYO-key) | DPA | | click-through | | `legal/dpa/hf/` | |
| Whop | **Controlador independiente** (T2) | Merchant Agreement | | contrato cuenta | | `legal/whop/` | |

### Plantilla D — Fila de ROPA §7 de ejemplo (NO es evidencia operativa)

| Encargado | Rol | Datos | Contrato DPA | Sede / transferencia |
|---|---|---|---|---|
| EJEMPLO — Hetzner Online GmbH | Alojamiento del origen API (T3–T6) | Logs de conexión, señalización efímera | Sustituir por el DPA real y su fecha; esta fila no confirma una firma | Ejemplo: datacenter Nuremberg (DE); confirmar sede y transferencia reales |

---

## 7. Mantenimiento

- El registro de firmas (plantilla C) vive en el expediente; su **resumen** (proveedor, fecha, vigencia) se refleja en ROPA §7/§8 en cada revisión trimestral (§12 del ROPA).
- Disparadores extraordinarios (ya definidos en ROPA §12): nuevo proveedor → nueva fila aquí + en §7 antes de activar; cambio de sede; incidente; cambio normativo.
- Al retirar un proveedor: marcar la fila como retirada con fecha, conservar la copia del DPA mientras existan datos tratados + plazo de prescripción.

## 8. Recordatorios finales

1. El repo **público** nunca contiene: identidad legal, dirección, DPA firmados, claves. Solo plantillas y procedimientos.
2. La política publicada (`public/privacy-and-terms.html`), el ROPA y las locales de la política deben citar la **misma identidad legal y el mismo correo** — un desfase entre ellos es exactamente el tipo de drift que el resto del repo automatiza; aquí se vigila a mano en la revisión trimestral.
3. Si en el lanzamiento solo están firmados hosting + Google + Sentry + Whop, es un cierre válido: las BYO-key restantes quedan documentadas como «configuradas por el usuario bajo su propio acuerdo con el proveedor», que es la realidad técnica del producto.
