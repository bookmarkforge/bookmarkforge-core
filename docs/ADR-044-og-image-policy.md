# ADR-044: Política de tarjetas Open Graph por página (`OG_IMAGE_POLICY`)

- **Estado:** aceptado (implementado en `scripts/check-seo.mjs`, con suite adversarial en `scripts/__tests__/check-seo.test.mjs`)
- **Fecha:** 2026-09-09

## Contexto

El sitio tiene dos tarjetas de compartir sociales en `public/`, gemelas en
estilo (fondo azul marino de marca, logo real incrustado, 1200×630):

- `og-image.png` — tarjeta general del producto ("Your Local-First Digital
  Brain").
- `og-image-pricing.png` — tarjeta de precios ("Simple, Fair Pricing" /
  "Free forever · Pro $79 one-time — no subscriptions") con las dos tier
  cards lado a lado — Free $0/mes y Pro $79 una vez, cada una con sus
  highlights — copia verificada contra la sección `#pricing` de la landing.

Al crear la tarjeta de precios quedaba sin decidir qué página debía usarla.
`og:image` es una etiqueta por URL: los crawlers ignoran los `#anclas`, así
que no existe "compartir la sección de precios" — el fragmento
`/#pricing` comparte la landing entera y su tarjeta general. La asignación se
hace a nivel de página y depende de qué vende el cuerpo de cada página. Sin
regla escrita, cada página nueva volvería a la ambigüedad que motivó
las pasadas de marca: mezclas de activos sin nadie que lo note.

El gate `check:seo` (ADR-043) ya validaba que `og:image` existiera y que el
asset estuviera en `public/`, además de exigir identidad coherente con la
landing EN en las páginas auxiliares; no decidía *qué* tarjeta corresponde a
cada página.

## Decisión

1. **Tarjeta por defecto.** Toda página usa `og-image.png` (la general del
   producto) salvo las listadas en `OG_IMAGE_POLICY`.
2. **Excepción: páginas orientadas a precios.** `/pocket-alternative` usa
   `og-image-pricing.png`: todo su cuerpo es el pitch de migración Pocket
   alrededor del tier gratuito y el Pro de $79 único (su tabla comparativa y
   su JSON-LD `Offer` declaran exactamente esos precios), así que su tarjeta
   de compartir vende los precios, no el resumen del producto.
3. **Páginas auxiliares intactas.** El shell SPA (`index.html`) y `404.html`
   siguen heredando identidad de la landing EN (coherencia de marca), es
   decir la tarjeta general; la política no les añade excepciones.
4. **Sincronía de copia en el gate de marca.** El gate
   `check:brand-logo` extiende su guarda 3 a la copia de las tarjetas: los
   textos de `og-image-pricing.svg` (nombres de tier, precios, highlights)
   deben estar respaldados por la sección `#pricing` viva de la landing EN
   (regla por tokens — un highlight puede condensar varias viñetas, pero
   ninguna palabra significativa puede quedar huérfana), y los textos de
   `og-image.svg` deben ser la copia de marca registrada en el propio gate
   (`BRAND_NAME` / `BRAND_SLOGAN` — el slogan "Your Local-First Digital
   Brain" vive solo en las tarjetas, así que el gate es su fuente única).
   Cambiar el precio de la landing sin regenerar la tarjeta —o el slogan sin
   actualizar el gate— rompe CI nombrando las palabras huérfanas.
5. **Aplicación en el gate.** `validateLandingHtml` exige ahora el valor
   exacto de `og:image` que `ogImageForFile(file)` asigna a la página
   (con `cfg.ogImage` como override opcional para los auxiliares, que
   conservan su coherencia contra la landing EN). Un `twitter:image` que no
   coincida con `og:image` ya fallaba y sigue fallando, así que ambas redes
   comparten tarjeta obligatoriamente. La política vive junto a los
   inventarios de páginas (`LANDING_PAGES`, `SINGLE_PAGES`, `LEGAL_PAGES`)
   y sus tests adversariales cubren: entrada que no corresponde a una página
   real, tarjeta errónea detectada, y las páginas reales del repositorio
   alineadas con la política.

## Consecuencias

- Añadir una página nueva la obliga a declarar (o heredar por defecto) su
  tarjeta; usar la de precios en una página sin pitch de precios —o la
  general en una futura página de pricing dedicada— rompe CI con un mensaje
  accionable (`og:image must be … per OG_IMAGE_POLICY`).
- Si algún día existe una página `/pricing` dedicada, su alta en
  `OG_IMAGE_POLICY` apuntando a `og-image-pricing.png` es una línea en el
  gate y una en la página; la documentación y la verificación ya existen.
- Las dos tarjetas siguen gemelas en estilo y verificadas por
  `check:brand-logo` (logo incrustado contra `logo-512.png`), de modo que
  cualquier tarjeta que una página comparta mantiene la marca.
- **Tarjetas localizadas (og-image-<lang>.png).** Las cinco landings locales
  (es, fr, de, pt, it) now usan su propia tarjeta (`og-image-es.png`,
  `og-image-fr.png`, `og-image-de.png`, `og-image-pt.png`, `og-image-it.png`)
  con el mismo estilo, mismo logo incrustado y mismo nombre de marca, pero con
  el eslogan traducido al idioma de esa landing (`Tu cerebro digital local y
  privado` / `Ton cerveau numérique local et privé` / `Dein lokaler und
  privater digitaler Geist` / `Seu cérebro digital local e privado` / `Il
  tuo cervello digitale locale e privato`). La política las incluye en
  `OG_IMAGE_POLICY` y el gate `check:seo` exige el valor exacto por página.
  El gate `check:brand-logo` (Guard 1) verifica que el logo incrustado de
  cada una coincide con la obra canónica, y Guard 3 verifica que el eslogan
  traducido aparece (token a token) en el `og:description` de esa misma
  landing, de modo que un cambio de copia localizada que deje huérfano el
  eslogan de la tarjeta rompe CI nombrando las palabras huérfanas.
  Las tarjetas PNG se generan a partir del mismo SVG base
  (`public/og-image.svg`) con el eslogan localizado; el proceso se documenta
  en `scripts/og-image-locale-gen.mjs` (una sola función sharp + logo
  data-URI del SVG base).
