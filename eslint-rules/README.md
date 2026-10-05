# eslint-rules — reglas custom de BookmarkForge

Reglas ESLint propias del proyecto (plugin `bmf` en `eslint.config.js`). Cada
regla se auto-documenta en su cabecera JSDoc; este README es el índice. Cada
regla tiene su suite unitaria junto a ella (`*.test.mjs`, RuleTester/Vitest).

## Reglas

### `bmf/no-silent-catch`
**Ámbito:** código no-test (`src/**`, `scripts/**`, `server/src/**`, `extension/**`).
Un `catch` vacío (sin statements, solo comentarios) debe declararlo
explícitamente con `catch { /* INTENTIONAL SILENCE: <razón precisa> */ }`.
Regla estructural que protege la convención de `AGENTS.md` §3: los errores no
se tragan silenciosamente. Excluye los árboles de test, donde catch-and-fail
es idiomático.
→ `no-silent-catch.mjs`

### `bmf/no-unbounded-text`
**Ámbito:** `src/**/*.tsx`.
Flaggea elementos JSX que renderizan texto dinámico dentro de un contenedor
"ajustado" sin marcador defensivo (`truncate`, `line-clamp-N`, `max-w-*`).
Previene desbordes de texto en la UI. El gate E2E asociado es
`check:no-unbounded-text` (baseline en `scripts/no-unbounded-text-baseline.json`).
→ `no-unbounded-text.mjs`

### `bmf/no-unbounded-card-header`
**Ámbito:** `src/**/*.tsx`.
Compañera de `no-unbounded-text` con alcance deliberadamente más estrecho: solo
`<h1>`–`<h4>` dentro de wrappers de tarjeta `<div>`. Es el piloto que corre
antes de ensanchar la regla base.
→ `no-unbounded-card-header.mjs`

### `bmf/no-securityvault-mock-without-lock`
**Ámbito:** `src/tests/**`.
Un `vi.mock("../../services/SecurityVault", …)` que no provea `onLock` y
`onUnlock` en el objeto retornado rompe en tiempo de importación con
`TypeError: X.onLock is not a function` (ProviderManager, TTSService,
SemanticCacheService, VaultIntegration, AgentService y TaggingService registran
callbacks de lock en construcción). La regla exige simetría de ciclo de vida
lock/unlock en cualquier mock del vault (`AGENTS.md` §6).
→ `require-securityvault-mock-lock-unlock.mjs`

### `bmf/no-unexplained-test-skip`
**Ámbito:** `tests/e2e/**`.
`test.skip()` / `test.fixme()` / `test.todo()` debe llevar una razón explícita,
para que un test silenciado no se pueda commitear y olvidar.
→ `no-unexplained-test-skip.mjs`

### `bmf/no-unbounded-loop`
**Ámbito:** `src/services/**`, `src/workers/**`, `src/utils/**`, `src/tests/**`.
Flaggea bucles `for(;;)` / `while(true)` sin mecanismo garantizado de
terminación. Motivación: un bucle sin salida llegó a producirse en
`GarbageCollectionService.pruneVersions()`.
→ `no-unbounded-loop.mjs`

### `bmf/require-adr-template`
**Ámbito:** `docs/ADR-*.md`.
Exige que todo ADR nuevo lleve las cinco secciones de la plantilla del repo
(Estado / Fecha / Contexto / Decisión / Consecuencias, en formato bold-list o
heading, insensible a mayúsculas y consciente de bloques de código), que los
metadatos `Estado`/`Fecha` lleven valor y que el primer heading sea
`# ADR-###: <título>` con el número coincidente con el nombre del archivo.
ESLint no trae parser de Markdown: la regla corre sobre un parser trivial de
líneas (`lib/markdown-parser.mjs`) enchufado como `languageOptions.parser` en
el bloque `docs/ADR-*.md` de `eslint.config.js`. La regla se auto-limita por
nombre de archivo, así que el resto del Markdown del repo queda fuera de
alcance. Corpus verificado limpio (15 ADRs) — cualquier ADR nuevo sin plantilla
rompe `npm run lint`.
→ `require-adr-template.mjs`

## Wiring en `eslint.config.js`

- El plugin se registra como `bmf` en el bloque de archivos
  `src/**`, `tests/e2e/**`, `scripts/**`, `server/src/**`, `extension/**`.
- Cada regla se activa con ámbito propio (ver tabla anterior). Las exclusiones
  van en `ignores`, nunca como globs `!`-prefijados en `files` (ver la nota
  dentro de `eslint.config.js` sobre la negación de minimatch).

## Tests

Cada regla tiene su suite en el mismo directorio (`npm run test:fast` las
ejecuta junto al resto). Para añadir una regla nueva:

1. Crea `eslint-rules/<regla>.mjs` con cabecera JSDoc auto-documentada.
2. Crea `eslint-rules/<regla>.test.mjs` con RuleTester cubriendo casos válidos
   e inválidos, incluyendo el ángulo que motivó la regla.
3. Regístrala en `eslint.config.js` (plugin + bloque de activación con ámbito).
4. Si la regla requiere baseline (como `no-unbounded-text`), añade el script
   `check:*` correspondiente a `package.json` y su baseline en `scripts/`.
