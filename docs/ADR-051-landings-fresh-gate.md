# ADR-051: Gate de frescura de landings `check:landings-fresh`

- **Estado:** aceptado (implementado: `scripts/check-landings-fresh.mjs` con
  su suite en `scripts/__tests__/check-landings-fresh.test.mjs`, step
  «Enforce landing page freshness» en `ci.yml`)
- **Fecha:** 2026-09-17

## Contexto

`pocket-alternative.html` derivó de su JSON de traducción durante semanas: era
un HTML mantenido a mano cuya fuente de verdad evolucionó sin que nadie
regenerara la página. La sincronización de esta ronda lo curó activando su
generación en `build-landings.cjs` — pero nada impedía que la deriva
volviera: una edición manual del HTML, una plantilla tocada sin rebuild, o un
JSON actualizado con el HTML commiteado quedándose atrás, todos pasaban
desapercibidos hasta que un lector veía copy contradictorio.

Es el mismo patrón de ADR-048/049/050 (fuentes paralelas que divergen), pero
con una particularidad: aquí la verdad se materializa en archivos commiteados
(`public/*.html`), así que la validación es de **frescura** — el artifact
debe ser exactamente lo que el generador produce hoy — y no de semántica.

## Decisión

1. **Render en memoria, no rebuild + diff de worktree.** El gate renderiza
   las páginas con el mismo entorno Nunjucks, filtros y plantillas del build
   (`renderAll()`, exportado por `build-landings.cjs` para esto) y compara
   contra los archivos commiteados **sin escribir nada en `public/`**. Un
   rebuild+diff sería frágil contra la conversión CRLF del checkout y
   ensuciaría el árbol en ejecuciones locales.
2. **Comparación normalizada de EOL.** El builder escribe LF; git puede
   convertir a CRLF en Windows. Se compara tras normalizar, así un clone
   fresco no falla en falso.
3. **Contrato completo y huérfanos.** Toda página que el build produce debe
   existir y coincidir (falta = error); todo archivo en `public/` que
   calce los patrones de nombre del generador pero que el build ya no
   produzca se marca como huérfano (renombrar un output exige eliminar el
   viejo en el mismo PR). `404.html`/`404-<lang>.html` quedan exentos: son
   estáticos declarados hasta que el generador crezca soporte de 404 (TODO
   en `build-landings.cjs`).
4. **Fallo accionable.** Cada drift nombra archivo y primera línea del diff,
   con el remedio (`npm run build:landings`). Exit 2 si el render lanza —
   fallo cerrado igual que los gates de la familia.
5. **Categoría `meta` en el freeze (O-1).** No valida verdad factual (eso es
   `check:page-figures`, ADR-050) sino la relación artifact↔fuente: higiene
   de build, como `check:chunks` o `check:seo`. Esta ADR justifica el
   registro ante `KNOWN_GATES`.
6. **Cableado.** `check:landings-fresh` en `package.json`, en la cadena
   `npm run check` (junto a los gates de contenido público) y step propio en
   `ci.yml`. `build:landings` sigue siendo el único escritor de estas páginas.

## Consecuencias

- Ninguna página generada puede volver a editarse a mano: el PR que lo haga
  falla con la línea exacta del divergen.
- Cambiar plantilla o JSON sin commitar el HTML regenerado rompe CI — la
  regeneración deja de ser un paso opcional que se olvida.
- El refactor de `build-landings.cjs` (salidas exportadas, `renderAll`) es
  behavior-preserving: verificado byte a byte contra los 7 HTML previos.
- Mantenimiento: el patrón de nombre de outputs vive en una sola regex; dar
  soporte de 404 al generador será ampliar `renderAll` + la regex + esta ADR.
