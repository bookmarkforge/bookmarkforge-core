# ADR-058: Gate de confirmación del destino de release

- **Estado:** aceptado (implementado en `scripts/check-release-target.mjs`)
- **Fecha:** 2026-09-18

## Contexto

El repositorio se distribuye con el slug **provisional** `bookmarkforge/core`
todavía escrito en superficies que se publican:

- `package.json` → `repository.url` (el destino *declarado*: lo que anuncian los
  metadatos, los badges y el export público);
- el remoto de git (el destino *real*: donde aterrizaría `git push`);
- artefactos que se envían al lector: `README.md` y las `RELEASE-NOTES-*.md` del
  export público, que embeben la URL de `git clone` que alguien va a copiar.

Ninguna de esas superficies falla por sí sola: el Markdown renderiza, el JSON es
válido y el `push` funciona. El fallo es silencioso y aparece *después* de
publicar: una release cuyas instrucciones de clonado apuntan a un repositorio
que nadie confirmó, o peor, que declara un destino y publica en otro. Las
auditorías del repositorio ya listaban «destino sin confirmar» como bloqueante
externo, pero nada lo impedía mecánicamente.

## Decisión

1. Añadir `check:release-target` (`scripts/check-release-target.mjs`) con tres
   invariantes sobre las superficies anteriores:
   - el destino declarado **existe** y el remoto **existe** (la ausencia es
     «sin confirmar», no «correcto»);
   - ninguno es provisional: `bookmarkforge/core` o un propietario plantilla
     (`tu_usuario`, `your-org`, `example`…), la forma que el propio runbook usa
     como marcador;
   - declarado y real **coinciden**, para que una release no se publique desde
     un lugar distinto del que anuncia.
2. Fallar en **cerrado por defecto**: cualquier hallazgo produce exit 1. El
   mensaje nombra `archivo:línea`, el valor y el remedio concreto
   (`git remote set-url origin <url>`, `repository.url`, artefacto afectado).
3. Separar el modo **bloqueante** del **aviso**. La cadena `npm run check`
   ejecuta `check:release-target:advisory`: imprime los hallazgos, explica que
   no bloquea y sale 0. El motivo es explícito: mientras el destino siga sin
   decidirse, un rojo permanente en la cadena rompería CI y el trabajo diario
   sin impedir ninguna release, porque la cadena no publica nada.
4. Guardar la **ruta de release** en duro, que es donde el fallo tiene coste:
   - `scripts/export-public-repo.mjs` llama al gate antes del dry-run, así que
     un ensayo tampoco puede reportar éxito;
   - `scripts/run-launch-smoke.mjs` llama al gate como primera comprobación de
     la batería del día de lanzamiento: una batería verde no puede certificar
     una release contra un destino sin confirmar.
5. Registrar el gate en el inspector freeze como categoría `meta` (no es
   formato documental) y mantener este ADR como contrato de alcance.

## Consecuencias

- Preparar la release pública o el launch smoke con el slug provisional falla
  antes de escribir nada, con el archivo y la línea exactos.
- El aviso viaja en cada `npm run check`, así que la deuda es visible sin
  bloquear la integración continua.
- Confirmar el destino (fijar `repository.url`, retargetear `origin`, actualizar
  README y RELEASE-NOTES) apaga el gate por completo: no hay lista de
  excepciones ni bandera de escape que silencie el hallazgo.
- El gate es deliberadamente sintáctico: comprueba que el destino está
  confirmado y es coherente, no que el repositorio sea accesible, que el
  propietario exista o que la release esté lista. Eso sigue cubierto por el
  runbook de push, los workflows y la checklist de lanzamiento.
