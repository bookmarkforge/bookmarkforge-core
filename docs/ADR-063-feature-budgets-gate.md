# ADR-063 — Gate de presupuestos por feature

- **Estado:** aceptado
- **Fecha:** 2026-09-21
- **Decisores:** equipo de BookmarkForge

## Contexto

El presupuesto global de bundle detecta crecimiento agregado, pero no identifica qué feature introduce el coste. Un nuevo módulo grande podía permanecer por debajo del límite global y aun así degradar una superficie concreta como PDF, editor, base de datos o IA local.

## Decisión

Se añade `check:feature-budgets` a la cadena de `npm run check`. El gate lee `scripts/feature-budgets.json`, suma los assets emitidos que coinciden con cada feature y falla cuando:

1. una feature supera su presupuesto de bytes;
2. una feature declarada desaparece del build;
3. aparece un asset grande sin clasificación.

Los patrones ignoran el hash de Vite y se aplican sobre `dist/assets`, por lo que el gate detecta tanto regresiones de tamaño como nuevos módulos pesados.

## Relación con la gobernanza de gates

Este gate está registrado para `check-inspector-freeze`. La necesidad que evita es concreta: el crecimiento de una feature no debe ocultarse detrás del presupuesto global. Su funcionamiento es verificable por `scripts/__tests__/check-feature-budgets.test.mjs` y su alta en la cadena queda protegida por `check-inspector-freeze`, siguiendo ADR-028.

## Consecuencias

- Cada feature nueva debe añadir un patrón o demostrar que permanece por debajo del umbral de clasificación.
- Los presupuestos son límites de release, no una orden de reestructuración inmediata.
- Las actualizaciones de presupuesto requieren revisar el informe de bundle y justificar el cambio en documentación.
