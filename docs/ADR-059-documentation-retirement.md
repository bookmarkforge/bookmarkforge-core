# ADR-059 — Retiro controlado de documentación

## Estado

Aceptado

## Fecha

2026-09-19

## Contexto

La documentación histórica creció junto con el producto y algunas guías dejaron de representar la arquitectura actual. Borrar archivos sin actualizar las referencias produjo fallos de CI y podía ocultar pérdida de cobertura operativa.

## Decisión

Los documentos retirados se eliminan de forma explícita y se registra el cambio en `docs/PENDIENTES.md` o en un ADR. `docs/docs-state-index.md` refleja solamente documentos presentes. El gate `check:docs-retire` impide retirar un documento que no tenga una razón y una revisión de referencias. RPO/RTO/SLO, seguridad, cumplimiento y contratos de API no pueden desaparecer sin un reemplazo equivalente.

## Consecuencias

El inventario deja de ser una lista histórica de archivos borrados y pasa a ser un catálogo verificable del checkout. Las retiradas masivas requieren revisar scripts, workflows, tests y referencias documentales antes de regenerar baselines. Esta decisión (que entró en conflicto de numeración con el ADR-026 original y por eso se renumeró) supera las mil palabras de contexto acumulado en las auditorías previas y mantiene la trazabilidad necesaria para futuros retiros.
