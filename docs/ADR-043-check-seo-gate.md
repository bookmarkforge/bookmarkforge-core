# ADR-043: Registro y documentación del gate SEO `check:seo`

- **Estado:** aceptado (implementado: `scripts/check-seo.mjs` está en la cadena `npm run check` con su suite adversarial en `scripts/__tests__/check-seo.test.mjs`)
- **Fecha:** 2026-09-09

## Contexto

La superficie indexable del sitio creció hasta 30 landings localizadas
(en/es/fr/de/pt/it y 24 locales adicionales), la página comparativa `/pocket-alternative`, el shell SPA
y la página 404 — cada una con canonical, hreflang, Open Graph, Twitter Cards
y JSON-LD propios, más un contrato noindex que mantiene la app privada fuera
del índice (`_headers`, `netlify.toml`, `robots.txt`, `offline.html` y
`sitemap.xml`). Toda esa identidad SEO dependía de convención sin verificación:
un canonical roto, un `og:image` sin asset o una fuga de `/app` en el sitemap
degradan silenciosamente el posicionamiento y la privacidad del índice, y solo
se descubren semanas después en Search Console.

El inspector freeze (O-1, `docs/ADR-028-gate-drift-detection.md`) exige que
todo gate nuevo esté gobernado: o es núcleo protegido, o está registrado en
`KNOWN_GATES` con categoría explícita, o lo justifica un ADR. `check:seo` no
es un inspector de formato de documentación (no valida `docs/`): es un
contrato de la superficie estática del producto, la misma familia que
`check:static-brand` (tokens de marca en CSS/HTML). Esta decisión lo registra
formalmente y documenta qué valida y cómo ejecutarlo, con paridad de
gobernanza con el resto de gates del repo.

## Decisión

1. **Alcance del gate.** `node scripts/check-seo.mjs` valida:
   - **Landings** (`public/landing.html` + `es/fr/de/pt/it.html`): `<html
     lang>`, `<title>`, meta description, canonical exacto, hreflang completo
     (30 idiomas + `x-default` en los artefactos generados; la familia histórica
     de seis landings sigue cubierta por el contrato primario), los 9 meta Open Graph (con `og:url` ==
     canonical y `og:image` apuntando a un asset existente en `public/`),
     Twitter Cards y JSON-LD parseable con los tipos `WebSite`,
     `Organization`, `SoftwareApplication` y `FAQPage` (con preguntas reales).
   - **Página única** (`public/pocket-alternative.html`): mismo contrato sin
     requisito de hreflang.
   - **Páginas legales** (`public/privacy-and-terms.html` + las cinco copias
     localizadas en `/es|fr|de|pt|it/privacy-and-terms.html`): canonical,
     set hreflang completo del clúster legal (30 idiomas + `x-default` en los
     artefactos generados), OG y Twitter, sin
     requisito de JSON-LD (un documento legal no declara FAQPage).
   - **Páginas auxiliares** (`index.html` y `public/404.html`): canonical +
     set OG/Twitter completo, y coherencia de identidad con la landing EN
     (`og:site_name` y `og:image` idénticos).
   - **Contratos noindex**: `X-Robots-Tag: noindex` para `/app`, `/capture` y
     `/offline*` en `_headers` y `netlify.toml`; `Disallow` en `robots.txt`;
     meta noindex en `offline.html`; y que `sitemap.xml` no liste `/app` pero
     sí las seis landings, `/pocket-alternative` y las seis páginas
     legales, y anote el set completo de alternates `xhtml:link` hreflang
     (30 idiomas + `x-default`) en cada landing (x-default → `/`) y en cada
     página legal (x-default → la EN), con el namespace `xmlns:xhtml`
     declarado — hreflang a nivel de sitemap, espejo del `<head>` HTML de
     cada clúster.
   - La identidad SEO se deriva del dominio real (`csp-config.js`), de modo
     que un cambio de `BOOKMARKFORGE_DOMAIN` no puede desincronizar el
     contrato sin que CI falle.
   - **Negociación de idioma**: la raíz `/` debe redirigir con 302 (nunca
     301 — la negociación debe seguir siendo temporal para preservar el
     canonical EN) a la landing localizada según el idioma primario de
     `Accept-Language`, tanto en `public/nginx.conf` (ruta Docker) como en
     `functions/_middleware.js` (Cloudflare Pages) y `netlify.toml`
     (reglas condicionales `conditions = { Language = [...] }` con 302,
     listadas antes del rewrite 200 de `/`), con el mismo mapa de idiomas
     y la misma semántica de idioma primario — Netlify ignora los q-values
     y matchea contra la primera lengua del header, como las regex de nginx.
   - **Preferencia manual de idioma** (para que el redirect no moleste al
     usuario que elige): el parámetro `?lang=<code>` (en los links de
     idioma de nav/footer de las landings) es la señal más fuerte —
     fija una cookie persistente (`bf_lang`, leída por nginx y el
     middleware; `nf_lang`, el override nativo de Netlify para sus
     condiciones Language) y redirige 302 a la URL limpia. La cookie, una
     vez puesta, **anula** la negociación por `Accept-Language` (incluido
     el valor `en`: "el usuario ya eligió, no re-negociar") — en nginx la
     negociación vive en el location interno `/_negotiate`, que solo se
     alcanza cuando NO hay cookie; el middleware replica la semántica; y
     `landing.js` setea ambas cookies al pulsar un link de idioma o al
     cargar con `?lang=`. El gate exige el contrato en las tres fuentes.
   - **Links de idioma visibles**: los links de idioma de nav/footer de las
     Las landings deben llevar `lang` y `hreflang` (con el mismo valor),
     apuntar a la landing correcta con `?lang=<código>`, cubrir los 6
     idiomas y enlazar la versión propia de cada página.
   - **Terminología legal consistente**: los 6 documentos de privacidad +
     términos deben mantener los términos jurídicos clave por jurisdicción
     — acrónimo GDPR correcto (RGPD en es/fr/pt, DSGVO en de, GDPR en
     en/it), ROPA, opt-in, el término de "responsable del tratamiento"
     (Verantwortlicher/titolare/…) y la frase "entitlement state" de la
     licencia (que una vez regresó como traducción literal de "rule of
     law": Estado de derecho / État du droit / Stato del diritto — el gate
     la fija en su forma inequívoca).
2. **Cómo ejecutarlo.** `npm run check:seo` (o `node scripts/check-seo.mjs`
   directamente; es un gate puro, sin `--fix` y sin dependencias fuera de
   Node core). Corre en la cadena `npm run check` y en `check:ci`. Su suite
   adversarial (`scripts/__tests__/check-seo.test.mjs`, perfil `test:slow`)
   muta cada pieza del contrato y exige que el gate la detecte.
3. **Registro en el freeze.** `check:seo` se registra en `KNOWN_GATES` de
   `scripts/check-inspector-freeze.mjs` como `meta` — la misma categoría que
   `check:static-brand` y `check:brand-logo`: no es un inspector de formato de
   documentación, por lo que no requiere ADR por O-1; este ADR documenta la
   decisión y su contrato igualmente.

## Consecuencias

- Toda adición a la superficie SEO (nuevo idioma de landing, página nueva,
  cambio de `og:image`) debe actualizar el gate a la vez: si una página
  nueva no declara el set hreflang completo o una landing queda fuera del
  sitemap, CI falla con un mensaje accionable.
- Añadir un séptimo idioma exige tocar `LANDING_LANGS`/`LANDING_LOCALES` en
  `check-seo.mjs` y `LANDING_LANGS` en `scripts/nginx-render.mjs` (más las
  reglas de servidor) — el gate señala qué falta. La entrada del sitemap se
  añade a mano en `public/sitemap.xml` (archivo manual desde A9-1; el
  renderizador sólo reescribe hosts de URL, nunca regenera).
- El contrato noindex es revocable de forma verificable: quitar un
  `Disallow` o un `X-Robots-Tag` sin tocar el gate rompe CI antes de que la
  app privada pueda aparecer en el índice.- El gate está implementado y en la cadena; este ADR registra la decisión y
  sirve de referencia canónica de qué valida y cómo ejecutarlo.

## Verificación del grafo hreflang (2026-09-09)

`scripts/check-hreflang-graph.mjs` valida sobre HTTP real los mismos
chequeos que un validador hreflang externo, para las 60 páginas localizadas actuales (30 landings + 30 legales): sets completos (30 idiomas +
`x-default`), ausencia de enlaces rotos, **bidireccionalidad** (si A
declara `es → /es/`, /es/ debe declarar `en → A`), auto-referencia,
`x-default` por clúster (landings → `/`, legales → la EN) y sin cruce
entre clústeres; además cruza el set del HTML con el `xhtml:link` del
sitemap para las 60 URLs. Verificado adversarial: quitar un alternate en
`dist/` dispara los tres tipos de fallo y el exit code 1.

```bash
npm run build
npm run preview -- --port 4173 --strictPort &
node scripts/check-hreflang-graph.mjs http://localhost:4173 --files   # local (resuelve /fr/ → /fr.html)
```

Resultado histórico del 2026-09-09: **12 páginas, 84 alternates, grafos
bidireccionales intactos, exit 0.** Los validadores externos por URL no
pueden usarse todavía: `bookmarkforge.com` sigue sirviendo el despliegue
legacy (la página legal EN responde 404 — ver la sección anterior).
Tras desplegar, repetir en modo live contra el dominio público:

```bash
node scripts/check-hreflang-graph.mjs https://bookmarkforge.com
```

## Verificación externa del sitemap (2026-09-09)

El sitemap se validó con dos validadores externos (ninguno del repo), tras
un hallazgo real que se corrigió:

1. **sitemap.js** (la librería npm oficial de sitemaps, instalada en un
directorio temporal): `XMLToSitemapItemStream` con `ErrorLevel.WARN` —
**61/61 `<url>` válidos** (changefreq, priority, límites de loc).
2. **libxml2** (el motor detrás de `xmllint`, vía `libxmljs2` con binarios
precompilados) contra el **esquema oficial de sitemaps.org**:
`processContents="lax"` en el wildcard `xs:any` (la variante `strict` de
2008 predata la extensión hreflang de Google y rechaza `xhtml:link` en
cualquier sitemap con hreflang — verificado) — **well-formed y VALID**.

**Hallazgo corregido**: el sitemap emitía `xhtml:link` entre `<loc>` y
`<lastmod>`, pero el esquema de 2008 valida la secuencia en orden
(`loc, lastmod?, changefreq?, priority?, xs:any`) y rechazaba `lastmod`.
Se reordenó el renderer para emitir los alternates **al final** del
bloque `<url>` — orden compatible con el esquema oficial y con Google/Bing
(que parsean cualquier orden). El renderer, `check:seo`, el validador del
grafo y los tests siguen verdes; el contrato del sitemap es
orden-independiente.

Los validadores web por URL (p. ej. xml-sitemaps.com, que solo acepta
`sitemapurl`) no pueden usarse hasta desplegar: producción responde 404 en
`/sitemap.xml` (sitio legacy, ver secciones anteriores).

```bash
# Reproducir (fuera del repo):
mkdir -p /tmp/smval && cd /tmp/smval && npm init -y && npm i sitemap libxmljs2
curl -sO https://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd
sed 's/processContents="strict"/processContents="lax"/' sitemap.xsd > sitemap-lax.xsd
node validate.mjs <ruta>/public/sitemap.xml sitemap-lax.xsd
```

## Verificación con curl contra producción (2026-09-09)

Comprobación real de la negociación en `https://bookmarkforge.com/` (IP
`178.156.204.210`, sin CDN delante):

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" -H "Accept-Language: fr-FR,fr;q=0.9,en;q=0.8" https://bookmarkforge.com/
```

| Accept-Language (primario) | Esperado (contrato) | Observado |
| --- | --- | --- |
| `fr-FR,fr;q=0.9,en;q=0.8` | 302 → `/fr/` | 200 (sin redirect) |
| `de-DE,de;q=0.9,en;q=0.8` | 302 → `/de/` | 200 (sin redirect) |
| `it-IT,it;q=0.9,en;q=0.8` | 302 → `/it/` | 200 (sin redirect) |
| `pt-PT,pt;q=0.9,en;q=0.8` | 302 → `/pt/` | 200 (sin redirect) |
| `es-ES,es;q=0.9,en;q=0.8` | 302 → `/es/` | 200 (sin redirect) |
| `en-US,en;q=0.9,fr;q=0.8` | 200 (EN) | 200 |
| sin header | 200 (EN) | 200 |
| `ja;q=0.9` | 200 (EN) | 200 |
| `GET /fr/` (directo) | 200 | 404 |

**Conclusión: producción NO sirve el build ni el `nginx.conf` actuales.**
La página que responde `/` es legacy — título *"Bookmark Forge - Links to
Bookmarks Converter"*, 47 329 bytes, frente a los 31 151 de `landing.html`
actual — y las 5 rutas localizadas dan 404. La negociación de idioma
(fr/de/it/pt/es → 302, EN → 200) es correcta en el artefacto del repo
(`public/nginx.conf`, verificado por `check:seo` y su suite adversarial),
pero está pendiente de despliegue: `scripts/deploy-prod.mjs --deploy
--verify` es el camino previsto. Hasta entonces, esta tabla documenta el
estado real: el contrato de producción no está cumplido.
