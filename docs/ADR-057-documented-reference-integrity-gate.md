# ADR-057: Gate de integridad de referencias documentales

- **Estado:** aceptado (implementado en `scripts/check-documented-doc-references.mjs`)
- **Fecha:** 2026-09-18

## Contexto

La documentación operativa puede quedar aparentemente correcta después de retirar
un archivo o un endpoint: el Markdown sigue renderizando, pero el runbook conduce
a una ruta inexistente o a una evidencia que ya no está en el checkout. La retirada
del proxy de IA dejó precisamente este tipo de riesgo en probes, auditorías y
runbooks.

No es válido escanear todo el repositorio con la misma política. ADRs, auditorías
y el índice documental conservan nombres retirados como evidencia histórica. El
corpus debe centrarse en documentación viva: onboarding, workflows y documentos
marcados `vivo` en `docs/docs-state-index.md`.

## Decisión

1. Añadir `check:documented-doc-references` a la cadena oficial `npm run check`.
2. Escanear referencias concretas a archivos locales en el corpus vivo y fallar si
   el destino no existe.
3. Extraer rutas HTTP concretas y comprobarlas contra `server/src/route-table.ts`,
   respetando rutas declaradas como prefijo.
4. Ignorar familias históricas (`ADR-*`, `docs/audit.md` y el propio índice) y
   expresiones de familia con comodines, que no describen un destino único.
5. Emitir archivo, línea y referencia fallida para facilitar la corrección.
6. Registrar el gate en el inspector freeze como categoría `docs` y mantener este
   ADR como contrato de alcance.

## Consecuencias

- El borrado o renombrado de un archivo utilizado por un runbook falla localmente
  antes de llegar a revisión.
- La retirada de una ruta HTTP exige actualizar las instrucciones vivas al mismo
  tiempo que el router.
- Las auditorías históricas pueden seguir describiendo incidentes y endpoints
  retirados sin falsear el estado operativo actual.
- El detector es deliberadamente sintáctico: no demuestra que un endpoint acepte
  todos los métodos ni que una URL externa esté disponible. Esas propiedades
  siguen cubiertas por los contratos de servidor, OpenAPI, smoke y despliegue.
