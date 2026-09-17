# ADR-054: Tier rápido pre-commit `check:quick` y su integración en la cadena oficial

- **Estado:** aceptado (tier aditivo implementado y documentado; la integración
  en la cadena `npm run check` queda **rechazada** por ahora — ver Decisión 4)
- **Fecha:** 2026-09-17

## Contexto

La cadena `npm run check` ejecuta 40 gates en serie y tarda ~62 s en este
checkout (medición 2026-09-17: `lint` 21,0 s + `check:no-unbounded-text`
13,4 s = 55 % del total; los otros 38 gates promedian ~0,6 s). Esa cadencia es
la correcta para CI y para pre-push, pero es demasiado lenta para el bucle de
guardar-editar, donde la pregunta real es "¿qué rechazará CI?" y no "¿está
todo el repo en verde?".

Además, el orden de la cadena no prioriza los fallos históricamente más
frecuentes: un fallo de `check:boundaries` (una arista de importación nueva
entre capas) es uno de los más comunes y hoy se descubre en el puesto 8 de la
cadena, después de gates que no fallan tan a menudo.

El inspector freeze (O-1, `scripts/check-inspector-freeze.mjs`,
`docs/ADR-028-gate-drift-detection.md`) congela el crecimiento de inspectores
en la cadena: todo gate nuevo debe estar registrado en `KNOWN_GATES` o
justificado por un ADR que lo nombre. Cualquier propuesta de tier, reordenación
o consolidación necesita por tanto su propia decisión registrada. Esta ADR es
esa decisión.

## Decisión

1. **Qué es el tier.** `node scripts/check-quick.mjs` (script npm
   `check:quick`, ~2,5 s medidos) ejecuta 8 gates sub-segundo del freeze en el
   orden de fallo más probable: `check:boundaries`, `check:env`,
   `check:open-core`, `check:pro-imports`, `check:compose-config`,
   `check:runtime-config`, `check:license-keys` y
   `check:server-log-ip-privacy`. Imprime una tabla de duración por gate y es
   fail-fast: el primer gate en rojo detiene el tier y muestra su salida
   completa, que es la respuesta que el desarrollador buscaba.

2. **Contratos del tier** (fijados por
   `scripts/__tests__/check-quick.test.mjs`):
   - **Aditivo:** no forma parte de la cadena `npm run check`, por lo que el
     freeze no lo ve y no requiere registro en `KNOWN_GATES` ni ADR nominante.
   - **Selector de solo lectura:** cada entrada re-ejecuta un gate ya
     registrado en `KNOWN_GATES` (categoría `security` o `meta`); el tier no
     re-implementa ninguna validación. El test verifica el registro y que el
     script de cada entrada existe en disco, de modo que un rename en
     cualquiera de los dos sitios rompe el test y no el tier en runtime.
   - **Sub-segundo solamente:** los gates que cuestan >1 s (los dos CVE por
     red, `check:audit-drift`, `lint`, `check:no-unbounded-text`) quedan
     fuera; el test excluye explícitamente los lentos conocidos y fija el
     techo de entradas del tier.
   - **Nunca sustituye a `npm run check`:** es señal rápida, no el gate. La
     verificación completa antes de pushear sigue siendo obligatoria
     (CONTRIBUTING.md §6).

3. **Reordenación de la cadena oficial: no.** El orden actual ya es
   razonablemente fail-fast y toda reordenación cambiaría el contrato del
   freeze (`KNOWN_GATES` se mantiene ordenado y estable) y del CI sin una
   necesidad demostrada. Los dos cuellos de botella reales (`lint` 21 s,
   `check:no-unbounded-text` 13,4 s) están optimizados por diseño (lint
   acotado por lotes, corpus acotado) y no por posición en la cadena.

4. **Integración en la cadena: rechazada por ahora.** Añadir `check:quick` a
   `npm run check` duplicaría la ejecución de sus 8 gates (la cadena ya los
   corre), añadiendo ~2,5 s sin ganancia ninguna, y obligaría a registrar el
   gate en el freeze como `meta`. El valor del tier está precisamente fuera de
   la cadena. Si en el futuro la cadena gana un mecanismo de perfiles
   (p. ej. un flag que ejecute solo el tier), esta decisión se revisará; hasta
   entonces, `check:quick` permanece aditivo.

5. **Consolidación de gates: no hay y no hace falta.** Los dos gates CVE
   miden cosas distintas (pins del bloque `overrides` vs árbol declarado) y ya
   comparten una única adquisición de `npm audit --json`
   (`scripts/npm-audit-payload.mjs`). La fusión de los antiguos inspectores de
   Markdown en `check:docs-markdown` ya ocurrió (ADR-040). No queda
   solapamiento conocido entre gates.

## Consecuencias

- El bucle guardar-editar responde en <3 s; la verificación completa sigue
  siendo `npm run check` antes de pushear, documentado en CONTRIBUTING.md §6.
- Mantener el contrato de sub-segundo es un deber continuo: un gate del tier
  que crezca por encima de ~1 s debe salir de él (el test lo vigila con el
  techo de entradas y la lista de exclusiones).
- Reordenar el tier es una decisión guiada por histórico: quien sufra un
  fallo debe mover el gate más frecuente al frente y decirlo en el PR
  (contrato del encabezado del script).
- Si algún día se integra en la cadena, hay que registrar `check:quick` en
  `KNOWN_GATES` (categoría `meta`) y aceptar el doble coste de sus gates, o
  implementar antes el mecanismo de perfiles que evite la duplicación.
- El tier no introduce dependencias nuevas: solo Node core y los scripts de
  gates ya existentes.
