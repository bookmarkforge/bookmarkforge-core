# Google Search Runbook — Search Console, sitemap y cobertura noindex de /app

- **Date:** 2026-09-09
- **Purpose:** Registrar `bookmarkforgeapp.com` en Google Search Console, enviar el sitemap y verificar que la app privada (`/app`) queda fuera del índice con las tres capas de noindex que el repo ya contrata.
- **Prerequisite:** El despliegue actual en producción es legacy y **no** sirve el build del repo (ver "Verificación con curl contra producción" en `docs/ADR-043-check-seo-gate.md`): `/sitemap.xml`, `/robots.txt` y `/app` responden 404 hoy. Este runbook asume que primero se desplegó el build actual (`node scripts/deploy-prod.mjs --deploy --verify`).

---

## 0. Lo que la capa SEO ya proporciona (verificado contra el repo)

| Superficie | Contrato | Dónde está pinneado |
|---|---|---|
| `/` → landing EN | Rewrite 200 interno; canonical EN en `/` | `scripts/nginx-render.mjs` → `public/nginx.conf`, `public/_redirects`, `netlify.toml` |
| `/ar/` … `/zh/` (30 locales) | Landings localizadas, canonical propio; los artefactos son `public/<lang>.html` | `public/_redirects` (Cloudflare/Netlify), `public/nginx.conf` (self-hosted), `check:sitemap-coverage`; la lista SEO histórica de `check:seo` se mantiene como validación complementaria |
| `/pocket-alternative` | Página comparativa EN, canonical propio | ídem + `check:seo` (`SINGLE_PAGES`) |
| `/privacy-and-terms.html` + 5 localizadas | Documentos legales, canonical y hreflang ×7 | ídem + `check:seo` (`LEGAL_PAGES`) |
| `/sitemap.xml` | 61 URLs (landings de 30 idiomas + pocket-alternative + legales de 30 idiomas + la raíz), clústeres `xhtml:link` hreflang | **Archivo manual** (`public/sitemap.xml`), pinneado por `check:seo`; el renderizador NUNCA lo regenera (A9-1) |
| `/robots.txt` | `Disallow: /app`, `/capture`, `/offline`, `/api` | Generado por `renderRobotsTxt()` (`nginx-render.mjs`) + `check:seo` |
| `/app`, `/capture`, `/offline*` | `X-Robots-Tag: noindex` por header | `public/_headers` (Cloudflare), `netlify.toml` + `check:seo` |
| Shell SPA (`index.html`) | Canonical y OG → `/` (la landing), nunca indexable | `check:seo` (`AUX_PAGES`) |
| Negociación de idioma | 302 temporal (nunca 301) a la landing localizada; el canonical EN queda en `/` | `validateLanguageNegotiation` + ADR-043 |

**Regla de oro:** todo lo que Google debe indexar son **61 URLs** estáticas: raíz + 30 landings + pocket-alternative + 30 páginas legales. Todo lo demás (`/app`, `/capture`, `/offline`, `/api`, el SPA shell) está contratado como noindex y **no** aparece en el sitemap. `npm run check:sitemap-coverage` verifica que cada `<loc>` tenga artefacto y ruta en `_redirects` y nginx.

---

## 1. Verificación local antes de tocar Search Console

El repo ya tiene los validadores; úsalos contra el dominio público **después** del despliegue:

```bash
# Contrato estático completo (canonical, hreflang, noindex, negociación…)
npm run check

# Cobertura estática: cada URL del sitemap tiene HTML + ruta en hosting/nginx
npm run check:sitemap-coverage

# Grafo hreflang histórico de las 12 páginas principales en modo live
# (la cobertura de las 30 rutas se comprueba estáticamente arriba)
node scripts/check-hreflang-graph.mjs https://bookmarkforgeapp.com

# Sitemap y robots servidos
curl -s -o /dev/null -w "sitemap: %{http_code}\n" https://bookmarkforgeapp.com/sitemap.xml
curl -s -o /dev/null -w "robots: %{http_code}\n" https://bookmarkforgeapp.com/robots.txt

# Noindex por header en /app (debe decir noindex)
curl -sI https://bookmarkforgeapp.com/app | grep -i x-robots-tag

# Negociación: fr → 302 a /fr/, en → 200
curl -s -o /dev/null -w "fr: %{http_code} -> %{redirect_url}\n" -H "Accept-Language: fr-FR,fr;q=0.9" https://bookmarkforgeapp.com/
```

Si algo falla aquí, **no** sigas: corregir y re-desplegar antes de pedirle a Google que indexe.

---

## 2. Registrar el dominio en Search Console

1. Ir a <https://search.google.com/search-console> → **Add property** → **Domain property** (recomendado: cubre `bookmarkforgeapp.com` y todos sus subdominios; la propiedad de dominio no admite verificación por HTML, solo DNS).
2. Copiar el registro TXT `google-site-verification=…` que ofrece GSC y añadirlo a la zona DNS del dominio (donde vive `bookmarkforgeapp.com` → `178.156.204.210`).
3. Verificar. El TTL típico propaga en minutos; la verificación puede tardar hasta una hora.

> El repo **no** debe versionar la etiqueta de verificación HTML: la propiedad de dominio usa DNS, así que no hay archivo que desplegar.

---

## 3. Enviar el sitemap

1. Search Console → **Sitemaps**.
2. URL: `https://bookmarkforgeapp.com/sitemap.xml`.
3. Estado esperado: **Success**. Google debe ver **61 URLs descubiertas**:
   - raíz + 30 landings (`/`, `/ar/`, …, `/zh/`) — `weekly`, priority 1.0/0.9
   - `/pocket-alternative` — `monthly`, 0.8
   - 30 legales (`/privacy-and-terms.html` + 29 localizadas) — `monthly`, 0.3
4. En el informe de páginas (o vía URL Inspection) comprobar que aparecen las 61 y **ninguna** de `/app*`, `/capture*`, `/offline*`.

**Regenerar el sitemap** (cuando cambie contenido): `public/sitemap.xml` es un **archivo manual** — se edita a mano, añadiendo el `<url>` con su clúster `xhtml:link` completo, y `check:seo` valida el resultado (landings, legales, `/app` fuera, alternates correctos). `npm run nginx:render` **no** lo toca: desde la ronda 10 (A9-1) el renderizador sólo reescribe el host dentro de `<loc>`/`xhtml:link` para propagar un cambio de `BOOKMARKFORGE_DOMAIN`, con guardas que abortan si el archivo no parece el sitemap comprometido. `lastmod` es estático a propósito (2026-09-09); se actualiza manualmente cuando las páginas cambian materialmente. Google re-rastrea el sitemap periódicamente — no hace falta re-enviarlo salvo cambios estructurales (nueva página).

> **Dueños por archivo (A9-1):** `nginx.conf` y `robots.txt` se generan wholesale desde `nginx-render.mjs`; `_headers`, `sitemap.xml` y `netlify.toml` son manuales y el renderizador sólo reescribe sus valores derivados de CSP / hosts de URL, preservando prosa y estructura. Un `--write` que encuentra un archivo dañado aborta sin escribir nada (all-or-nothing) — relevante porque `scripts/rollback.mjs` lo ejecuta durante un incidente.

---

## 4. Verificar la cobertura noindex de /app

La app privada tiene **tres capas** (todas pinneadas por `check:seo`); verifica las tres en producción:

| Capa | Dónde | Verificación |
|---|---|---|
| 1. `robots.txt` | `Disallow: /app` (+ `/capture`, `/offline`, `/api`) | `curl https://bookmarkforgeapp.com/robots.txt` |
| 2. Header HTTP | `X-Robots-Tag: noindex` en `/app`, `/app/*`, `/capture*`, `/offline*` | `curl -sI https://bookmarkforgeapp.com/app` → header presente |
| 3. Sitemap | `/app` ausente (el gate falla si aparece) | informe de sitemap de GSC |

Además, el shell SPA (`/index.html`) apunta su canonical y OG a la landing `/`, de modo que incluso un acceso directo a `/index.html` señala a la página indexable.

**En Search Console:**
- **URL Inspection** de `https://bookmarkforgeapp.com/app` → debe indicar que la URL **no está indexada** (noindex).
- Búsqueda `site:bookmarkforgeapp.com/app` → sin resultados.
- Informe **Páginas (cobertura)** → la URL debe aparecer bajo **"Excluida por la directiva noindex"**, nunca en "Indexada".

Si `/app` apareciera indexado: ejecutar `npm run check` (detecta cuál de las tres capas se perdió), corregir, re-desplegar y usar **Validación de corrección** en GSC.

---

## 5. Verificar la superficie indexada y el hreflang

1. **URL Inspection** de una muestra representativa: `/`, `/ar/`, `/es/`, `/zh/`, `/pocket-alternative`, `/privacy-and-terms.html`, `/ar/privacy-and-terms.html`. Cada una debe mostrar el canonical correcto; las landings generadas por `generate-landing-pages.mjs` declaran el conjunto de 30 idiomas + `x-default`.
2. **Idiomas:** pedir indexación de una landing localizada y confirmar que su `<head>` declara los 31 hreflang (30 idiomas + `x-default`) apuntando entre sí; repetir con una legal. `check:sitemap-coverage` valida las 30 rutas y artefactos; `scripts/check-hreflang-graph.mjs` sigue siendo el grafo live histórico de las 12 páginas principales — GSC es la confirmación independiente de que Google parsea lo mismo.
3. **Negociación:** los 302 de idioma son intencionales y temporales (nunca 301) — el canonical EN debe quedar en `/`; si el informe de cobertura mostrara duplicados entre `/` y `/fr/`, el hreflang es el mecanismo de desambiguación, no el redirect.

---

## 6. Comprobación periódica (drill ligero)

Después de cualquier cambio de contenido SEO (landing, legales, sitemap):

```bash
npm run check                      # todos los gates, incluido check:seo
node scripts/check-hreflang-graph.mjs https://bookmarkforgeapp.com   # grafos vivos
```

Y en GSC, cada 2–4 semanas: pestaña **Páginas** (errores de rastreo, "Excluida por noindex" estable) y **Sitemaps** (estado Success, 61 URLs).

---

## Rollback / gotchas

- **Nunca** convertir la negociación de idioma a 301: rompe el canonical EN de `/` (contrato en ADR-043).
- **No** añadir `/app` ni `/offline` al sitemap "para ver qué pasa": `check:seo` fallará en CI antes de llegar a producción.
- Si Google muestra la 404 de producción (sitio legacy) en lugar de las 61 URLs: el despliegue no se completó — volver a §1 y mantener A11-2 abierto en `docs/audit.md`.
- `x-default` de las landings → `/`; `x-default` de las legales → la legal EN. Cambiar uno sin el otro rompe el clúster (detectado por `check:seo` y el validador del grafo).