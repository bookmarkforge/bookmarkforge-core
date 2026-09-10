# Entrada en el inventario de scripts: límites del scanner

- **Estado:** activo; documentación operativa del gate `check:audit-script-snapshot`.
- **Propietario:** mantenedor del proyecto.
- **Última revisión:** 2026-09-10.

## Propósito

El gate `check:audit-script-snapshot` (y su snapshot `.tmp-audit-script-candidates.txt`)
mantienen una lista de **candidatos sin referencias conocidas** en `scripts/`. Esta
lista es el resultado de un escáner estático que recorre el repositorio buscando
referencias a archivos de `scripts/`.

Este documento enumera lo que **el escáner no puede ver**, para que los revisores
de limpieza sepan que la lista de candidatos es un **límite inferior**, no un
inventario exhaustivo de lo que está vivo.

## Lo que el scanner detecta

El escáner busca, de forma estática:

- Importaciones `import ... from "scripts/..."` y `require("scripts/...")`.
- Referencias de ruta en archivos JS/CSS/HTML/JSON/YAML/TOML del repo.
- Referencias en `package.json` → `scripts.*`.
- Referencias en `.github/workflows/*.yml` (solo `ci.yml` y los workflows que el
  scanner configura explícitamente).
- Referencias en archivos de configuración del proyecto (docker-compose, Dockerfile,
  netlify, nginx, etc.) cuando aparecen como strings literales.

## Lo que el scanner NO detecta (limbite inferior)

### 1. Rutas construidas en tiempo de ejecución (runtime data-driven joins)

El scanner no ejecuta código. Si un script construye la ruta a otro script en
tiempo de ejecución, el scanner no ve la dependencia.

Ejemplo documentado: `scripts/build-ci.mjs` hace:

```js
const rollupWasmLoader = join(ROOT, "scripts", "rollup-wasm-loader.cjs");
const useRollupWasm = process.platform === "win32" && process.arch === "arm64";
const nodeOptions = [process.env.NODE_OPTIONS, useRollupWasm
  ? `--require=${rollupWasmLoader}` : ""].filter(Boolean).join(" ");
```

El scanner estático no ve que `build-ci.mjs` requiere `rollup-wasm-loader.cjs`
solo en `win32 && arm64`. En la máquina actual (win32/arm64) el loader está
activo; en otras plataformas no. El scanner género la lista de candidatos
puede marcar `rollup-wasm-loader.cjs` como "sin referencias conocidas" aunque
tenga un uso real condicional.

**Implicación:** un archivo marcado como candidato puede tener una referencia
condicional dependiente de plataforma, entorno, variable de entorno o estado
en tiempo de ejecución. Antes de eliminar cualquier candidato, revisar si hay
uso condicional en los scripts que lo podrían cargar.

### 2. Referencias en archivos de configuración que el scanner no recorre

El scanner recorre solo los archivos que configura explícitamente. Si un archivo
de configuración externo (por ejemplo, un Makefile, un script de despliegue externo,
un runbook de operaciones, un script de CI externo, un hook de git) referencia un
script de `scripts/`, el scanner no lo ve.

**Implicación:** antes de eliminar un candidato, revisar también `docs/`, `AGENTS.md`,
`README.md`, `.github/`, `docker-compose*.yml`, `Dockerfile`, `netlify.toml`,
`public/nginx.conf`, `functions/`, y cualquier otro archivo de configuración de
despliegue o operaciones que pueda invocar el script.

### 3. Nombres de scripts construidos a partir de configuración

Si un script usa un nombre de otro script que se construye a partir de una
variable de configuración (por ejemplo, `join(ROOT, "scripts", config.scriptName)`),
el scanner no ve la dependencia porque el nombre no es un literal en el código.

**Implicación:** los scripts que leen nombres de otros scripts desde config,
environment variables, o datos en tiempo de ejecución no son detectados.

### 4. Scripts invocados por nombre en shells, runbooks, o documentación operativa

El scanner no ejecuta ni analiza shells históricos, ni runbooks de operaciones, ni
documentación que describa comandos para desplegar, revertir, o diagnosticar. Si
un operador o un runbook ejecuta `node scripts/shutdown.mjs` como parte de un
procedimiento, el scanner no lo registra como referencia.

**Implicación:** revisar también `docs/operations.md`, `docs/staging-smoke.md`,
`docs/launch-checklist.md`, `docs/ops-nightly.md`, y cualquier runbook de operaciones
antes de eliminar un candidato que pueda ser invocado por nombre en procedimientos
de despliegue o recuperación.

### 5. Scripts que son "candidatos" pero tienen referencias condicionales de plataforma

El scanner no distingue entre "nunca referenciado" y "referenciado solo en cierta
plataforma". Un script como `rollup-wasm-loader.cjs` puede aparecer en la lista de
candidatos aunque tenga un uso real en `win32/arm64`.

**Implicación:** la lista de candidatos es un límite inferior. Un candidato no
eliminado no prueba que esté muerto; solo prueba que el scanner estático no lo
vió referenciado. La decisión de eliminar requiere revisión manual de los casos
condicionales antes descritos.

## Reglas de decisión para la limpieza

1. **La lista de candidatos es un límite inferior, no una lista de eliminación.**
   Cada candidato requiere revisión manual antes de eliminarse.
2. **Revisar referencias condicionales de plataforma** en `scripts/build-ci.mjs` y
   otros scripts que construyan rutas o nombres en tiempo de ejecución.
3. **Revisar archivos de configuración y operaciones** que puedan invocar el script
   por nombre (docker-compose, workflows, runbooks, documentación).
4. **Revisar si el script se carga dinámicamente** desde otro script (por ejemplo,
   `await import(...)` con nombre construido, o `require(...)` con variable).
5. **Revisar si el script es un duplicado** de funcionalidad que ya existe en otro
   archivo (ej. `shutdown.mjs` vs la copia inline en `monitoring-alerts.mjs`).
6. **Documentar la decisión de eliminación** en el diff, con la evidencia revisada,
   antes de hacer el commit.

## Relación con el gate de auditoría

El gate `check:audit-script-snapshot` ejecuta el escáner y compara el resultado
con `.tmp-audit-script-candidates.txt`. Si el snapshot driftea (por eliminación de
un script referenciado, o por adición de un nuevo script sin referencias), el gate
falla. Esto asegura que la lista de candidatos se mantenga sincronizada con la
realidad del repositorio, pero **no reemplaza la revisión manual** de los límites
descritos en este documento.

El snapshot debe regenerarse (con `node scripts/__tests__/audit-script-inventory.test.mjs`
o el comando equivalente documentado en `docs/launch-checklist.md`) después de cualquier
cambio en la estructura de `scripts/` que afecte las referencias, y el resultado debe
ser revisado manualmente antes de commitear.

## Véase también

- `docs/legacy-compatibility-plan.md` — política de retirada de compatibilidad.
- `scripts/__tests__/audit-script-inventory.test.mjs` — implementación del escáner y
  del contrato de snapshot.
- `.tmp-audit-script-candidates.txt` — snapshot actual de candidatos sin referencias
  conocidas.
- `scripts/check-audit-drift.mjs` — gate de deriva del inventario de scripts.
