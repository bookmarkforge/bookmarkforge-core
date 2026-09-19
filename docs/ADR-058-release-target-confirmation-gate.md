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
externo, pero nada lo impedía mecánicamente. El 2026-09-19 el responsable del
repositorio confirmó `bookmarkforge/core` como destino real: la enmienda está en
la Decisión (punto 6) y en las Consecuencias.

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
3. Un único modo, **bloqueante**. La cadena `npm run check` ejecuta
   `check:release-target` y cualquier hallazgo tumba el run. Un modo «aviso»
   (mismos hallazgos, salida 0) existió mientras el destino seguía sin
   decidirse y se retiró al confirmarse: ver la enmienda del punto 7.
4. Guardar la **ruta de release** en duro, que es donde el fallo tiene coste:
   - `scripts/export-public-repo.mjs` llama al gate antes del dry-run, así que
     un ensayo tampoco puede reportar éxito;
   - `scripts/run-launch-smoke.mjs` llama al gate como primera comprobación de
     la batería del día de lanzamiento: una batería verde no puede certificar
     una release contra un destino sin confirmar.
5. Registrar el gate en el inspector freeze como categoría `meta` (no es
   formato documental) y mantener este ADR como contrato de alcance.
6. **Enmienda 2026-09-19 — destino confirmado.** `bookmarkforge/core` es el
   repositorio real, confirmado por el responsable del proyecto, así que sale de
   `PROVISIONAL_TARGETS` (que queda vacía) y el gate pasa a verde. El mecanismo
   no se retira: la existencia del destino declarado y del remoto, la
   coincidencia entre ambos y el detector de propietarios plantilla
   (`tu_usuario`, `your-org`, `example`…) siguen vigentes contra cualquier
   regresión. Re-armar la lista provisional exige la evidencia inversa: que el
   slug no exista o que la confirmación se retire. En la misma revisión, el
   gate pasó a invocar git con `safe.directory`, porque un checkout propiedad de
   otro usuario reportaba un remoto confirmado como ausente.

7. **Enmienda 2026-09-20 — retirada del modo aviso.** Con el destino confirmado
   (punto 6), la cadena `npm run check` pasa a ejecutar el gate bloqueante y el
   modo `--advisory` desaparece: no queda script `check:release-target:advisory`,
   ni flag que clampe la salida a 0, ni registro en el inspector freeze. El
   rationale que lo justificaba —«un rojo permanente rompería CI sin impedir
   ninguna release, porque la cadena no publica nada»— caducó con la
   confirmación, y en pie era una contradicción con la propia Decisión: el
   punto 2 falla en cerrado por defecto y las Consecuencias presumen de que «no
   hay lista de excepciones ni bandera de escape que silencie el hallazgo». El
   modo aviso *era* esa bandera. Un destino que se vuelva a poner en duda no
   reabre el modo: rearma `PROVISIONAL_TARGETS` con su evidencia inversa, y la
   cadena se pone roja como corresponde.

## Consecuencias

- Preparar la release pública o el launch smoke con el slug provisional falla
  antes de escribir nada, con el archivo y la línea exactos.
- El hallazgo viaja en cada `npm run check` y bloquea: un destino sin
  confirmar no llega ni a un commit, ni a un dry-run de export, ni al smoke de
  lanzamiento.
- Confirmar el destino (fijar `repository.url`, retargetear `origin`, actualizar
  README y RELEASE-NOTES) apaga el gate por completo: no hay lista de
  excepciones ni bandera de escape que silencie el hallazgo.
- Cuando el destino confirmado resulta ser el slug que ya viajaba, la
  confirmación se resuelve enmendando este ADR (vaciar `PROVISIONAL_TARGETS`) en
  lugar de renombrar las superficies: las cuatro ya nombraban el destino
  correcto y no había nada que corregir. La verificación de que el bloqueo se
  levantó es la propia ruta de release: `node scripts/export-public-repo.mjs
  --dry-run` planifica el export y reporta el destino confirmado.
- El gate es deliberadamente sintáctico: comprueba que el destino está
  confirmado y es coherente, no que el repositorio sea accesible, que el
  propietario exista o que la release esté lista. Eso sigue cubierto por el
  runbook de push, los workflows y la checklist de lanzamiento.
