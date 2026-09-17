# ADR-050: Cifras en páginas públicas y planner de actualización

- **Estado:** aceptado (implementado: `scripts/check-page-figures.mjs`,
  `scripts/plan-manual-figures-update.mjs` con sus suites en
  `scripts/__tests__/`, step «Enforce page figure claims» en `ci.yml`)
- **Fecha:** 2026-09-16

## Contexto

ADR-049 blindó los 30 manuales. En la misma ronda, la restauración del
generador de páginas legales (`generate-privacy-pages.mjs`) les añadió a las
24 páginas localizadas el esqueleto completo de precios y SLA — y la sonda de
páginas demostró que **ningún gate cubría esas superficies**:
`check-claim-drift` solo escanea `public/*.html` en la raíz (las legales viven
en `public/<locale>/privacy-and-terms.html`), y `check:manual-figures` solo
lee `docs/`. Las landings generadas y `pocket-alternative.html` — que también
afirman precios y límites — quedaban en el mismo hueco.

Además, cambiar una constante de la truth obliga a actualizar decenas de
líneas repartidas en 67 archivos; el desarrollador descubre *qué* líneas
rompiendo el gate iteración a iteración. Ese descubrimiento pertenece al
planner, no al error de CI.

## Decisión

1. **Reutilizar, no duplicar.** `check-page-figures` importa la truth y el
   evaluador de `check-manual-figures` (`loadTruth`, `allowedValueSets`,
   `evaluateManual`). Toda regla nueva que gane el gate de manuales viaja
   gratis a las páginas; no hay segunda copia de las regex que derivar.
2. **Adaptar la superficie, no las reglas.** Las páginas son HTML: el gate
   tira etiquetas por línea (los números de línea de los fallos son los del
   archivo crudo), compacta el JSON-LD inline a una línea sintética (sus
   escapes `u0026` fabricaban números) y neutraliza los precios hablados del
   competidor según la convención documentada de `patch-landing-copy.mjs`
   («28 dollars», sin `$`; nuestros precios siempre llevan `$`).
3. **Contrato de 61 superficies.** Las 30 legales localizadas (EN en la raíz)
   + 30 landings + pocket. Una página que falta se reporta como error — la
   cobertura nunca se encoge en silencio.
4. **Planner por evaluación diferencial.** El plan no reimprime regex: corre
   el evaluador compartido con un valor centinela por constante y lista las
   líneas que *dejan de pasar* (verde en el árbol actual). El baseline rojo
   aborta la planeación; una constante cuyo valor retirado sigue siendo
   canónico por otra vía (p. ej. `proPrice` 79→70 con `proRegularPrice` 79)
   produce una advertencia explícita en vez de un «0 líneas» engañoso.
5. **Registro en el freeze (O-1).** `check:page-figures` y
   `plan:manual-figures` se registran en `KNOWN_GATES` como `docs`; esta ADR
   es la justificación que exige el freeze.
6. **Cableado.** `check:page-figures` en la cadena `npm run check` y step
   propio en `ci.yml`; `plan:manual-figures` como herramienta de desarrollo
   (`node scripts/plan-manual-figures-update.mjs --set KEY=VALUE [--pages]
   [--json]`). Ambos gates solo leen fuentes incluidas en la exportación
   pública, así que el repo exportado corre la validación idéntica.

## Consecuencias

- Las páginas públicas ya no pueden afirmar una cifra que el código no
  respalda: la deriva de precios en las 24 legales localizadas que hoy no vería nadie rompe CI.
- Un cambio de constante produce, con un comando, la lista exacta de líneas de
  manuales (y páginas, con `--pages`) a actualizar — la coordinación multi-superficie deja de ser manual.
- La convención «precios del competidor sin `$`» es ahora una invariante con
  test: escribirla con `$` en una landing rompe el gate.
- Mantenimiento: las unidades por idioma viven en un solo sitio
  (`check-manual-figures.mjs`); las dos suites nuevas suman 27 casos al
  perfil bounded (~1s).
