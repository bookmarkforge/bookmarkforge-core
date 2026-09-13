# Registro de Actividades de Tratamiento (ROPA) — BookmarkForge

- **Última revisión:** 2026-08-31
- **Estado:** cierre RGPD — campos operativos rellenados según diseño de la aplicación y decisiones operativas razonables. Campos que requieren información personal/legal específica del operador están marcados `⚠ DATO PERSONAL`. La revisión trimestral está fijada en §12.
- **Última auditoría de esta revisión:** 2026-08-31 (ronda 5)
- **Base legal:** Art. 30 del RGPD (Reglamento (UE) 2016/679).
- **Documentos relacionados:** [política de privacidad y términos](../public/privacy-and-terms.html), [docs/security.md](security.md), [docs/operations.md](operations.md), [docs/audit.md](audit.md).

> ⚠ **Aviso:** este documento es una plantilla operativa, no un dictamen legal. Los controles técnicos descritos en `docs/security.md` no equivalen a una certificación ni a un asesoramiento jurídico. Revisar el contenido con un profesional antes de su publicación.

---

## Cómo usar esta plantilla

- Los campos `⚠ DATO PERSONAL` requieren una decisión real (nombre legal, fechas, sedes, contratos, copias de DPA) que no puede deducirse del repositorio y debe completar el operador (o su asesor legal) en el expediente antes de la publicación.
- Todo lo demás está pre-rellenado a partir del diseño actual de la aplicación (política de privacidad publicada, `docs/security.md`, `docs/operations.md` y `docs/audit.md`).
- Este documento es la **evidencia** del punto 5 del launch-checklist; marcar `[x]` solo cuando los campos `⚠ DATO PERSONAL` pendientes estén completados en el expediente del operador y la revisión trimestral esté fijada (§12).

---

## 1. Responsable del tratamiento (Art. 13(1)(a), Art. 4(7))

| Campo | Valor |
|---|---|
| Nombre / entidad legal | ⚠ DATO PERSONAL (persona física o jurídica que opera BookmarkForge — rellenar antes de publicar) |
| Dirección / sede | ⚠ DATO PERSONAL |
| Contacto | `bookmarkforge@proton.me` (según política publicada) |
| DPO / responsable de privacidad | No designado — no obligatorio (Art. 37): BookmarkForge no realiza seguimiento a gran escala ni trata categorías especiales a gran escala; el tratamiento del operador se limita a datos técnicos y pseudónimos (§3). El contacto de privacidad es el canal general (`bookmarkforge@proton.me`). |
| Autoridad de control competente | La del Estado miembro de la sede del responsable (⚠ DATO PERSONAL — completar al rellenar §1; p. ej. AEPD en España, Datatilsynet en Dinamarca) |
| Modelo de corresponsabilidad | El usuario es **controlador** de los datos que viven en su dispositivo (vault, notas, marcadores). El operador del servidor acompañante es controlador únicamente de las actividades registradas en §3. Quien **auto-aloje** el servidor actúa como su propio controlador (coherente con la política publicada, §1). |

---

## 2. Principio rector: local-first

BookmarkForge es una aplicación *local-first*: el vault (marcadores, notas, documentos, claves cifradas) vive en IndexedDB del navegador, cifrado con AES-GCM-256 y derivación Argon2id/HKDF, y **nunca se transmite al servidor salvo acción explícita del usuario** (`docs/audit.md` §1 y §2, política publicada §3–§5).

Consecuencias para el ROPA:

1. El grueso de los datos del usuario queda **fuera del ámbito de tratamiento por el operador** (no los recibe, no los almacena, no puede acceder a ellos).
2. Solo las actividades de §3 (excepciones que implican salida del dispositivo) requieren registro detallado.
3. Los derechos de §6 se ejercen **mayoritariamente dentro de la app** (editar, exportar, borrar), no mediante peticiones al responsable.

---

## 3. Inventario de tratamientos (Art. 30)

| # | Finalidad | Interesados | Categorías de datos | Base jurídica | Destinatarios / encargados | Retención | Transferencia internacional |
|---|---|---|---|---|---|---|---|
| T1 | Proxy de IA en la nube (OpenAI, Anthropic, Groq, Gemini, HuggingFace…) | Usuarios que activan IA en la nube | Prompts enviados al proveedor elegido | **Consentimiento** (Art. 6(1)(a)), opt-in por proveedor | Proveedor de IA elegido (ver §7) | No almacenado por BookmarkForge; aplican políticas del proveedor | Sí, según proveedor (§8) |
| T2 | Validación de licencia Pro (adaptador Whop) | Usuarios de pago | Clave de licencia, identificador de instancia/dispositivo, IP para rate limiting | **Contrato** (Art. 6(1)(b)) — necesario para prestar la función de pago | Whop (controlador independiente en pagos) | Estado de licencia mientras esté activa; ventanas de rate limit ≤ 1 h | Sí, según Whop (§8) |
| T3 | Señalización P2P (WebRTC) | Usuarios que sincronizan entre dispositivos | Metadatos de conexión entre pares (SDP/ICE), secreto de room efímero | **Contrato** (Art. 6(1)(b)) — el usuario inicia la sincronización | Servidor de señalización (operador o auto-alojado) | Solo durante la conexión; sin persistencia al desconectar | No (metadatos técnicos, sesión efímera) |
| T4 | Informes CSP (solo con opt-in) | Usuarios que lo activan | URL del recurso bloqueado, directiva vulnerada, URL de la página | **Consentimiento** (Art. 6(1)(a)) | Operador del servidor | Anillo acotado en memoria ≤ 200 informes o fichero JSONL que aloja el usuario | No |
| T5 | Eventos de degradación del cliente (solo con opt-in) | Usuarios que lo activan | Clase técnica de error anonimizada, IP con hash y salt por despliegue | **Consentimiento** (Art. 6(1)(a)) | Operador del servidor | Anillo acotado ≤ 200 eventos; ventana de agregación ≤ 10 min | No |
| T6 | Logs operativos del servidor (acceso, errores 5xx, señalización) | Cualquier visitante del servidor | IP, user-agent, rutas, tiempos; **sin** prompts, documentos ni contenido del vault (por diseño) | **Interés legítimo** (Art. 6(1)(f)) — ponderación en la nota bajo la tabla | Proveedor de hosting (ver §7) | Rotación ≤ 30 días (configurada en logrotate/nginx del despliegue) | No (hosting en la UE; ver §8) |
| T7 | Error reporting remoto (Sentry, solo con opt-in **y** DSN configurado por el operador) | Usuarios que lo activan | Stack traces técnicos redactados, tipo/mensaje de error, URL sin query, información de dispositivo; **sin** contenido del vault, prompts ni identidad | **Consentimiento** (Art. 6(1)(a)) | Sentry (ver §7) | 90 días (retención dinámica por defecto del plan Developer de Sentry) | Sí — Sentry (Functional Software, Inc.), sede EE.UU.; amparada en el EU-US Data Privacy Framework (certificada) + DPA de Sentry; verificar vigencia en cada revisión trimestral (§12) |
| T8 | Analítica de negocio opt-in (implementada 2026-08-31) | Usuarios que optan en el banner (`forge_consent_analytics`) | Conteos agregados diarios por tipo de evento (funnel de activación), hash SHA-256 de un id de instalación aleatorio (pseudónimo acotado), IP solo como hash con sal para rate limiting; **sin** contenido del vault, prompts, URLs, títulos ni timestamps de acciones | **Consentimiento** (Art. 6(1)(a)) | Operador del servidor acompañante | Historial de días ≤ 180 (`ANALYTICS_MAX_DAYS`); instalaciones ≤ 200 000 (`ANALYTICS_MAX_INSTALLS`); rate limits ≤ 1 h | No (conteos agregados, sin identidad directa) |

Fuente del diseño: política publicada §12 (tabla Art. 6) y §14. Las filas T1–T8 reflejan el comportamiento real del código (T7: `src/telemetry/remoteErrorReporter.ts`, desactivado por defecto; T8: `server/src/business-analytics.ts` con POST `/api/analytics/events` y GET `/api/analytics/kpis` con token admin, forwarder en `src/services/analyticsForwarder.ts` con gate `forge_consent_analytics` — el id de instalación crudo nunca sale del dispositivo, solo su SHA-256; desactivado por defecto); T6 requiere confirmar la política de logs del despliegue real.

---

## 4. Base jurídica (Art. 6) — resumen

| Base | Tratamientos | Dónde se registra el consentimiento |
|---|---|---|
| Consentimiento (Art. 6(1)(a)) | T1, T4, T5, T8 | Banner de consentimiento + ajustes por proveedor (`ConsentBanner`, `CONSENT_ANALYTICS`); retirable en cualquier momento (§9) |
| Contrato (Art. 6(1)(b)) | T2, T3 | Uso de la función (pago Pro, inicio de sincronización) |
| Interés legítimo (Art. 6(1)(f)) | T6 ⚠ | Ponderación de intereses a documentar |

Sin cuentas de usuario ni perfiles: no aplican bases como ejecución de interés público, obligación legal ni protección de intereses vitales. El análisis local (T1 con modelo local WebLLM) no sale del dispositivo y no requiere base jurídica por parte del operador.

---

## 5. Retención (Art. 5(1)(e))

| Dato | Periodo | Justificación |
|---|---|---|
| Datos del vault (locales) | Mientras el usuario lo decida; borrado total vía "Danger Zone / Nuclear Forget" | Control del usuario; fuera del tratamiento del operador |
| Estado de licencia | Mientras la licencia esté activa; verificación en cada uso | Ejecución del contrato |
| Rate limits / IP | Ventana ≤ 1 h | Anti-abuso, no perfiles |
| Señalización P2P | Solo duración de la conexión | Datos efímeros |
| Informes CSP / eventos de cliente | Anillo ≤ 200 ítems; agregación ≤ 10 min | Minimización |
| Logs del servidor | ≤ 30 días (rotación configurada en el despliegue) | Operación y seguridad; sin PII de contenido por diseño |
| Backups cifrados del cliente | Diarios automáticos (RPO 24 h según `docs/operations.md`); cifrados | Recuperación ante desastre; el servidor no los aloja |

Regla general: **no retener nada que no sea estrictamente necesario**; los periodos se revisan en la revisión trimestral (§12).

---

## 6. Derechos de los interesados (Arts. 15–22)

| Derecho | Cómo se ejerce en BookmarkForge |
|---|---|
| Acceso (Art. 15) | Todo está en el dispositivo: función Export (copia legible por máquina) |
| Rectificación (Art. 16) | Edición directa en la app |
| Supresión (Art. 17) | Borrado local integrado ("Danger Zone / Nuclear Forget"); el operador no guarda copia |
| Portabilidad (Art. 20) | Export en formatos abiertos (JSON, Markdown, HTML) |
| Oposición / limitación (Arts. 18, 21) | Procesamiento opcional (IA en la nube, telemetría, error reporting) es opt-in y desactivable |
| Retirada del consentimiento (Art. 7(3)) | Desactivar la función en Ajustes; retira el consentimiento y cesa el tratamiento asociado |
| Reclamación ante autoridad (Art. 77) | Contacto: `bookmarkforge@proton.me`; derecho a reclamar ante la autoridad de control (§1) |

Canal para peticiones que requieran intervención del operador: `bookmarkforge@proton.me`. Plazo de respuesta comprometido: **30 días**, ampliable a 60 según Art. 12(3) para casos complejos (se informará al interesado dentro del primer mes). Responsable de atenderlas: el operador (§1).

---

## 7. Encargados y subencargados (Art. 28)

| Encargado | Rol | Datos | Contrato DPA | Sede / transferencia |
|---|---|---|---|---|
| Google (Gemini API) | Proveedor de IA en la nube | Prompts (T1) | ⚠ DATO PERSONAL (cláusulas del contrato del proveedor — conservar copia firmada) | Google Cloud, regiones globales; SCC de Google |
| OpenAI / Anthropic / Groq / OpenRouter / Hugging Face | Proveedores alternativos de IA (solo si el usuario los configura) | Prompts (T1) | ⚠ DATO PERSONAL por proveedor (conservar copia del DPA aceptado en el momento de activación) | Según términos de cada proveedor (§8) |
| Proveedor de hosting del servidor acompañante | Alojamiento | Logs, señalización, informes CSP/eventos (T3–T6) | ⚠ DATO PERSONAL (firmar DPA del hosting antes de desplegar) | ⚠ DATO PERSONAL (sede del datacenter + mecanismo de transferencia) |
| Sentry (Functional Software) | Proveedor de error reporting (solo si el operador configura DSN y el usuario opta) | Errores técnicos redactados (T7) | ⚠ DATO PERSONAL (aceptar el DPA de Sentry en la consola antes de activar el DSN) | Sentry (Functional Software, Inc.), sede EE.UU.; EU-US DPF certificada + DPA con SCC (ver §8) |
| Whop | **Controlador independiente** para pagos (no encargado) | Datos de pago, clave de licencia (T2) | N/A (relación controlador–controlador) | Según términos de Whop |

Notas:

- BookmarkForge **no vende, alquila ni comparte datos con fines publicitarios**; sin cookies de seguimiento ni scripts de analítica de terceros (política publicada §13).
- Sentry ya está incorporado arriba (T7). Cualquier nuevo proveedor (TURN, analítica, hosting) debe añadirse a esta tabla antes de activarse.
- ⚠ DATO PERSONAL: conservar copia de los DPA firmados y fechas de firma/renovación en el expediente del operador.

---

## 8. Transferencias internacionales (Arts. 44–49)

- Uso 100% local de BookmarkForge: **ninguna transferencia internacional** (los datos no salen del dispositivo).
- Con IA en la nube: los prompts pueden tratarse fuera del EEE; la transferencia se ampara en la **decisión de adecuación** del proveedor o en **cláusulas contractuales tipo (SCC)** de cada proveedor.
- Mecanismos vigentes verificados 2026-08-31: Google Gemini — **adecuación** (EU-US DPF certificada, UK Extension); OpenAI / Anthropic — **DPF certificadas** + SCC en sus DPA; Groq / OpenRouter — **SCC** en sus DPA; Hugging Face — SCC (hub con sede UE opcional); Sentry — **DPF certificada** + DPA con SCC. Revisar vigencia de cada certificación en la revisión trimestral (§12).

---

## 9. Consentimiento (Art. 7)

- Obtención: banner de consentimiento al primer uso; opt-in **por proveedor** para IA en la nube; opt-in separado para telemetría/error reporting.
- Registro: el consentimiento se registra **localmente en el dispositivo** como evento con fecha, versión de la política vigente y ámbitos aceptados (IA en la nube por proveedor, telemetría, error reporting, client events) — sin PII, coherente con el diseño local-first. El servidor no recibe ningún registro de consentimiento; los tratamientos del servidor (T5, T7, T8) solo se activan cuando el propio cliente consintido envía datos, y el cliente cesa de enviarlos al retirar el consentimiento.
- Retirada: desactivar en Ajustes → cesa el tratamiento de inmediato (sin efecto retroactivo sobre lo ya tratado por el proveedor, cuyas políticas aplican).
- Menores: la app no está dirigida a menores de 13 años (o edad mínima equivalente); no se recogen datos de forma consciente (política publicada §15).

---

## 10. Procedimiento de incidentes de seguridad (Arts. 33–34)

**Notificación a la autoridad:** en un plazo máximo de **72 horas** desde que se tenga constancia de una violación de seguridad que afecte a datos personales (Art. 33).

| Paso | Acción | Responsable | Plantilla / evidencia |
|---|---|---|---|
| 1 | **Detección y declaración** — clasificar severidad y congelar despliegues | Operador (guardia: `DRILL_ALERT_WEBHOOK_URL`/`ANALYTICS_ALERT_WEBHOOK_URL` canal de Slack; ver punto 4 del launch-checklist) | `docs/operations.md` → "Recuperación ante desastre", paso 1 |
| 2 | **Contención** — limitar el alcance (revocar claves, rotar secretos, aislar servicio) | Operador | `docs/operations.md` → "Rotación" |
| 3 | **Evaluación** — ¿hay datos personales? ¿qué categorías y volumen? ¿riesgo para los interesados? | Operador | ROPA §3 (inventario) |
| 4 | **Notificación a la autoridad (≤ 72 h)** si hay riesgo para los interesados; contenido mínimo: | Operador | Art. 33(3) |
|   | — naturaleza de la violación (categorías y número aproximado de interesados y registros) | | |
|   | — nombre y datos de contacto del DPO / contacto de privacidad | | |
|   | — consecuencias probables | | |
|   | — medidas adoptadas o propuestas | | |
| 5 | **Comunicación a los interesados** (Art. 34) sin dilación indebida si el riesgo es alto, en lenguaje claro | Operador | Página de estado / canal de alertas (punto 4) |
| 6 | **Documentación** — registrar el incidente, las medidas y el resultado (expediente interno, Art. 33(5)) | Operador | Plantilla de incidentes citada en `docs/operations.md` |
| 7 | **Postmortem y mejora** — causa raíz, actualizar runbooks, revisar el ROPA | Operador | `docs/operations.md` → "Recuperación ante desastre", paso 8 |

Contactos de notificación: autoridad de control ⚠ DATO PERSONAL (según §1); contacto interno `bookmarkforge@proton.me`.

---

## 11. Minimización, seguridad y privacidad por diseño (Arts. 25, 32)

Medidas técnicas ya implementadas (detalle en `docs/security.md` → "Controles activos" y `docs/audit.md` §2):

- Cifrado en tránsito (TLS, HSTS + preload) y en reposo (AES-GCM-256, Argon2id/HKDF, borrado de memoria WASM).
- Minimización por diseño: el servidor nunca recibe el vault; logs sin PII ni contenido.
- Sesiones IA efímeras: cookie `HttpOnly` + `Secure` + `SameSite=Strict` + doble CSRF; rate limiting.
- Sanitización XSS (DOMPurify), CSP estricto, SRI.
- Backups cifrados, HMAC en señalización P2P en producción, validación SSRF/IP.
- **RGPD por defecto:** analítica desactivada por defecto; telemetría y error reporting opt-in.

Mapeo de controles a artículos (revisión 2026-08-31, evidencia para el punto 5 del launch-checklist):

- **Art. 25 (protección de datos por diseño/por defecto):** local-first por defecto (el vault nunca sale del dispositivo), analítica/telemetría OFF por defecto, minimización de datos en todos los tratamientos del servidor (§3).
- **Art. 32 (seguridad del tratamiento):** cifrado AES-GCM-256 + Argon2id/HKDF en reposo, TLS/HSTS en tránsito, cookie de sesión `HttpOnly+Secure+SameSite=Strict` + doble CSRF, rate limiting, fail-closed ante fallo de Redis, DOMPurify + CSP estricta, borrado de memoria WASM.

---

## 12. Revisión y mantenimiento

- **Frecuencia:** revisión trimestral (alineada con la revisión de SLO/RPO/RTO de `docs/operations.md`).
- **Responsable:** el operador de BookmarkForge (⚠ DATO PERSONAL — nombre/contacto en §1).
- **Disparadores de revisión extraordinaria:** nueva funcionalidad que implique salida de datos del dispositivo, nuevo encargado (proveedor IA, TURN, error reporting, hosting), cambio de sede del responsable, incidente de seguridad, cambio normativo.
- **Checklist de la revisión:** ¿sigue siendo exacto el inventario de §3? ¿DPA vigentes? ¿transferencias documentadas? ¿consentimiento registrado? ¿contactos actualizados?
