# BookmarkForge — REGISTRO de contratos, DPAs y evidencias

**Clasificación:** PRIVADO — no publicar ni subir al repositorio público
**Proyecto:** BookmarkForge
**Versión del registro:** 0.1 (borrador operativo)
**Fecha de apertura:** 2026-09-15
**Responsable de mantenerlo:** [NOMBRE LEGAL / ENTIDAD]
**Revisión jurídica prevista:** [AAAA-MM-DD]

> Este registro no demuestra por sí mismo que exista un contrato firmado. Cada estado debe apoyarse en el documento o evidencia indicado en `evidence_ref`. No guardar aquí secretos, datos completos de tarjetas, contraseñas, frases de recuperación ni datos personales sin anonimizar.

## Estados permitidos

- `TO CONFIRM` — proveedor o papel aún debe confirmarse.
- `REQUESTED` — DPA/contracto solicitado.
- `RECEIVED` — recibido, pendiente de revisión.
- `SIGNED` — aceptado o firmado por la entidad correcta; incluir fecha y evidencia.
- `NOT REQUIRED` — documentar el motivo.
- `REJECTED` — no usar en producción hasta resolverlo.
- `REVIEW` — cambio de términos, proveedor, región o producto pendiente de análisis.

## Registro maestro

| ID | Proveedor / servicio | Uso en BookmarkForge | Papel a confirmar | Datos o acceso potencial | Región / transferencias | Documento o enlace contractual | DPA / SCC estado | Responsable / firma | Fecha firma o aceptación | Próxima revisión | evidence_ref | Estado / siguiente acción |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P-01 | Whop | Checkout, licencia Pro, reembolsos, payouts | Merchant of record / payment provider / controller según producto | Identidad de comprador, email, datos de compra, licencia, fraude y soporte | Confirmar entidad Whop, regiones y transferencias | Seller Terms + términos del producto concreto | TO CONFIRM | [●] | [●] | [●] | `proveedores/whop/` | Solicitar por escrito quién es vendedor, quién emite recibo/factura, IVA, chargebacks, DPA y lista de subprocesadores |
| P-02 | Netlify / hosting web | Servir landing y aplicación web, si la cuenta de producción es Netlify | Processor / independent controller para logs y seguridad, a confirmar | IP, user-agent, logs, solicitudes HTTP; no enviar contenido de bóveda por diseño | Confirmar región, logs y SCC/adecuación | Terms + Data Processing Addendum + subprocessor list | TO CONFIRM | [●] | [●] | [●] | `proveedores/netlify/` | Confirmar plan, retención de logs, región y DPA aplicable |
| P-03 | GitHub | Repositorio, issues, CI/CD y colaboradores | Processor / independent controller según uso | Datos de colaboradores, incidencias, logs CI; nunca datos de bóveda | Confirmar GitHub entity, región y SCC/adecuación | GitHub DPA + Enterprise/consumer terms aplicables | TO CONFIRM | [●] | [●] | [●] | `proveedores/github/` | Mantener repositorio público sin material legal privado; revisar secretos y permisos |
| P-04 | Servicio de correo transaccional | Soporte, mensajes de servicio y onboarding, proveedor aún no fijado | Processor, a confirmar | Email, nombre opcional, contenido del mensaje y bounces | [PROVEEDOR / REGIÓN] | [Contrato + DPA + subprocesadores] | TO CONFIRM | [●] | [●] | [●] | `proveedores/email/` | Elegir proveedor antes de producción y firmar DPA antes de enviar correos reales |
| P-05 | Monitorización de errores remotos / Sentry, si está habilitado | Diagnóstico de errores con consentimiento separado | Processor / independent controller, a confirmar | Metadatos técnicos y errores; no enviar contenido de bóveda, tokens ni claves | Confirmar región, retención y SCC/adecuación | [Terms + DPA + subprocessor list] | TO CONFIRM | [●] | [●] | [●] | `proveedores/error-monitoring/` | Mantener desactivado hasta confirmar consentimiento, minimización, scrubbers y DPA |
| P-06 | Servidor de señalización / relay WebRTC | Facilitar conexión P2P; infraestructura concreta aún por confirmar | Processor / infrastructure provider, a confirmar | IP, identificadores de sesión y señalización; contenido debe viajar cifrado | [HOST / REGIÓN] | [Contrato + DPA] | TO CONFIRM | [●] | [●] | [●] | `proveedores/webrtc/` | Documentar retención de señalización, logs y que el relay no recibe contenido descifrado |
| P-07 | Proveedores de IA externos elegidos por el usuario | Solo si el usuario configura API propia o activa una función proxy | Normalmente independent controller o processor según contrato del usuario | Prompt y contenido enviado voluntariamente por el usuario; potencialmente datos de bóveda | Depende del proveedor y configuración del usuario | Provider terms; no asumir DPA de BookmarkForge | TO CONFIRM | [●] | [●] | [●] | `proveedores/ai-user-configured/` | Separar claramente proveedor elegido por usuario de proveedor contratado por BookmarkForge; documentar avisos y controles |
| P-08 | Proveedor de dominio / DNS | Dominio bookmarkforge.com, proveedor aún no confirmado | Independent controller / registrar | Datos de titularidad del dominio, contacto y logs DNS | [REGISTRAR / REGIÓN] | Registrar terms + privacy notice | NOT REQUIRED / TO CONFIRM | [●] | [●] | [●] | `proveedores/domain-dns/` | Confirmar privacidad de WHOIS/RDAP y cuenta titular |
| P-09 | Proveedor de copias o almacenamiento cloud elegido por el usuario | Backup/sync opcional iniciado por el usuario | Independent controller o processor según servicio | Datos cifrados de la bóveda y metadatos del proveedor | Depende del proveedor elegido por el usuario | User-selected provider terms | NOT REQUIRED / TO CONFIRM | [●] | [●] | [●] | `proveedores/user-cloud/` | No presentar estos proveedores como subprocesadores de BookmarkForge sin contrato y control real |

## Firma / aceptación interna

| ID proveedor | Entidad que firma | Nombre y cargo | Tipo de aceptación | Documento exacto y versión | Fecha | Evidencia hash o referencia | Revisado por privacidad | Revisado por fiscal/legal | Próxima acción |
|---|---|---|---|---|---|---|---|---|---|
| P-01 | [NOMBRE LEGAL / ENTIDAD] | [●] | [Firma / click acceptance] | [●] | [●] | [●] | [●] | [●] | Confirmar papel de Whop y conservar Seller Terms |
| P-02 | [NOMBRE LEGAL / ENTIDAD] | [●] | [●] | [●] | [●] | [●] | [●] | [●] | Confirmar hosting real antes de producción |
| P-03 | [NOMBRE LEGAL / ENTIDAD] | [●] | [●] | [●] | [●] | [●] | [●] | [●] | Confirmar GitHub DPA y accesos |
| P-04 | [NOMBRE LEGAL / ENTIDAD] | [●] | [●] | [●] | [●] | [●] | [●] | [●] | Elegir y contratar proveedor de correo |
| P-05 | [NOMBRE LEGAL / ENTIDAD] | [●] | [●] | [●] | [●] | [●] | [●] | [●] | Confirmar si monitorización remota se activa |
| P-06 | [NOMBRE LEGAL / ENTIDAD] | [●] | [●] | [●] | [●] | [●] | [●] | [●] | Fijar proveedor WebRTC y retención |
| P-07 | [NOMBRE LEGAL / ENTIDAD] | [●] | [●] | [●] | [●] | [●] | [●] | [●] | Revisar avisos para APIs configuradas por el usuario |
| P-08 | [NOMBRE LEGAL / ENTIDAD] | [●] | [●] | [●] | [●] | [●] | [●] | [●] | Confirmar registrador y privacidad de contacto |
| P-09 | [NOMBRE LEGAL / ENTIDAD] | [●] | [●] | [●] | [●] | [●] | [●] | [●] | Documentar que la elección es del usuario |

## Orden de cierre recomendado

1. **Whop** — no lanzar cobros hasta documentar vendedor, factura, IVA, reembolsos, chargebacks y DPA.
2. **Hosting y señalización WebRTC** — confirmar regiones, logs, retención y que el contenido de la bóveda no se envía en claro.
3. **Correo** — cerrar DPA antes de enviar onboarding o soporte automatizado.
4. **Monitorización de errores** — confirmar consentimiento separado, minimización y scrubbers.
5. **GitHub, dominio y herramientas internas** — cerrar acceso, retención y seguridad de cuentas.
6. **IA externa** — mantener cada proveedor como tratamiento separado y documentar si lo elige el usuario o BookmarkForge.

## Regla de firma

No marcar `SIGNED` hasta que el contrato o click-acceptance identifique a la misma persona o entidad que aparece en el aviso legal, el alta fiscal y la cuenta de Whop. Si cambia autónomo → SL, repetir la revisión y firmar de nuevo los contratos necesarios.
