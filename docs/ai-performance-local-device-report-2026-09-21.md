# AI performance report — local device — 2026-09-21

## Scope

The two available routes on the local device were executed:

1. **Emulated mobile gate**, which only replaces the WebLLM/WebGPU engine and keeps the real application flow.
2. **Physical WebLLM benchmark**, which requires a hardware WebGPU adapter and sufficient memory.

## Results

### Emulated mobile gate

```text
Command:   npm run test:ai-performance:mobile
Result:    PASS
Tests:     1/1
Duration:  25.6 s
Profile:   Pixel 7 — 390x844
```

This result confirms that the first-inference orchestration —entitlement, lazy load, warmup, routing, queue and generation— remains within the CI budget of 3,000 ms on the deterministic boundary.

### Physical WebLLM benchmark

```text
Command:   npx playwright test --config=playwright.nightly.config.ts tests/e2e/ai-first-boot.nightly.spec.ts
Result:    Expected SKIP
Tests:     0 executed, 1 skipped
```

The benchmark did not obtain physical evidence because this device does not meet the test's reference contract. The local Node environment is `win32/arm64`; the real test requires Chromium to expose a hardware WebGPU adapter and sufficient device memory. No historical physical baseline was generated or accepted.

## Decision

```text
CI orchestration:       GO
Local physical WebLLM:  not evaluable on this device
Physical baseline:      pending
AI production:          NO-GO until execution on reference WebGPU hardware
```

The skip is correct and preferable to converting a software or non-GPU execution into a misleading measurement. To close this point, a device with physical WebGPU is needed; the result must be classified with:

```bash
npm run check:ai-reference-metrics -- \
  --metrics playwright-report-nightly/first-summary-calibration.json \
  --profile desktop-reference
```
