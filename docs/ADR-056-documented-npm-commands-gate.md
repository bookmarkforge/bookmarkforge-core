# ADR-056: Gate de comandos npm documentados

- **Estado:** aceptado (implementado en `scripts/check-documented-npm-commands.mjs`)
- **Fecha:** 2026-09-18

## Contexto

Los runbooks y checklists son una interfaz operativa: una orden `npm run` que no
existe en `package.json` no es una errata inocua, sino un procedimiento de
lanzamiento roto. La auditoría detectó dos nombres históricos de smoke, `smoke:launch`
y `smoke:launch:dev`, que no correspondían con los scripts reales `launch:smoke` y
`launch:smoke:prod`.

Los tests de scripts contienen fixtures con nombres de gates deliberadamente
inexistentes para probar validadores. Por eso el escaneo debe limitarse a los
contratos documentales y workflows (`README.md`, `AGENTS.md`,
`CONTRIBUTING.md`, `OPEN-CORE.md`, `docs/` y `.github/`), no a todo el árbol.

## Decisión

1. Añadir `check:documented-npm-commands` a la cadena oficial `npm run check`.
2. Extraer cada referencia `npm run <script>` de los documentos operativos y
   verificarla contra `package.json.scripts`.
3. Emitir archivo y línea para cada comando inexistente y fallar cerrado.
4. Registrar el gate en `KNOWN_GATES` como inspector de documentación (`docs`).
5. Excluir scripts y tests del corpus porque contienen ejemplos y fixtures que
   no son instrucciones operativas.

## Consecuencias

- Un renombrado o eliminación de script rompe inmediatamente el gate si queda
  una instrucción viva apuntando al nombre antiguo.
- Los ejemplos de validadores pueden seguir usando comandos ficticios sin
  contaminar el contrato documental.
- El gate no verifica que el comando sea seguro, que sus secretos estén
  configurados ni que el procedimiento se complete: solo garantiza que el
  nombre invocado existe. Esas propiedades permanecen bajo los gates de
  workflows, entorno y checklist de lanzamiento.
- Los repositorios exportados que no incluyan alguna raíz opcional siguen
  siendo verificables; el lector ignora raíces ausentes, pero nunca ignora un
  documento encontrado con un comando inválido.
