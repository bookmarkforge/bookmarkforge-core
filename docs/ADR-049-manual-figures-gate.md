# ADR-049: Gate de cifras `check:manual-figures`

- **Estado:** aceptado (implementado: `scripts/check-manual-figures.mjs` está en la cadena `npm run check` con su suite en `scripts/__tests__/check-manual-figures.test.mjs` y step propio en `ci.yml`)
- **Fecha:** 2026-09-16

## Contexto

Tras corregir la deriva de licencia (ADR-048), una auditoría de cifras sobre
los 30 manuales traducidos confirmó que los manuales estaban limpios — pero
destapó que la **misma clase de deriva** existía en las fuentes de precios:
`scripts/privacy-translations.json` y `docs/pricing-decision.md` anunciaban
Free con «1 dispositivo» mientras el código (`src/constants/pricing.ts`) dice
explícitamente «Works on any device — each keeps its own vault». El hallazgo
siguió el patrón de ADR-048: fuentes paralelas que se quedan atrás del código
sin que nadie lo note hasta que un lector lo sufre.

Los manuales son la superficie con más cifras por palabra del proyecto:
precios ($0/$59/$79/$89/$35/$99/$39), límites (1.000 marcadores Free,
dispositivos, 200 early birds, 100 founders), plazos (reembolso 30 días,
revalidación de licencia cada 48 horas) y política (frase de recuperación de
24 palabras, contraseña mínima de 12 caracteres). Hoy ninguna barrera evita
que una edición manual —o una traducción nueva— introduzca una cifra que el
código ya no respeta.

Es «detectable por detección de deriva» en el sentido de ADR-028: el gate es
determinista y de dos direcciones. (1) **Truth parseada del código**: el gate
extrae los valores canónicos de `src/constants/pricing.ts`,
`src/constants/license.ts` (`cacheTtlMs`), `src/constants/config.ts`
(`MIN_PASSWORD_LENGTH`) y `src/services/RecoveryService.ts` (`wordCount`),
sin duplicarlos; si una constante se renombra, el gate falla cerrado en vez
de adivinar. (2) **Reglas direccionales**: toda línea del manual que afirma
un precio, un límite de dispositivos, un tope de marcadores, un plazo de
reembolso, una ventana de revalidación, un recuento de palabras de recuperación
o un porcentaje de descuento debe coincidir con el código. Inyectar «$69» o
«up to 5 devices» en un manual rompe CI (verificado en drill). La suite
adversarial (`scripts/__tests__/check-manual-figures.test.mjs`, 14 casos; el
runner bounded la colecta de `scripts/__tests__/` y corre en el job
`slow-tests` de CI) muta la verdad y los manuales en fixtures temporales y
exige que el gate detecte cada dirección.

## Decisión

1. **Alcance.** Los 30 `docs/manual-usuario*.md` — la fuente de la que se
   generan los PDFs y los `-styled.html` (`npm run docs:pdf:localized`), y el
   set completo que viaja en la exportación pública. Validar el Markdown es
   validar la familia entera; los artefactos generados se cubren al
   regenerarse de estas fuentes.
2. **Sin duplicar la verdad.** Los valores canónicos se parsean del código en
   cada ejecución. Cambiar un precio en `pricing.ts` sin actualizar los
   manuales rompe el gate inmediatamente — y mover el precio *sí* requiere
   tocar primero el código, que es donde vive la verdad.
3. **Reglas por contexto, no globales.** Un número en un manual no es
   automáticamente una afirmación: pasos numerados, versiones de producto
   (v2/v3), el token P2P, años y porcentajes sin contexto de descuento son
   ruido y se descartan. Cada regla exige su sustantivo y su contexto en los
   30 idiomas («hasta 3», «最大3台», «bis zu drei»), con marcadores de
   «sin límite» por idioma (incluidas negaciones compuestas como «nu are
   limită de dispozitive», que solo existen en la línea cruda). El precio de
   owner de v3 ($39) se deriva del descuento (`floor(99 × 0.4)`), sin
   introducir una tercera fuente de verdad.
4. **Direccional, no de inventario.** El gate valida lo que los manuales
   *dicen*; que una cifra esté presente es trabajo de `check:claim-drift`
   sobre las superficies de la app. Ausencia de precios en los manuales
   condensados no es un error.
5. **Registro en el freeze (O-1).** `check:manual-figures` se registra en
   `KNOWN_GATES` como `docs` — la misma categoría que `check:claim-drift` y
   `check:license-claims`: valida la verdad de afirmaciones visibles al
   usuario. Esta ADR es la justificación que exige el freeze.
6. **Cableado.** `check:manual-figures` en `package.json`, en la cadena
   `npm run check` (agrupado con los gates de contenido visible, detrás de
   `check:license-claims`), y **step propio** en `ci.yml` («Enforce manual
   figure claims») para que una deriva de cifras se vea como check rojo
   separado — mismo patrón que `check:license-claims` y `check:claim-drift`.
   El gate solo lee fuentes incluidas en la exportación pública, así que el
   repo exportado corre el gate idéntico en su CI.

## Consecuencias

- Cualquier cifra que diverja del código en cualquier idioma rompe CI con un
  mensaje que nombra archivo, línea y el valor canónico esperado.
- Cambiar una constante de precio/límite/plazo en el código exige actualizar
  los 30 manuales en el mismo PR — exactamente la coordinación que falló dos
  veces («1 device», AGPL).
- Mantenimiento: un idioma nuevo en los manuales añade su sustantivo y sus
  marcadores a las regex de contexto (una línea por regex). Un falso positivo
  se estrecha como patrón — nunca se bypasea el gate.
