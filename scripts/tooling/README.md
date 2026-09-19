# Tooling de calidad

Esta carpeta contiene ejecutores y utilidades de desarrollo que no forman
parte del dominio de la aplicación ni de la operación del servidor.

## Lint acotado

`lint-bounded.mjs` ejecuta la misma configuración flat de ESLint por dominios y
lotes secuenciales. Evita que `eslint .` acumule todo el grafo del repositorio
en un único proceso y permite trabajar con un presupuesto de memoria explícito:

```bash
npm run lint                 # entrada recomendada; usa el ejecutor acotado
npm run lint:all             # diagnóstico/comprobación monolítica de ESLint
BMF_LINT_HEAP_MB=2048 npm run lint
BMF_LINT_BATCH_SIZE=80 npm run lint
```

El lint acotado falla en el primer lote con errores; no convierte errores en
warnings ni omite archivos. `lint:all` se conserva como control de paridad y
para diagnosticar diferencias entre lotes y la ejecución monolítica.

## Auditoría de contratos de mocks

`mock-contract-audit.mjs` compara, para cada `vi.mock(spec, factory)` de
`src/tests`, la forma que devuelve la factoría con lo que los módulos que el
test carga de verdad importan y usan en posición de valor. Detecta mocks que
sustituyen parcialmente a su módulo y solo pasan porque la rama que toca el
miembro ausente nunca se ejercita. Los hallazgos `[dir]` (módulo importado
directamente por el test) son los candidatos reales; el resto suele ser ruido
de módulos alcanzables solo por import transitivo.

```bash
node scripts/tooling/mock-contract-audit.mjs
MOCK_AUDIT_VERBOSE=1 node scripts/tooling/mock-contract-audit.mjs
MOCK_AUDIT_STRICT=1 node scripts/tooling/mock-contract-audit.mjs  # sale 1 si hay hallazgos [dir]
```

Es un informe, no un gate: no está cableado en `npm run check`.

## Informe unificado de presupuestos

`build-budget-report.mjs` genera un JSON unificado que combina los tres
perspectivas de presupuesto del proyecto:

- **Estático** (performance-budget): entry static closure, precache total, bundles totales, chunks count
- **Chunks** (check-chunk-boundaries): entry, unlock (SecurityManager + SecurityConfirmation), mainApp, precache, ort-wasm
- **Navegador** (performance-budget): firstInteractionMs

```bash
node scripts/build-budget-report.mjs           # tabla humana
node scripts/build-budget-report.mjs --json    # JSON a stdout
node scripts/build-budget-report.mjs --write   # escribe dist/reports/budget-report.json
npm run build:budget-report                    # alias en package.json
```

El JSON tiene la forma `{ generated, status, static, chunks, browser }` donde
cada campo de presupuesto es `{ budget, actual, unit }`. El status es `pass`
si todos los valores actuales ≤ presupuesto, `fail` si alguno excede, y
`skip` si dist/ no existe.

## Ruido de logs en tests

El runner acotado usa `--silent=passed-only` por defecto: conserva los
resúmenes de Vitest y muestra la salida de consola de las pruebas fallidas,
pero no inunda CI ni el terminal con logs esperados de cada caso exitoso.

```bash
npm run test:fast                 # salida acotada
BMF_TEST_LOGS=full npm run test:fast  # diagnóstico completo
```

La supresión solo afecta a la salida del proceso de Vitest; no desactiva el
buffer, sinks, telemetría ni las aserciones del logger.


- `scripts/tooling/`: utilidades de calidad, análisis estático y empaquetado.
- `scripts/testing/`: ejecutores, perfiles y reportes de pruebas.
- `scripts/security/`: gates de seguridad y cumplimiento técnico.
- `scripts/operations/`: despliegue, staging, drills y observabilidad.

La migración se realiza por etapas: primero se estabilizan los entrypoints y
los tests; después se pueden mover módulos internos. Los scripts actuales en
la raíz siguen siendo entrypoints compatibles durante la transición.
