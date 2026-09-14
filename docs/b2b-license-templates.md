# Plantillas B2B — licencias comerciales (EN/ES)

Respuestas listas para copiar cuando una empresa escribe a `sales@bookmarkforge.com` preguntando por una licencia comercial. Ancladas a `src/constants/pricing.ts` y a la decisión congelada en `docs/pricing-decision.md` (§1 y §6).

## 0. Cómo usar estas plantillas

- Responde en el **idioma del correo entrante** (inglés si hay duda).
- Rellena siempre los corchetes: `[COMPANY]`, `[PRODUCT]`, `[DATE]`, `[TIER]`.
- Los precios y nombres de licencia son los oficiales; **nunca inventes variantes**.
- Cualquier excepción (multi-año, volumen) exige antes una línea nueva en la tabla de registro de `docs/pricing-decision.md`.
- La marca (nombre, logo, dominios) **nunca se incluye** en una licencia de código — si la piden, deriva a `legal@bookmarkforge.com` (ver `TRADEMARKS.md` de la exportación pública).
- Cobro: transferencia bancaria, factura anual por adelantado, neto 30.

## 1. Respuesta inicial — calificar el caso (EN)

> Subject: Re: BookmarkForge commercial licensing
>
> Hi [NAME],
>
> Thanks for reaching out — happy to help you use BookmarkForge commercially.
>
> First, the good news: if your team runs the **unmodified** software for
> internal use, or builds on it and publishes your source under AGPL-3.0,
> you don't need a commercial license at all.
>
> A commercial license is only needed when you want to escape AGPL
> obligations. There are three kinds:
>
> | License | Typical case | Annual price |
> |---|---|---|
> | Hosting | You offer BookmarkForge (modified or not) as a network service without releasing your source | $5,000 |
> | Integration | You embed the BookmarkForge vault engine inside a proprietary product | $2,500 |
> | Redistribution | You ship a modified, closed-source build to third parties | $7,500 |
>
> Could you tell me which of these describes [COMPANY]'s use case — what
> you're building and how you plan to distribute it? I'll send the exact
> terms right away.
>
> Best regards,
> [YOUR NAME] — BookmarkForge

## 1b. Respuesta inicial (ES)

> Asunto: Re: Licencias comerciales de BookmarkForge
>
> Hola [NOMBRE]:
>
> Gracias por escribir — con gusto os ayudo a usar BookmarkForge
> comercialmente.
>
> Primero, la buena noticia: si vuestro equipo usa el software **sin
> modificar** para uso interno, o construís sobre él y publicáis vuestro
> código bajo AGPL-3.0, **no necesitáis licencia comercial**.
>
> Una licencia comercial solo hace falta para liberarse de las obligaciones
> de la AGPL. Hay tres tipos:
>
> | Licencia | Caso típico | Precio anual |
> |---|---|---|
> | Hosting | Ofrecéis BookmarkForge (modificado o no) como servicio en red sin publicar vuestro código | $5.000 |
> | Integration | Incrustáis el motor de bóveda de BookmarkForge en un producto propietario | $2.500 |
> | Redistribution | Distribuís una build modificada de código cerrado a terceros | $7.500 |
>
> ¿Me podéis contar cuál describe el caso de [COMPANY] — qué estáis
> construyendo y cómo pensáis distribuirlo? Con eso os envío los términos
> exactos de inmediato.
>
> Un saludo,
> [TU NOMBRE] — BookmarkForge

## 2. Hosting — $5.000/año (EN)

> Subject: BookmarkForge Hosting License — terms
>
> Hi [NAME],
>
> Thanks for the details. Based on what you described, the right license is
> the **BookmarkForge Hosting License**.
>
> **What it grants [COMPANY]:**
>
> - Right to run BookmarkForge (unmodified or with your private
>   modifications) as a network service under [PRODUCT], **without**
>   offering your source code to your users (AGPL §13 waived for your
>   deployment).
> - All updates released during the license term.
> - Priority email support for deployment issues.
>
> **Terms:**
>
> - Price: **$5,000 per year**, invoiced annually in advance (net 30).
> - Term: 12 months from [DATE], auto-renewal unless cancelled 30 days
>   before expiry.
> - Scope: one production deployment + staging. Additional deployments:
>   contact us.
> - Not included: the BookmarkForge name, logo or domains — those are
>   reserved trademarks and are never part of a code license.
>
> If this works for [COMPANY], reply with the billing entity name, address
> and VAT/tax ID and I'll issue the invoice today. The license agreement
> (one page) goes out with it.
>
> Best regards,
> [YOUR NAME] — BookmarkForge

## 2b. Hosting — $5.000/año (ES)

> Asunto: Licencia Hosting de BookmarkForge — condiciones
>
> Hola [NOMBRE]:
>
> Gracias por los detalles. Por lo que describís, la licencia adecuada es la
> **Licencia Hosting de BookmarkForge**.
>
> **Lo que concede a [COMPANY]:**
>
> - Derecho a ejecutar BookmarkForge (sin modificar o con modificaciones
>   privadas) como servicio en red bajo [PRODUCT], **sin** ofrecer vuestro
>   código fuente a vuestros usuarios (renuncia del §13 AGPL para vuestro
>   despliegue).
> - Todas las actualizaciones publicadas durante el plazo de la licencia.
> - Soporte prioritario por correo para incidencias de despliegue.
>
> **Condiciones:**
>
> - Precio: **$5.000 al año**, facturado anualmente por adelantado (neto 30).
> - Plazo: 12 meses desde el [FECHA], renovación automática salvo cancelación
>   con 30 días de antelación.
> - Alcance: un despliegue de producción + staging. Despliegues adicionales:
>   consultadnos.
> - No incluido: el nombre, logo o dominios de BookmarkForge — son marca
>   reservada y nunca forman parte de una licencia de código.
>
> Si os encaja, respondedme con el nombre fiscal, dirección y CIF/NIF de
> facturación y hoy mismo emito la factura. El acuerdo de licencia (una
> página) sale con ella.
>
> Un saludo,
> [TU NOMBRE] — BookmarkForge

## 3. Integration — $2.500/año (EN)

> Subject: BookmarkForge Integration License — terms
>
> Hi [NAME],
>
> Thanks for the details. Based on what you described, the right license is
> the **BookmarkForge Integration License**.
>
> **What it grants [COMPANY]:**
>
> - Right to embed the BookmarkForge vault engine inside
>   [PRODUCT] and distribute [PRODUCT] as **proprietary software**
>   (AGPL §5c waived for the combined work).
> - Your obligations: keep our copyright notices in the source, and do not
>   relicense our code itself.
> - All updates released during the license term.
>
> **Terms:**
>
> - Price: **$2,500 per year** per product, invoiced annually in advance
>   (net 30).
> - Term: 12 months from [DATE], auto-renewal unless cancelled 30 days
>   before expiry.
> - Scope: one product. Additional products or editions: contact us.
> - Not included: use of the BookmarkForge name or logo in [PRODUCT]'s
>   marketing — trademark use is a separate written permission.
>
> If this works, send me the billing entity details and I'll issue the
> invoice and the one-page license agreement today.
>
> Best regards,
> [YOUR NAME] — BookmarkForge

## 3b. Integration — $2.500/año (ES)

> Asunto: Licencia Integration de BookmarkForge — condiciones
>
> Hola [NOMBRE]:
>
> Gracias por los detalles. Por lo que describís, la licencia adecuada es la
> **Licencia Integration de BookmarkForge**.
>
> **Lo que concede a [COMPANY]:**
>
> - Derecho a incrustar el motor de bóveda de BookmarkForge dentro de
>   [PRODUCT] y distribuir [PRODUCT] como **software propietario**
>   (renuncia del §5c AGPL para la obra combinada).
> - Vuestras obligaciones: mantener nuestros avisos de copyright en el
>   código y no relicenciar nuestro código en sí.
> - Todas las actualizaciones publicadas durante el plazo de la licencia.
>
> **Condiciones:**
>
> - Precio: **$2.500 al año** por producto, facturado anualmente por
>   adelantado (neto 30).
> - Plazo: 12 meses desde el [FECHA], renovación automática salvo
>   cancelación con 30 días de antelación.
> - Alcance: un producto. Productos o ediciones adicionales: consultadnos.
> - No incluido: usar el nombre o logo de BookmarkForge en el marketing de
>   [PRODUCT] — el uso de marca requiere permiso escrito aparte.
>
> Si os encaja, enviadme los datos de facturación y hoy mismo emito la
> factura y el acuerdo de licencia de una página.
>
> Un saludo,
> [TU NOMBRE] — BookmarkForge

## 4. Redistribution — $7.500/año (EN)

> Subject: BookmarkForge Redistribution License — terms
>
> Hi [NAME],
>
> Thanks for the details. Based on what you described, the right license is
> the **BookmarkForge Redistribution License**.
>
> **What it grants [COMPANY]:**
>
> - Right to distribute a **modified, closed-source build** of
>   BookmarkForge to your customers (AGPL §6/§5c waived for your build).
> - Your obligations: keep our copyright notices, do not relicense our
>   code, and provide us reasonable attribution in your docs on request.
> - All updates released during the license term.
>
> **Terms:**
>
> - Price: **$7,500 per year**, invoiced annually in advance (net 30).
> - Term: 12 months from [DATE], auto-renewal unless cancelled 30 days
>   before expiry.
> - Scope: one product line. Distribution volume is unlimited within that
>   line.
> - Not included: the BookmarkForge name, logo or domains.
>
> If this works, send me the billing entity details and I'll issue the
> invoice and the one-page license agreement today.
>
> Best regards,
> [YOUR NAME] — BookmarkForge

## 4b. Redistribution — $7.500/año (ES)

> Asunto: Licencia Redistribution de BookmarkForge — condiciones
>
> Hola [NOMBRE]:
>
> Gracias por los detalles. Por lo que describís, la licencia adecuada es la
> **Licencia Redistribution de BookmarkForge**.
>
> **Lo que concede a [COMPANY]:**
>
> - Derecho a distribuir una **build modificada de código cerrado** de
>   BookmarkForge a vuestros clientes (renuncia de §6/§5c AGPL para vuestra
>   build).
> - Vuestras obligaciones: mantener nuestros avisos de copyright, no
>   relicenciar nuestro código y facilitarnos atribución razonable en
>   vuestra documentación si la pedimos.
> - Todas las actualizaciones publicadas durante el plazo de la licencia.
>
> **Condiciones:**
>
> - Precio: **$7.500 al año**, facturado anualmente por adelantado (neto 30).
> - Plazo: 12 meses desde el [FECHA], renovación automática salvo
>   cancelación con 30 días de antelación.
> - Alcance: una línea de producto. Volumen de distribución ilimitado dentro
>   de esa línea.
> - No incluido: el nombre, logo o dominios de BookmarkForge.
>
> Si os encaja, enviadme los datos de facturación y hoy mismo emito la
> factura y el acuerdo de licencia de una página.
>
> Un saludo,
> [TU NOMBRE] — BookmarkForge

## 5. Renovación (EN/ES, una sola plantilla)

> Subject: BookmarkForge license renewal — [TIER] / [COMPANY]
>
> Hi [NAME],
>
> Your BookmarkForge [TIER] license for [PRODUCT] expires on [DATE].
> Renewing keeps the §13/§5c waiver active for another 12 months at the
> same **[AMOUNT]**.
>
> If you'd like to renew, reply and I'll issue the invoice. If your use case
> has changed, tell me and we'll adjust the license type.
>
> Best regards,
> [YOUR NAME] — BookmarkForge

## 6. Reglas de negociación

- **Precios suelo:** los de la tabla. Ningún trato por debajo sin una entrada previa en el registro de `docs/pricing-decision.md`.
- **Multi-año:** aceptable aplicar 10% de descuento por cada año adicional prepagado (máximo 3 años), registrándolo siempre.
- **Volumen:** Hosting/Redistribution incluyen un despliegue/línea; ampliar alcance es re-cotizar, no descontar.
- **Lo que nunca se negocia:** la marca (siempre aparte, vía `legal@bookmarkforge.com`) y la exclusividad (no se vende).
- **Todo cerrado se registra:** una línea por acuerdo en el registro de cambios de `docs/pricing-decision.md` (fecha, empresa, tier, precio, duración).
