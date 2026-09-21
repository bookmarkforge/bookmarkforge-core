# ADR-062 — Gate de smoke para landings

- **Estado:** aceptado
- **Fecha:** 2026-09-21

## Contexto
Las páginas públicas de entrada se sirven como HTML estático y no pasan por el shell React. Un build correcto no garantiza que las rutas, formularios, enlaces legales, SEO básico y ausencia de errores de consola funcionen en un navegador.

## Decisión
El release debe ejecutar `npm run check:landings-fresh` y `npm run check:landing-smoke` sobre las landings generadas. El primer gate compara el HTML comprometido con el render reproducible; el segundo abre las rutas con Playwright y verifica navegación, recursos críticos y errores de consola.## Criterio

Un cambio de plantilla o traducción regenera `public/` y se revisa en el mismo cambio. Un fallo de smoke bloquea el release; las comprobaciones manuales de compra, accesibilidad y consentimiento permanecen separadas y deben registrarse en el checklist de lanzamiento.

## Consecuencias

El HTML generado queda tratado como artefacto versionado y se reduce el riesgo de publicar una landing obsoleta. El gate añade una obligación de regeneración cuando cambian las fuentes y no sustituye la revisión manual de conversión, accesibilidad o cumplimiento.

