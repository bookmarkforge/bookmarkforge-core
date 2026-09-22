# Runbook: añadir una locale a las landings

Verificación de punta a punta (2026-09-22) del flujo que el comentario de
`scripts/landing-registry.mjs` describe como *«A new locale now means ONE edit
here (plus its page, translations and share card); every layer above follows,
and the gates fail if a layer's checked-in output lags»*.

Método: clon sandbox fiel del worktree (tar de todo menos `.git`, `node_modules`
y artefactos de test) y locale 31 simulada (`sl`, esloveno), con su página,
sus dos entradas de traducción, su página legal y su manual tomados de `sv` como
sustituto de copy para poder ejecutar la cadena completa. La cadena se ejecutó
hasta quedar verde, contando y atribuyendo cada edición obligatoria. Ningún
fichero del repo se modificó para esta verificación.

**Re-verificado 2026-09-22, ya commiteado el refactor del registro**, y después
de dos cambios que mueven las cifras de este documento:

1. `check-manual-figures.mjs` deriva su lista de manuales del registro, así que
   **la traducción del manual pasa a ser una capa obligatoria** (antes era
   invisible: la lista literal de 30 ignoraba la locale nueva).
2. `check-claim-drift.mjs` añade un pin de cobertura derivado del registro:
   ninguna landing declarada puede quedar fuera de su superficie de escaneo.
   Ese pin NO vigila la existencia de la página — eso es de `check:page-figures`
   y `check:landings-fresh`.

Los números de las secciones siguientes son los de la re-verificación.

## Veredicto

La afirmación «una edición en el registro» no se sostiene en la dirección que
importa (añadir una locale). Medido: **12 ediciones en 9 ficheros, 2 ficheros
nuevos (copy y manual), 3 regeneraciones y 12 tests pineados en 9 ficheros de
test**. La mitad de esas ediciones existen porque hay capas que **no** se
derivan del registro, y hay gates que fallan con mensajes que apuntan al sitio
equivocado.

Lo que sí se sostiene: la capa de routing/edge (nginx, middleware, switcher de
las páginas, `netlify.toml`, `_redirects`) o bien se deriva del registro o es
una edición mecánica de una línea, y **todos** los huecos están cubiertos por
algún gate (ninguna locale a medias pasa la cadena en silencio), salvo los dos
puntos ciegos del apartado de huecos.

## Inventario medido

| # | Fichero | Edición | Qué la exige |
|---|---|---|---|
| L1 | `scripts/landing-registry.mjs` | +1 fila en `LANDING_LANGS` | el propio registro |
| L2 | `scripts/landing-registry.mjs` | +1 fila en `LOCALE_REGION` | silencioso: sin ella la fila sale `sl_undefined` |
| L3 | `scripts/templates/landing/landing.njk` | +1 línea literal de `<link rel="alternate" hreflang>` | `check:seo` (el `<head>` es una lista literal de 31 líneas; no hay bucle) |
| L4 | la traducción del idioma nuevo (`scripts/translations/<locale>.json`) | fichero nuevo (34 bloques de copy) | el builder detecta idiomas por los ficheros de traducción |
| L5 | `scripts/landing-translations.json` | +1 entrada | `check:landing-free-plan` (cobertura de secundarios) |
| L6 | `scripts/privacy-translations.json` | +1 entrada | `check:seo` (cobertura legal) + `check-sitemap-coverage` (página legal) |
| L7 | `scripts/check-landing-free-plan.mjs` | +1 fila en `WEDGE_TABLE` | el gate no conoce el idioma: `search="?"`, `smart="?"` |
| L8 | `public/landing.js` | +1 código en el array literal `LANG_CODES` | `check:seo` («LANG_CODES missing "sl"») |
| L9 | `public/sitemap.xml` | +1 línea de alternate en 60/61 bloques (62 ediciones) y +2 bloques nuevos (76 líneas) | `check:sitemap-coverage`. **No existe generador** |
| L10 | `public/_redirects` | +3 reglas | `check:sitemap-coverage` |
| L11 | `netlify.toml` | +1 regla `Language` (5 líneas) | `check:seo` |
| L12 | Regenerar | `npm run build:landings` (31 páginas), `generate-privacy-pages` (26 páginas), `nginx-render --write` | los gates comparan con lo versionado |
| L13 | 9 ficheros de test | 12 tests pineados con el mundo de 30 | tripwires deliberados (uno lo dice literalmente) |
| L14 | `docs/manual-usuario-<locale>.md` | fichero nuevo | `check:manual-figures` **deriva ya su lista del registro**: sin el manual, falla |

Los tests que hay que tocar y por qué:

| Fichero | Aserción |
|---|---|
| `scripts/__tests__/landing-registry.test.mjs` | 5 conteos (30/29/30/31/32) |
| `scripts/__tests__/build-landings-sync.test.mjs` | tripwire explícito: *«expected the 30-locale derivation, found 31 — update this contract when the locale set changes»* |
| `scripts/__tests__/check-seo.test.mjs` | set exacto de 30 idiomas en el `<head>` |
| `scripts/__tests__/check-landing-free-plan.test.mjs` | `WEDGE_TABLE` cubre exactamente 30 locales |
| `scripts/__tests__/check-landings-fresh.test.mjs` | contrato de 31 páginas generadas |
| `scripts/__tests__/check-page-figures.test.mjs` | árbol sintético de 61 superficies |
| `scripts/__tests__/check-sitemap-coverage.test.mjs` | lista de fallos esperados con el sitemap sintético |
| `scripts/__tests__/rollback.test.mjs` | 61 `<loc>` en el sitemap versionado |

## Qué caza cada gate, por dirección

El sistema tiene dos fuentes que deben coincidir (filas del registro y
ficheros de traducción) pero **ninguna manda sobre la otra**: el builder
detecta idiomas por `scripts/translations/*.json`, y los gates de routing se
guían por el registro. Las dos direcciones de desincronización fallan distinto.

| Dirección | Registro | Traducciones | Veredicto (medido en la re-verificación) |
|---|---|---|---|
| Solo registro (L1 sin L4) | 31 | 30 | **Fallan 6**: `check:seo`, `check:landing-free-plan`, `check:sitemap-coverage`, `check:page-figures`, `check:manual-figures` (capa nueva) y `nginx-render verify`. **Ciegos 4**: `check:landings-fresh`, `check:claim-drift`, `check:license-claims` y `check:brand-logo` |
| Solo traducción (L4 sin L1) | 30 | 31 | **Fallan 2**: `check:seo` — con el mensaje opaco «must point to undefined (found /sl/?lang=sl)» — y `check:landing-free-plan`. **Ciegos 7**: `check:sitemap-coverage`, `check:page-figures`, `check:landings-fresh`, `check:claim-drift`, `check:manual-figures`, `check:license-claims` y `nginx-render verify`. La página existe y es servible sin sitemap, sin rewrite de nginx y sin regla `Language` en Netlify |

Matiz medido en la segunda dirección: `check:claim-drift` no ve la
inconsistencia de *routing*, pero **sí police los datos** de esa página huérfana
(descubre `public/*.html` por glob): inyectándole un «5,000 bookmarks» reporta
3 claims drifted y sale 1. Lo que queda sin cubrir ahí es el enrutado, no el
contenido.

## Huecos encontrados

### El sitemap es 100 % a mano

Ningún script escribe `public/sitemap.xml` (solo lo leen validadores). Cada
locale nueva exige insertar una línea de alternate en **todos** los bloques
existentes más dos bloques nuevos, y el coste crece de forma cuadrática: cada
`<url>` lleva el set completo de alternates (31 hoy, 32 con la nueva). Añadir
la 32 exigirá ≈63 bloques modificados y ≈200 líneas.

### `check-landings-fresh` no consulta el registro

Itera el disco (`readdirSync(publicDir)`) y los ficheros de traducción. Por eso
queda verde en las **dos** direcciones de desincronización: no ve una locale
declarada sin página, ni una página huérfana sin declarar. Es el gate cuyo
trabajo es «¿está la salida versionada en sintonía con sus fuentes?» y nunca
compara con la fuente de verdad del routing. Además su detección de huérfanos
solo cubre `landing.html`, los cinco primarios y `pocket-alternative*`
(`GENERATED_NAME_RE`), así que un `public/sv.html` huérfano tampoco se detecta.

### `WEDGE_TABLE` falla culpando al copy

`check-landing-free-plan` mantiene su propio vocabulario por idioma (30 filas).
Con un idioma que no está en la tabla, el gate falla (bien: falla cerrado) pero
lo reporta como problema de copy y remata con *«Fix the COPY (preferred)»*,
cuando el arreglo real es una fila en su tabla. La tabla no tiene gate de
completitud contra el registro (a diferencia de los consumidores del registro).

### Región OG duplicada y silenciosa

`LOCALE_REGION` (registro) y `ogLocale` (fichero de traducción) declaran lo
mismo por separado. Omitir la fila del registro no falla: la fila queda
`sl_undefined` y nadie la valida contra `ogLocale`.

### Dos mundos de 30 sin gate que los una

`src/constants/locales.ts` (`SUPPORTED_LANGUAGES`, con su bucket-routing,
`CRITICAL_LOCALE_CODES` y `SMALL_FALLBACK_LOCALES`) tiene hoy exactamente los
mismos 30 códigos que el registro de landings, pero son listas independientes.
Añadir la locale 31 a las landings deja la UI de la app en 30: la landing
ofrece un idioma cuya cookie de preferencia la app no reconoce, y **ningún gate
lo detecta** (los gates de i18n y el test del middleware pasan con 31 locales
de landing y 30 de app).

### Affirmación obsoleta en el registro

El comentario del registro dice que la lógica de preferencia del navegador
(`public/landing.js`) deriva del registro «via the generated artifact». No es
exacto: `landing.js` es un fichero mantenido a mano con un array literal de 30
códigos. Lo salva que `check:seo` lo pinea contra el registro.

### La tercera lista literal de manuales

`check-license-claims.mjs` mantiene su propia lista de idiomas de manual (29 +
el master = 30), literal como la que tenía `check-manual-figures` antes de
derivarla. Medido: con el registro en 31 y un manual nuevo presente, ese gate
sigue validando 30 manuales y sale 0 — no exige el manual de la locale nueva.
Es la misma clase que se cerró en `check-manual-figures`, y se cierra igual
(una línea: `LANDING_CODES` filtrado del master).

## Cómo reproducir

1. Clon fiel: `tar -cf - --exclude=.git --exclude=node_modules . | (cd <sandbox> && tar -xf -)`.
2. Línea base: los gates del apartado de inventario en exit 0.
3. Aplicar L1 sin L4 y correr la batería (dirección «solo registro»).
4. Aplicar L4 sin L1, correr `npm run build:landings` y la batería (dirección «solo traducción»).
5. Aplicar L1-L8 + L14 (copiando la copy y el manual del idioma modelo), correr `build:landings`, `generate-privacy-pages` y `nginx-render --write`, y ver qué queda: solo el trío sin generador (L9-L11).
6. Aplicar L9-L11 contando las ediciones, y comprobar la batería en verde.
7. Correr las suites de `scripts/__tests__` en el clon de 31 locales: 12 tests pineados con el mundo de 30 repartidos en 9 ficheros, y ninguno en los tests derivados del registro (manuales y pin de cobertura sobreviven a la locale nueva).

## Recomendación

Derivar (o generar) las listas que hoy se copian a mano en tres lenguajes
distintos: los alternates del `<head>` de la plantilla, `WEDGE_TABLE`,
`LANDING_CODES` de `landing.js`, la lista de manuales de `check-license-claims`
y —sobre todo— `public/sitemap.xml`, `_redirects` y `netlify.toml`, cuyo coste
por locale es cuadrático. Un gate de completitud que exija fila en
`WEDGE_TABLE`/`LOCALE_REGION` para cada locale del registro, y un gate que
compare el mundo de landings con `SUPPORTED_LANGUAGES` (o documente que deben
divergir), cerrarían el resto.
