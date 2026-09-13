# ADR-040: Fusión de los inspectores de Markdown en el gate unificado `check:docs-markdown`

- **Estado:** aceptado (implementado: `scripts/check-docs-markdown.mjs` está
  en la cadena `npm run check` con su baseline de deriva en
  `scripts/docs-markdown-baseline.json`; el freeze lo acepta vía este ADR)
- **Fecha:** 2026-09-02 (retro-documentado desde `scripts/check-inspector-freeze.mjs`)

## Contexto

El inspector freeze (O-1) y su mecanismo de verificabilidad
(`docs/ADR-028-gate-drift-detection.md`) exigen que todo inspector de formato
de documentación —un gate `check:*` cuya única función es validar la forma,
formato, volumen o higiene de los docs— justifique su existencia con un ADR.
Antes del freeze, la validación de la documentación tendía a fragmentarse en
gates por aspecto: **los tres inspectores originales de Markdown** validaban
por separado la jerarquía de encabezados, el estilo de listas y los
metadatos/estructura de los `.md` de `docs/`. Cada inspector tenía su propio
drift-baseline, su propio coste de mantenimiento y su propio camino negativo
que vigilar — tres superficies de degradación silenciosa donde bastaba una.

## Decisión

1. **Un solo gate `check:docs-markdown`.** Los tres inspectores originales se
   fusionan en un único inspector que valida forma, formato, volumen e
   higiene de los `.md` de `docs/` (jerarquía de encabezados, estilo de
   listas y metadatos mínimos), con fallos accionables por archivo y línea.
   Un solo baseline de deriva; un solo camino negativo verificable por
   gate-drift-detection (ADR-028).
2. **El gate NO se registra en `KNOWN_GATES`.** La única vía de entrada en la
   cadena es el mecanismo self-enforcing del freeze: un ADR que contenga el
   token `check:docs-markdown` en su cuerpo. **Este documento es ese ADR** —
   al añadir el script y su paso en `npm run check`, el freeze lo acepta sin
   tocar el baseline del gate (camino ya ejercitado en
   `scripts/__tests__/check-inspector-freeze.test.mjs`).
3. **Sin re-fragmentación.** Las reglas nuevas de documentación entran en el
   gate unificado (y en su único baseline), no como gates `check:docs-*`
   adicionales: crear un tercer formato de inspector de docs por necesidad
   puntual es exactamente la deriva que el freeze (O-1) prohíbe.

## Consecuencias

- Incorporar `check:docs-markdown` a `npm run check` no requiere cambiar
  `KNOWN_GATES`: el freeze encuentra el token en este ADR y lo clasifica como
  "justificado por ADR". Retirar el token de este documento antes de que el
  gate exista devuelve el freeze a su estado de rechazo — la justificación es
  revocable, no permanente.
- Un único baseline de deriva para toda la higiene de Markdown: cualquier
  regla que se debilite es detectable por un único camino negativo; no hay
  gates paralelos que degraden por separado.
- El gate está **implementado**; este ADR registra la decisión, su
  justificación y su alcance, y su baseline único de deriva materializa el
  camino negativo de ADR-028. La fusión solo es reversible mediante un ADR
  que la sustituya (no por edición silenciosa del freeze).
- Numeración: ADR-040 no pertenece al catálogo de anclas de regresión
  (`scripts/audit-anchors.mjs`, hardening de seguridad) — es gobernanza de
  gates, como ADR-028. ADR-041 queda reservado de facto para el siguiente
  registro de gobernanza; ADR-031/035/036 siguen sin asignar.
