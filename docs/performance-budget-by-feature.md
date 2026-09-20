# Presupuesto de rendimiento por feature — baseline v1.0

## Objetivo

Este documento fija un presupuesto operativo antes de hacer cambios de arquitectura. La regla es optimizar primero la carga de la feature concreta que incumpla su presupuesto; no se permite mover coste al bundle inicial para mejorar una métrica local.

Los valores medidos corresponden al build local de producción y a Chromium en CI-like:

- entrada estática: **568 KiB**;
- precache: **7,28 MiB**;
- primera interacción: **553 ms** (máximo de 3 muestras);
- payload JS: **15,90 MB**;
- assets JS/CSS emitidos: **346**.

## Presupuesto por superficie

| Superficie | Medido | Presupuesto duro | Regla |
|---|---:|---:|---|
| Bootstrap/pre-unlock | 568 KiB | 768 KiB | No importar UI pesada, PDF, BlockNote, charts ni vendors AI estáticos |
| Unlock (`SecurityManager` + confirmación) | 0,25 MiB | 1,00 MiB | Criptografía y recuperación solamente |
| Shell post-unlock (`MainApp`) | 1,34 MiB | 3,00 MiB | Navegación y shell, features bajo demanda |
| Precache PWA | 7,28 MiB | 10,00 MiB | No añadir modelos o vendors pesados al precache sin revisión |
| Primera interacción | 553 ms | 2.500 ms | p95 futuro objetivo: <1.500 ms |
| Total JS/CSS emitido | 15,90 MB | 20,00 MB | Soft cap global; controlar por feature antes de alcanzar el límite |
| Total de chunks JS/CSS | 346 | 400 | Techo transitorio; no sustituye límites de tamaño |

## Presupuesto de vendors y features

| Feature/vendor | Medido aproximado | Presupuesto recomendado | Prioridad de optimización |
|---|---:|---:|---|
| Base de datos/RxDB | 352 KiB | 400 KiB | P2; mantener lazy y evitar duplicados |
| Tabla de bookmarks | 376 KiB | 450 KiB | P2; revisar virtualización antes de dividir más |
| BlockNote/editor | 775 KiB | 887 KiB | P1; solo cargar al entrar en edición |
| HTML-to-PDF | 936 KiB | 1,00 MiB | P1; no precargar |
| PDF runtime | 431 KiB + worker 1,27 MiB | 2,00 MiB combinado | P1; cargar únicamente en export/import PDF |
| Transformers web | 550 KiB | 650 KiB | P1; mantener fuera de pre-unlock |
| ONNX Runtime WASM | 22,48 MiB | 25,00 MiB | P2; no incluir en precache inicial |
| Charts/Recharts | 293 KiB | 337 KiB | P2; cargar solo en dashboards |
| WebLLM/MLC runtime (`lib-*`) | 6,03 MiB | 7,00 MiB | P0; mantener lazy y no precachear |

## Cobertura que acompaña al presupuesto

La cobertura global actual es:

```text
Statements 87,30 %
Branches   79,04 %
Functions  86,43 %
Lines      89,10 %
```

Áreas que merecen prioridad por riesgo y cobertura, sin bajar los gates actuales:

1. `src/services/security-vault`: `secrets.ts` 54,28 % de statements y `rotation.ts` 81,52 %.
2. `src/services/ai`: `ProviderManager.ts` 63,43 % y `AutoProcessorService.ts` 75,29 %.
3. `src/services`: `SecurityVault.ts` 64,36 % y `pro-access.ts` 62,65 %.
4. `src/observability`: `ObservabilityHub.ts` 62,74 %.
5. `src/utils`: `download.ts` 65,71 % y `bundleIntegrity.ts` 72,88 %.

Estas cifras no justifican una reestructuración inmediata: primero deben cubrirse los caminos de error y seguridad que explican las zonas bajas, y después medir si la cobertura mejora sin inflar el bundle.

## Gates antes de cambiar arquitectura

```bash
npm run test:coverage
npm run build:ci
npm run test:performance
npm run check:performance
npm run check:bundle-size
npm run build:budget-report -- --write --json
```

Una feature nueva debe demostrar simultáneamente:

- no aumenta el bootstrap más de 50 KiB sin aprobación explícita;
- no introduce un chunk individual por encima de su presupuesto;
- no incrementa el precache salvo que sea imprescindible para offline;
- conserva la primera interacción por debajo de 2.500 ms;
- añade tests suficientes para mantener el presupuesto de cobertura de su área.

## Hallazgo del unified budget report

El valor histórico de 100 chunks era incompatible con la topología real de lazy loading y hacía fallar el informe unificado aunque los gates de chunks pasaran. Se corrigió a un techo transitorio de 400 assets y el informe ahora consume `performance-budget-report.json` para la métrica real de primera interacción. La optimización de fondo sigue siendo reducir coste por feature, no simplemente aumentar el límite.

## Análisis del vendor de 6,03 MiB

El chunk dominante es `lib-B2_7fcn7.js` con aproximadamente **5,75 MiB**. La inspección de sus símbolos y mensajes de error identifica el runtime de **WebLLM/MLC**: `MLCEngine`, `CreateMLCEngine`, `GPUBuffer`, gestión OPFS `tvmjs-opfs-store`, configuración de modelos y ejecución WebGPU/WASM. Los chunks auxiliares `lib-CwpRtFcv.js`, `lib-jnUwXuxX.js` y `lib-C2zj-Z3W.js` son pequeños wrappers/runtime compartido.

Conclusión: no es un vendor genérico que deba dividirse sin más. Es el runtime local de IA y ya está correctamente fuera del precache por `globIgnores` de `vite.config.ts`. La optimización segura prioritaria es conservar la carga bajo demanda y medir una futura separación del runtime MLC del código de configuración/modelos; no moverlo al bootstrap ni duplicar sus dependencias.

## Gate de primera inferencia móvil

La prueba reproducible se ejecuta con:

```bash
npm run test:ai-performance:mobile
```

Emula un **Pixel 7** (`390x844`) y ejecuta el flujo real de la aplicación hasta la primera respuesta local, pero sustituye únicamente el motor WebLLM/WebGPU por un boundary determinista. Así detecta regresiones en lazy loading, entitlement, warmup, cola, routing y primera generación sin depender de una GPU concreta ni descargar gigabytes durante CI.

Presupuesto actual del boundary móvil:

```text
firstSummaryLatencyMs <= 3.000 ms
```

La prueba genera `ai-first-inference-metrics.json` como artefacto. La validación del rendimiento real del modelo continúa en `ai-startup.nightly.spec.ts`, que requiere un dispositivo con WebGPU y red/model cache controlados. No se debe interpretar el test móvil emulado como sustituto de esa medición física.

