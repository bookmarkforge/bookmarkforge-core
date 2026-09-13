# Google Search Runbook — Search Console, sitemap y cobertura noindex de /app

- **Date:** 2026-09-09
- **Purpose:** Registrar `bookmarkforge.com` en Google Search Console, enviar el sitemap y verificar que la app privada (`/app`) queda fuera del índice con las tres capas de noindex que el repo ya contrata.
- **Prerequisite:** El despliegue actual en producción es legacy y **no** sirve el build del repo (ver "Verificación con curl contra producción" en `docs/ADR-043-check-seo-gate.md`): `/sitemap.xml`, `/robots.txt` y `/app` responden 404 hoy. Este runbook asume que primero se desplegó el build actual (`node scripts/deploy-prod.mjs --deploy --verify`).

---

## 0. Lo que la capa SEO ya proporciona (verificado contra el repo)

| Superficie | Contrato | Dónde está pinneado |
|---|---|---|
| `/` → landing EN | Rewrite 200 interno; canonical EN en `/` | `scripts/nginx-render.mjs` → `public/nginx.conf`, `public/_redirects`, `netlify.toml` |
| `/fr/`, `/es/`, `/de/`, `/pt/`, `/it/` | Landings localizadas, canonical propio | ídem + `check:seo` (`LANDING_PAGES`) |
| `/pocket-alternative` | Página comparativa EN, canonical propio | ídem + `check:seo` (`SINGLE_PAGES`) |
| `/privacy-and-terms.html` + 5 localizadas | Documentos legales, canonical y hreflang ×7 | ídem + `check:seo` (`LEGAL_PAGES`) |
| `/sitemap.xml` | 13 URLs (6 landings + pocket + 6 legales), `xhtml:link` hreflang en 2 clústeres, orden compatible con el XSD oficial | `renderSitemap()` + `check:seo` + validación externa (libxml2/sitemap.js, ADR-043) |
| `/robots.txt` | `Disallow: /app`, `/capture`, `/offline`, `/api` | `renderRobotsTxt()` + `check:seo` |
| `/app`, `/capture`, `/offline*` | `X-Robots-Tag: noindex` por header | `public/_headers` (Cloudflare), `netlify.toml` + `check:seo` |
| Shell SPA (`index.html`) | Canonical y OG → `/` (la landing), nunca indexable | `check:seo` (`AUX_PAGES`) |
| Negociación de idioma | 302 temporal (nunca 301) a la landing localizada; el canonical EN queda en `/` | `validateLanguageNegotiation` + ADR-043 |

**Regla de oro:** todo lo que Google debe indexar son **13 URLs** estáticas; todo lo demás (`/app`, `/capture`, `/offline`, `/api`, el SPA shell) está contratado como noindex y **no** aparece en el sitemap (el gate falla si `/app` se cuela).

---

## 1. Verificación local antes de tocar Search Console

El repo ya tiene los validadores; úsalos contra el dominio público **después** del despliegue:

```bash
# Contrato estático completo (canonical, hreflang, noindex, negociación…)
npm run check

# Grafo hreflang de las 12 páginas en modo live (enlaces rotos, bidireccionalidad)
node scripts/check-hreflang-graph.mjs https://bookmarkforge.com

# Sitemap y robots servidos
curl -s -o /dev/null -w "sitemap: %{http_code}\n" https://bookmarkforge.com/sitemap.xml
curl -s -o /dev/null -w "robots: %{http_code}\n" https://bookmarkforge.com/robots.txt

# Noindex por header en /app (debe decir noindex)
curl -sI https://bookmarkforge.com/app | grep -i x-robots-tag

# Negociación: fr → 302 a /fr/, en → 200
curl -s -o /dev/null -w "fr: %{http_code} -> %{redirect_url}\n" -H "Accept-Language: fr-FR,fr;q=0.9" https://bookmarkforge.com/
```

Si algo falla aquí, **no** sigas: corregir y re-desplegar antes de pedirle a Google que indexe.

---

## 2. Registrar el dominio en Search Console

1. Ir a <https://search.google.com/search-console> → **Add property** → **Domain property** (recomendado: cubre `bookmarkforge.com` y todos sus subdominios; la propiedad de dominio no admite verificación por HTML, solo DNS).
2. Copiar el registro TXT `google-site-verification=…` que ofrece GSC y añadirlo a la zona DNS del dominio (donde vive `bookmarkforge.com` → `178.156.204.210`).
3. Verificar. El TTL típico propaga en minutos; la verificación puede tardar hasta una hora.

> El repo **no** debe versionar la etiqueta de verificación HTML: la propiedad de dominio usa DNS, así que no hay archivo que desplegar.

---

## 3. Enviar el sitemap

1. Search Console → **Sitemaps**.
2. URL: `https://bookmarkforge.com/sitemap.xml`.
3. Estado esperado: **Success**. Google debe ver **13 URLs descubiertas**:
   - 6 landings (`/`, `/es/`, `/fr/`, `/de/`, `/pt/`, `/it/`) — `weekly`, priority 1.0/0.9
   - `/pocket-alternative` — `monthly`, 0.8
   - 6 legales (`/privacy-and-terms.html` + 5 localizadas) — `monthly`, 0.3
4. En el informe de páginas (o vía URL Inspection) comprobar que aparecen las 13 y **ninguna** de `/app*`, `/capture*`, `/offline*`.

**Regenerar el sitemap** (cuando cambie contenido): la fuente de verdad es `scripts/nginx-render.mjs` — `node scripts/nginx-render.mjs --write` y luego `npm run check` (el `--check` del renderer y `check:seo` detectan drift). `lastmod` es estático a propósito (2026-09-09) para no romper la comparación byte-idéntica del gate; se actualiza manualmente en el renderer cuando las páginas cambian materialmente. Google re-rastrea el sitemap periódicamente — no hace falta re-enviarlo salvo cambios estructurales (nueva página).

---

## 4. Verificar la cobertura noindex de /app

La app privada tiene **tres capas** (todas pinneadas por `check:seo`); verifica las tres en producción:

| Capa | Dónde | Verificación |
|---|---|---|
| 1. `robots.txt` | `Disallow: /app` (+ `/capture`, `/offline`, `/api`) | `curl https://bookmarkforge.com/robots.txt` |
| 2. Header HTTP | `X-Robots-Tag: noindex` en `/app`, `/app/*`, `/capture*`, `/offline*` | `curl -sI https://bookmarkforge.com/app` → header presente |
| 3. Sitemap | `/app` ausente (el gate falla si aparece) | informe de sitemap de GSC |

Además, el shell SPA (`/index.html`) apunta su canonical y OG a la landing `/`, de modo que incluso un acceso directo a `/index.html` señala a la página indexable.

**En Search Console:**
- **URL Inspection** de `https://bookmarkforge.com/app` → debe indicar que la URL **no está indexada** (noindex).
- Búsqueda `site:bookmarkforge.com/app` → sin resultados.
- Informe **Páginas (cobertura)** → la URL debe aparecer bajo **"Excluida por la directiva noindex"**, nunca en "Indexada".

Si `/app` apareciera indexado: ejecutar `npm run check` (detecta cuál de las tres capas se perdió), corregir, re-desplegar y usar **Validación de corrección** en GSC.

---

## 5. Verificar la superficie indexada y el hreflang

1. **URL Inspection** de un puñado de URLs canónicas: `/`, `/es/`, `/fr/`, `/de/`, `/pt/`, `/it/`, `/pocket-alternative`, `/privacy-and-terms.html`, `/es/privacy-and-terms.html`. Cada una debe mostrar el canonical correcto y su set hreflang en el HTML renderizado.
2. **Idiomas:** pedir indexación de una landing localizada y confirmar que su `<head>` declara los 7 hreflang (6 idiomas + `x-default`) apuntando entre sí; repetir con una legal. El grafo completo ya lo valida `scripts/check-hreflang-graph.mjs` (modo live) — GSC es la confirmación independiente de que Google parsea lo mismo.
3. **Negociación:** los 302 de idioma son intencionales y temporales (nunca 301) — el canonical EN debe quedar en `/`; si el informe de cobertura mostrara duplicados entre `/` y `/fr/`, el hreflang es el mecanismo de desambiguación, no el redirect.

---

## 6. Comprobación periódica (drill ligero)

Después de cualquier cambio de contenido SEO (landing, legales, sitemap):

```bash
npm run check                      # todos los gates, incluido check:seo
node scripts/check-hreflang-graph.mjs https://bookmarkforge.com   # grafos vivos
```

Y en GSC, cada 2–4 semanas: pestaña **Páginas** (errores de rastreo, "Excluida por noindex" estable) y **Sitemaps** (estado Success, 13 URLs).

---

## Rollback / gotchas

- **Nunca** convertir la negociación de idioma a 301: rompe el canonical EN de `/` (contrato en ADR-043).
- **No** añadir `/app` ni `/offline` al sitemap "para ver qué pasa": `check:seo` fallará en CI antes de llegar a producción.
- Si Google muestra la 404 de producción (sitio legacy) en lugar de las 13 URLs: el despliegue no se completó — volver a §1.
- `x-default` de las landings → `/`; `x-default` de las legales → la legal EN. Cambiar uno sin el otro rompe el clúster (detectado por `check:seo` y el validador del grafo).