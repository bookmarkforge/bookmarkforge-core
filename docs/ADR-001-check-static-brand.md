# ADR-001: Registrar `check:static-brand` en el pipeline

- **Estado:** aceptado
- **Fecha:** 2026-08-29

## Contexto

El pipeline `npm run check` ejecuta `check:static-brand`, que valida que los tokens de marca estáticos no deriven de estilos inconsistentes ni introduzcan una deriva visual no revisada.

## Decisión

Se considera un gate de calidad/meta del proyecto y queda registrado explícitamente en el freeze de inspectores. Debe continuar ejecutándose en CI y en las verificaciones locales antes de release.

## Consecuencias

Los cambios de identidad visual que rompan este gate deben actualizar de forma deliberada los tokens y sus pruebas. El registro evita que el gate aparezca como una validación no gobernada.
