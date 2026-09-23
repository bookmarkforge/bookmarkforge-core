# ADR-064 — Gate de frescura del ledger de auditoría

- **Estado:** aceptado
- **Fecha:** 2026-09-23
- **Decisores:** equipo de BookmarkForge

## Contexto

`docs/audit.md` publica una tabla "Estado verificado" con la forma comando → observable, y su regla fundacional es que cada afirmación lleva el comando que la respalda. Pero nada re-ejecutaba esa tabla: sus afirmaciones envejecían en verde. En la re-verificación del 2026-09-23 el documento seguía diciendo **exit 2 · 3 errores** para `npm run typecheck` mientras el árbol producía 69 líneas de error en 3 loci, y **"~97 gates `check:*`"** cuando la cadena ejecuta 50 gates (los 99 son scripts *declarados*, no ejecutados). Ese es el modelo de drift de ADR-028 aplicado a un documento: el ledger no se rompe, se queda obsoleto.

El gate vecino `check:audit-drift` (ADR-047 y anclas) vigila lo contrario: que el **código** no se aleje de los anclajes del ledger. Faltaba el otro sentido — que el **ledger** no se aleje del árbol.

## Decisión

Se añade `check:audit-freshness` a la cadena de `npm run check`. El gate parsea la tabla de estado y verifica cada fila según la columna `Modo`, que pasa a ser obligatoria:

| Modo | Verificación |
|---|---|
| `chain` | el comando es un gate de la cadena `npm run check`; el gate comprueba que sigue en ella (la ejecución es la de la cadena) |
| `exec` | se ejecuta y se comparan el exit code documentado y cada fragmento entre backticks contra la salida real |
| `deep` | como `exec`, solo bajo `--deep` (pesado para cada `npm run check`) |
| `network` | como `exec`, solo bajo `--allow-network` (`npm audit` habla con el registro) |
| `self` | el comando contiene al propio gate o es la suite que corre su test: su número se **deriva** del árbol (tamaño de la cadena, ficheros del perfil rápido) porque re-ejecutarlo sería recursivo |

**Invariantes fail-closed** (nunca se omiten): tabla ausente o vacía; fila sin `Modo` o con modo desconocido; comando que no es `npm run <script>`, `npm audit [flags]` ni `node scripts/<file>.mjs`; script que no existe en `package.json`; fila `chain` que nombra un script fuera de la cadena; fila `self` sin derivación registrada o cuyo número publicado no es exactamente el derivado; `npm audit` fuera del modo `network`; un claim de salida escrito como desigualdad (`exit ≠ 0`); y cualquier exit code documentado que no cuadre con el real.

El claim de salida es siempre un código **pinnado** (`exit N`). Una desigualdad se rechaza en vez de leerse como el `0` implícito: aceptarla como forma válida convertiría una fila roja en verde sin comprobar nada, que es justo el modo de fallo que este gate existe para terminar. El 2026-09-23 `npm run typecheck` era la única fila roja, con un código inestable (1/2/1 con salida idéntica por la carrera del `incremental` de tsc) y sus errores en un locus WIP que crecía y se reducía a diario; para esa fila existió una regla de loci por comando y una forma `exit ≠ 0`. Las dos se retiraron al pasar el árbol a verde: eran un caso especial hard-codeado a un nombre de comando que ninguna fila usaba, y mantenerlas habría dejado en el gate un camino de verificación que nada ejercita. Si el árbol vuelve a estar rojo de forma sostenida, el autor repone la regla junto con su fila — la frescura se paga con una edición, también en el propio gate.

## Relación con la gobernanza de gates

Registrado en `check-inspector-freeze` con categoría `docs`: un gate de formato documental necesita un ADR que lo nombre, y este lo hace. El ADR viaja en el export público (`PUBLIC_DOCS`), porque `docs/audit.md` **no** se publica: en el árbol exportado el gate declara "not shipped" en vez de fallar, ya que el export re-curá `docs/` y solo hereda la cadena tal cual. En el árbol privado, un ledger ausente sí falla (lo distingue la presencia de `docs/docs-state-index.md`, documento privado).

El conteo de ficheros del perfil rápido —el número que la tabla publica para `npm run test:fast`— pasa a tener un solo dueño: `scripts/test-files.mjs`, extraído de `scripts/test-bounded.mjs` para que el runner y el gate no mantengan dos recorridos distintos del mismo árbol.

## Consecuencias

- Añadir una fila a la tabla ya no es decorativo: sin `Modo` verificable, la cadena falla.
- Los comandos pesados y de red se ejecutan en CI en el step nombrado `npm run check:audit-freshness:deep` (`--deep --allow-network`); la cadena local mantiene los baratos.
- Un árbol que se arregla (los WIP desaparecen y typecheck pasa a verde) hace fallar el gate y obliga a actualizar el documento: la frescura se paga con una edición, no con una lectura anual. Pasó el mismo día: al quedar `npm run typecheck` en verde, la fila se reescribió a `exit 0` y con ella se retiraron la regla de loci y la forma `exit ≠ 0`, que quedaban sin usuario.
- La tabla "Superficie viva" (`grep`/`ls` con números en el observable) sigue fuera del gate: verificarla requiere declarar modo por fila como aquí. Es el siguiente tramo natural.
