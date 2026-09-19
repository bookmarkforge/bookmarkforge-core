# ADR-040 — Gate unificado de documentación Markdown

## Estado

Aceptado

## Fecha

2026-09-19

## Contexto

El repositorio mantiene documentación operativa, legal, histórica y localizada. Los checks separados para jerarquía de títulos, estilo de listas, metadatos y plantilla de ADR podían divergir y permitían que una parte del corpus quedara sin cobertura después de un retiro documental.

## Decisión

`check:docs-markdown` es el único gate de formato Markdown. Escanea únicamente los documentos presentes en `docs/`, compara contra un baseline revisado y detecta reducción silenciosa de cobertura. La plantilla de ADR se valida con la misma regla ESLint que usa el lint general. El índice documental registra la presencia y el estado de cada documento.

## Consecuencias

La eliminación de documentos ya no se trata como un cambio accidental del baseline: debe acompañarse de una decisión documentada y de una revisión del índice. Los documentos críticos de operaciones, seguridad y cumplimiento deben mantenerse o sustituirse por equivalentes. El gate puede ampliarse cuando exista una revisión explícita de su baseline.
