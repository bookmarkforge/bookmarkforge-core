# ADR-028: Gate-drift-detection — verificabilidad de los inspectores de documentación

- **Estado:** aceptado (implementado; este registro formaliza la decisión existente)
- **Fecha:** 2026-09-02 (retro-documentado desde `scripts/check-inspector-freeze.mjs`)

## Contexto

El proyecto gobierna sus gates por un "inspector freeze" (O-1) en
`scripts/check-inspector-freeze.mjs`: los inspectores de formato de
documentación —un gate `check:*` cuya única función es validar la forma,
formato, volumen o higiene de docs— no pueden crecer libremente. Añadir uno
nuevo exige un ADR que (a) nombre el fallo concreto que previene y (b) demuestre
que es capturable por el job negativo de **gate-drift-detection**. Un gate cuyas
reglas pueden desaparecer o degradarse sin que nadie lo note no es un gate: es
una declaración de intenciones. La decisión ADR-028 fija el mecanismo que hace
verificable ese requisito de capturabilidad.

## Decisión

1. **Gate-drift-detection como contrato de admisión.** Todo nuevo inspector de
   documentación en la cadena `npm run check` debe demostrar que su fallo está
   atrapado por un camino negativo verificable: si el gate se debilita, elimina
   o su baseline se infla, una prueba de detección de deriva lo detecta. El
   requisito (b) del freeze —"catchable by the negative-path
   gate-drift-detection job (ADR-028)"— se apoya en esta decisión.
2. **El ADR del gate debe nombrar el gate concreto.** Para ser aceptado por el
   freeze, el ADR debe contener `check:<nombre>` textualmente en su cuerpo
   (`adrNamesGate`), de modo que la justificación quede mecanizable y auditable:
   el propio freeze valida que el ADR nombre el gate antes de admitirlo.
3. **Núcleo protegido exento.** Los inspectores de seguridad (`security`) y de
   idioma (`language`) son el núcleo protegido y pueden crecer sin este gate de
   ADR; la categoría `meta` (build/chunks/lint…) tampoco lo requiere. La
   detección de deriva aplica a la categoría de documentación (y a cualquier
   gate nuevo de categoría desconocida, que por defecto se trata como `docs`).

## Consecuencias

- Un PR que añade un gate de documentación sin ADR que lo nombre y justifique
  falla `check:inspector-freeze` con un mensaje que apunta exactamente a este
  ADR (a) y (b).
- La existencia de un baseline por gate (patrón común en el repo:
  `check:audit-drift`, `check:no-unbounded-text`, `check:tailwind-drift`, …)
  materializa el "camino negativo": el baseline es el ancla de deriva que el
  gate-drift-detection vigila.
- Este ADR no está en el catálogo de anclas de regresión
  (`scripts/audit-anchors.mjs` — el catálogo cubre ADR-026/027/029+ de
  hardening); ADR-028 es gobernanza de gates y se referencia solo en prosa
  desde `check-inspector-freeze.mjs`. Su número queda ahora formalizado en el
  registro, cerrando el hueco entre ADR-027 (wave 2) y ADR-029.