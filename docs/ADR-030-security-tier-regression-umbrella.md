# ADR-030: Suite paraguas de regresiones de seguridad (security tier)

- **Estado:** aceptado (implementado; este registro formaliza la decisión existente)
- **Fecha:** 2026-09-02 (retro-documentado desde el catálogo de anclas y `scripts/audit-anchors.mjs`)

## Contexto

El catálogo de anclas referencia un anchor "umbrella" que cubre **toda la
familia** `p[0-9]-*.regression.test.ts` bajo `src/tests/security/`, en lugar de
un archivo concreto: el anchor `security-tier-4-p-regression-suite` ("security
tier 4" en la terminología del catálogo). Mientras que los anchors individuales
protegen tests específicos (p0-ice-whitelist, p1-private-sync,
p2-secure-storage-prod-guard, p3-verify-password-private), el umbrella garantiza
que **ningún** test de regresión con severidad tipada pueda desaparecer del
directorio canónico sin que el gate lo detecte — incluidos los niveles de
severidad que aún no tienen anchor propio.

## Decisión

1. **Anchor umbrella de severidad.** `src/tests/security/p[0-9]-*.regression.test.ts`
   queda anclado como conjunto: si el glob no matchea ningún archivo, el gate
   `check:audit-drift` falla (ancla `security-tier-4-p-regression-suite`). El glob
   numérico `[0-9]` cubre cualquier severidad p0…p9, de modo que añadir una
   severidad nueva no exige tocar el anchor.
2. **Descubrimiento (advisory, no bloqueante por defecto).** Cualquier archivo con
   la forma canónica `src/tests/security/p[0-9]+-*.regression.test.{ts,tsx,mjs}`
   que **no** esté en el catálogo se reporta como `NEW … discovered — not yet
   anchored` (y como `discovered` en `--json`). El mensaje es informativo: la
   promoción de un archivo descubierto a anchor es un cambio a nivel ADR, no una
   acción de baseline. Con `--strict-discovery` (alias `--strict`) cualquier
   descubrimiento se vuelve un fallo duro.
3. **Promoción a anchor = cambio ADR.** Añadir o quitar una entrada individual de
   `ANCHORS[]` requiere actualizar `scripts/audit-anchors-baseline.json` (el gate
   detecta *catalog inflation* si un anchor existe en el catálogo pero no en el
   baseline, o con glob/kind distintos) y, por contrato de `AGENTS.md` §2, es un
   cambio con ancla ADR.

## Consecuencias

- La suite de regresiones de seguridad nunca puede reducirse a cero archivos por
  un limpieza agresiva o un rename erróneo – el umbrella lo detecta aunque el
  archivo concreto no tenga anchor individual.
- Nuevos tests de seguridad sin anchor aparecen en los logs del gate
  (`check:audit-drift`) como descubiertos; ignorarlos es viable a corto plazo
  pero deja una señal visible en CI, y `--strict-discovery` eleva esa deuda a
  fallo.
- El nivel "tier 4" en el catálogo es una etiqueta de la suite umbrella; los
  niveles 1–3 corresponden a los anchors individuales por severidad alta/media
  (p0–p3) heredados de ADR-026/027 y formalizados en sus ADRs.