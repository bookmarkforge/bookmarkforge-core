# ADR-048: Gate de licencia `check:license-claims`

- **Estado:** aceptado (implementado: `scripts/check-license-claims.mjs` está en la cadena `npm run check` con su suite en `scripts/__tests__/check-license-claims.test.mjs` y step propio en `ci.yml`)
- **Fecha:** 2026-09-16

## Contexto

BookmarkForge es MIT: lo dicen el `LICENSE` raíz, `package.json`, el modelo
Open Core (`OPEN-CORE.md`) y el `LICENSE` del repositorio público exportado.
Aun así, una ola de documentación localizada llegó a publicar **AGPL-3.0** en
treinta manuales de usuario traducidos, sus PDFs, la tabla comparativa de la
landing de Pocket, la línea de licencias comerciales de los términos legales y
los metadatos de licencia de la API OpenAPI. Es el mismo tipo de deriva que
persigue `check:claim-drift` (ADR-047), pero sobre afirmaciones legales: una
licencia citada en marketing no es un hecho de dependencia, es una promesa al
usuario, y ninguna superficie visible puede nombrar una licencia que el
proyecto no aplica.

La falla concreta que este gate previene: **deriva de licencia en el corpus
visible al usuario** — cualquier mención de AGPL/GPL/LGPL/Apache/MPL/EUPL/
EPL/CC-BY u otra licencia de terceros en manuales, landings, páginas legales o
metadatos de API, o un contrato MIT roto en `package.json`, `LICENSE` u
OpenAPI. Sin gate, esa deriva solo se detecta en revisión manual (aquí falló
durante semanas: el overlay público ya estaba corregido y las fuentes
privadas no).

Es «detectable por detección de deriva» en el sentido de ADR-028 porque el
gate es determinista y de dos direcciones: (1) escaneo negativo por tokens
denylist — inyectar cualquier token de licencia de terceros en el corpus hace
fallar CI (verificado en drill: restaurar `AGPL-3.0-or-later` en un manual
rompe el gate con exit 1); (2) claims positivos — el contrato MIT raíz
(`package.json` = `"MIT"`, `LICENSE` = texto MIT, OpenAPI = MIT, todo manual
con encabezado de licencia = MIT) debe seguir en pie. La suite adversarial
(`scripts/__tests__/check-license-claims.test.mjs`, 12 casos; el runner
bounded la colecta de `scripts/__tests__/` y corre en el job `slow-tests` de
CI) muta cada dirección en fixtures temporales y exige que el gate la
detecte.

## Decisión

1. **Alcance del corpus.** Exactamente las superficies donde una licencia es
   una afirmación: los 30 manuales de usuario (`.md`, `-styled.html`, `.pdf`)
   en `docs/`, los dos pares del overlay público
   (`scripts/public-export/manual-usuario*.md/.pdf`), la landing
   `pocket-alternative` (HTML + fuente de traducción), la página legal
   `privacy-and-terms` (HTML + fuente de traducción), `docs/openapi.yaml`,
   `package.json` y la **entrada self** de `package-lock.json`. Todo incluido
   en la exportación pública, así que el repo exportado corre el gate
   idéntico en su CI.
2. **Licencias de dependencias fuera de alcance.** Las entradas de licencia
   de las dependencias reales en `package-lock.json` son hechos, no
   afirmaciones — muchas son legítimamente Apache/BSD/otros. El gate parsea
   el JSON y valida solo `packages[""].license`, y no escanea el resto del
   lockfile. Lo mismo excluye `node_modules` por construcción.
3. **Denylist, no allowlist.** Una lista de permitidos de formulaciones MIT
   rompería la redacción legítima siguiente («dual licensed», referencias a
   NOTICE) y ocultaría exactamente la deriva que el gate existe para
   atrapar. Los tokens denegados cubren AGPL (y cualquier variante
   «Affero»), LGPL, GPLv2/v3, Apache-2.0, MPL-2.0, EUPL, EPL-2.0, BSD
   2/3-Clause, CC-BY y «proprietary license». Si aparece un falso positivo
   genuino, se estrecha el patrón en el gate — nunca se bypasea.
4. **PDFs por extracción dirigida.** Los PDFs no llevan texto plano: el
   extractor reconstruye runs ASCII imprimibles y filtra por vocabulario de
   licencias, robusto a la fragmentación de operadores de texto del
   generador (pdfkit). La regeneración de los 30 PDFs es
   `npm run docs:pdf:localized`; el gate valida el artefacto, no el proceso.
5. **Registro en el freeze (O-1).** `check:license-claims` se registra en
   `KNOWN_GATES` como `docs` — la misma categoría que `check:claim-drift`:
   valida la verdad de afirmaciones visibles al usuario (aquí legales,
   allí numéricas) y no es un inspector de formato de Markdown. Esta ADR
   es la justificación que exige el freeze; el registro mantiene ordenado
   `KNOWN_GATES`.
6. **Cableado.** `check:license-claims` en `package.json`, dentro de la
   cadena `npm run check` (después de `check:pocket-onboarding-copy`,
   agrupado con los gates de contenido visible), y **step propio** en
   `ci.yml` («Enforce MIT license claims») para que una deriva de licencia
   se vea como check rojo separado, no enterrada en el agregador — mismo
   patrón que `check:brand-logo` y `check:claim-drift`.

## Consecuencias

- Cualquier reintroducción de AGPL u otra licencia de terceros en manuales,
  PDFs, landings, legales o metadatos de API rompe CI con un mensaje que
  nombra el archivo y el patrón.
- El contrato MIT raíz está anclado: cambiar `package.json` fuera de `MIT`,
  intercambiar el texto de `LICENSE` o sacar MIT de OpenAPI rompe el gate
  aunque ningún documento lo mencione.
- Mantenimiento: una nueva licencia de terceros que un tercero podría citar
  se añade como token denylist (una línea). Un falso positivo se estrecha
  como patrón (una línea). El inventario del corpus está centralizado en
  `corpusEntries()`.
