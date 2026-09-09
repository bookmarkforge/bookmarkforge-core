# ADR-045: Registro y documentación del gate de marca `check:brand-logo`

- **Estado:** aceptado (implementado: `scripts/check-brand-logo-consistency.mjs` está en la cadena `npm run check` con su suite adversarial en `scripts/__tests__/check-brand-logo-consistency.test.mjs`)
- **Fecha:** 2026-09-09

## Contexto

La marca de BookmarkForge aparece en muchas superficies: el PWA manifest, los
manifests de la extensión, `browserconfig`, los links `favicon`/`apple-touch`
de los HTML, las data-URIs `<image>` embebidas en SVGs públicos (como la
tarjeta `og-image`) y el logo inline de las landings. Históricamente, un logo
"placeholder" estándar podía colarse de nuevo en la app, las landings o la
extensión sin que nadie lo notara: la degradación de marca era silenciosa y
solo se detectaba en revisión visual.

`check:brand-logo` cierra esa brecha con una fuente única: el arte canónico
`public/icons/logo-512.png`. El gate falla si cualquier icono PNG o SVG de
marca inline se desvía de ese canónico, de modo que un placeholder no puede
volver a entrar sin romper CI.

El inspector freeze (O-1, `docs/ADR-028-gate-drift-detection.md`) exige que
todo gate nuevo esté gobernado: o es núcleo protegido, o está registrado en
`KNOWN_GATES` con categoría explícita, o lo justifica un ADR.
`check:brand-logo` no es un inspector de formato de documentación (no valida
`docs/`): es un contrato de identidad visual del producto, la misma familia
que `check:static-brand` (tokens de marca en CSS/HTML). Esta decisión lo
registra formalmente y documenta qué valida y cómo ejecutarlo, con paridad de
gobernanza con el resto de gates del repo — en particular con `check:seo`
(`docs/ADR-043-check-seo-gate.md`), con el que comparte la categoría `meta`
en el freeze y el patrón de suite adversarial.

## Decisión

1. **Alcance del gate.** `node scripts/check-brand-logo-consistency.mjs`
   valida dos superficies:
   - **Iconos PNG** — todo icono PNG referenciado desde las superficies de
     marca conocidas (PWA manifest, manifests de la extensión,
     `browserconfig`, links `favicon`/`apple-touch` en HTML y data-URIs
     `<image>` embebidas en SVGs públicos como la tarjeta `og-image`) se
     decodifica y se compara **pixel a pixel** contra el arte canónico
     (`public/icons/logo-512.png`) tras re-muestrear a 64×64. Un icono
     ausente, no cuadrado, no decodificable o visualmente distinto hace
     fallar el gate. El umbral de similitud (`THRESHOLD`) absorbe las
     diferencias de resampler entre variantes del icono; una marca
     genuinamente distinta mide ~4× por encima del umbral.
   - **SVGs de marca inline** — los SVGs placeholder dibujados a mano
     (viewBox `"0 0 128 128"`, el antiguo path trapezoidal, los rects de
     brand-tile) en fuentes HTML/TSX/JS/SVG hacen fallar el gate: la marca
     debe ser el PNG canónico (`/logo-64.png`), nunca una aproximación
     reescrita.
2. **Gate puro y sin dependencias.** Sin `--fix`; solo Node core —
   deliberadamente **no** depende de `sharp`, de modo que corre incluso con
   un `node_modules` roto (igual que otros gates de la cadena).
3. **Cómo ejecutarlo.** `node scripts/check-brand-logo-consistency.mjs`;
   corre en la cadena `npm run check` y en `check:ci`. Su suite adversarial
   (`scripts/__tests__/check-brand-logo-consistency.test.mjs`, perfil
   `test:slow`) muta cada pieza del contrato y exige que el gate la detecte.
4. **Registro en el freeze.** `check:brand-logo` se registra en
   `KNOWN_GATES` de `scripts/check-inspector-freeze.mjs` como `meta` — la
   misma categoría que `check:static-brand` y `check:seo`: no es un
   inspector de formato de documentación, por lo que no requiere ADR por
   O-1; este ADR documenta la decisión y su contrato igualmente.

## Consecuencias

- Toda superficie nueva de marca (un icono, un manifest, un HTML) debe
  añadirse a la lista de escaneo del gate, o puede degradarse sin
  detección — el gate solo vigila lo que conoce.
- Cambiar el arte canónico (`public/icons/logo-512.png`) o regenerar los
  iconos derivados exige actualizar el gate y su suite: el re-muestreo a
  64×64 es el contrato de comparación.
- Los PNG referenciados deben ser cuadrados y decodificables; un icono
  placeholder "estándar" rompe CI antes de llegar a producción.
- El gate está implementado y en la cadena; este ADR registra la decisión y
  sirve de referencia canónica de qué valida y cómo ejecutarlo, con paridad
  de gobernanza con `docs/ADR-043-check-seo-gate.md`.