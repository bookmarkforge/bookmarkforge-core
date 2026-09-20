# Informe de rendimiento IA — dispositivo local — 2026-09-21

## Alcance

Se ejecutaron las dos rutas disponibles en el dispositivo local:

1. **Gate móvil emulado**, que sustituye únicamente el motor WebLLM/WebGPU y mantiene el flujo real de la aplicación.
2. **Benchmark WebLLM físico**, que exige un adaptador WebGPU de hardware y memoria suficiente.

## Resultados

### Gate móvil emulado

```text
Comando:   npm run test:ai-performance:mobile
Resultado: PASS
Tests:     1/1
Duración:  25,6 s
Perfil:    Pixel 7 — 390x844
```

Este resultado confirma que la orquestación de primera inferencia —entitlement, carga diferida, warmup, routing, cola y generación— sigue dentro del presupuesto CI de 3.000 ms en el boundary determinista.

### Benchmark físico WebLLM

```text
Comando:   npx playwright test --config=playwright.nightly.config.ts tests/e2e/ai-first-boot.nightly.spec.ts
Resultado: SKIP esperado
Tests:     0 ejecutados, 1 omitido
```

El benchmark no obtuvo evidencia física porque este dispositivo no cumple el contrato de referencia del test. El entorno Node local es `win32/arm64`; la prueba real requiere que Chromium exponga un adaptador WebGPU de hardware y memoria de dispositivo suficiente. No se generó ni se aceptó un baseline histórico físico.

## Decisión

```text
Orquestación CI:       GO
WebLLM físico local:   no evaluable en este dispositivo
Baseline físico:       pendiente
Producción IA:         NO-GO hasta una ejecución en hardware WebGPU de referencia
```

El skip es correcto y preferible a convertir una ejecución software o sin GPU en una medición engañosa. Para cerrar este punto se necesita un dispositivo con WebGPU físico; el resultado debe clasificarse con:

```bash
npm run check:ai-reference-metrics -- \
  --metrics playwright-report-nightly/first-summary-calibration.json \
  --profile desktop-reference
```
