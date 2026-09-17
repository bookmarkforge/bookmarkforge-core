# ADR-046: Rotación del salt KDF de la bóveda junto con la contraseña maestra

- **Estado:** aceptado (implementado: `src/services/security-vault/kdf-salt.ts`
  y `SecurityVault.rotateMasterPassword`; regresión en
  `src/tests/security/p0-vault-kdf-salt.regression.test.ts` y
  `src/tests/services/SecurityVault.test.ts`; E2E
  `tests/e2e/vault-change-password.spec.ts`)
- **Fecha:** 2026-09-12

## Contexto

La derivación de la clave maestra estiraba la contraseña con Argon2id contra un
salt **constante y compartido por todo el bundle**
(`bookmarkforge-v5-master-key`, `bookmarkforge-session-master-key-v6`). Una
sola pasada de Argon2id sobre una contraseña candidata servía contra cualquier
bóveda del mundo, que es exactamente lo que RFC 9106 prohíbe al exigir un salt
único por contraseña.

A-1 cerró esa brecha para el aprovisionamiento y la migración: cada bóveda
acuña 16 bytes aleatorios, los persiste en `SecureStorage`
(`SECURE_STORAGE_KEYS.KDF_SALT` → `"kdf_salt"`) y los instala en la capa
criptográfica. Los payloads nuevos salen `v6:` y **llevan su propio salt
incrustado**; los `v5:` anteriores siguen leyéndose con el salt fijo legacy.
El salt es metadato público: lo que se protege es su unicidad, no su secreto.
(Ver también `docs/ADR-019-argon2id-migration.md` para la migración previa de
los parámetros de Argon2id.)

Lo que A-1 **no** cubrió es la rotación de contraseña: `rotateMasterPassword`
invalidaba la contraseña y conservaba el salt. El artefacto hostil no es la
contraseña, es el **corpus de blobs cifrados con ella** — el token de
verificación (H5, guardado sin la capa del device key, de modo que sigue
legible con la bóveda bloqueada), `encrypted_db_key`, `encrypted_api_key` y el
propio device key envuelto. Un corpus cosechado vale lo que valga el salt que
lo produjo: dejar el salt intacto entregaba a quien ya hubiera construido un
diccionario contra la contraseña **vieja** un diccionario que seguía
aplicándose a los blobs escritos bajo la **nueva**. "He cambiado mi contraseña"
solo era cierto en línea, no frente a un ataque offline.

Restricciones que dan forma a la decisión:

- La rotación no puede invalidar datos ya cifrados. Comparticiones, backups y
  blobs pre-migración deben seguir descifrando, también si la operación se
  deshace. `v6:` lo garantiza por construcción: descifrar nunca consulta el
  salt del módulo (un `v6:` usa el suyo embebido; un `v5:` usa el fijo legacy).
- El **desbloqueo** nunca puede romperse por culpa del salt. La rotación, en
  cambio, es una operación explícita y autenticada: si no puede completarse,
  debe fallar y deshacerse, nunca fingir éxito.
- Puede haber más de una pestaña abierta, y la bóveda puede bloquearse en mitad
  de la operación (`vaultGeneration` + `isLocked()` abortan la rotación). Y el
  salt no es estado compartido: vive en memoria del módulo, así que una
  rotación no llegaba a una pestaña ya abierta hasta que recargase — esa
  pestaña seguía escribiendo bajo el salt retirado (ver Decisión 8).
- `RECOVERY_DATA` **no** rota: está cifrado con la frase de recuperación, no con
  la contraseña. Tratarlo como un secreto rotable fue un fallo de producción
  que hacía **fallar toda rotación** (reintroducirlo es una regresión).

## Decisión

1. **El salt rota en la misma operación que la contraseña**, y antes de
   re-envolver ningún payload. Es el único momento en que el salt debe cambiar
   obligatoriamente: la contraseña deja de ser válida ahí, y con ella el valor
   del corpus que ese salt produjo.
2. **Orden del swap: snapshot → persistir → instalar.** Nunca al revés (ver
   "Alternativas descartadas" A-3).
   - *Persistir primero*: un crash no puede dejar la bóveda cifrando bajo un
     salt que el almacenamiento no ha visto; el siguiente desbloqueo adoptaría
     el salt almacenado antiguo y partiría la bóveda en dos derivaciones.
   - *Instalar segundo*: nada se escribe con el salt nuevo hasta que la bóveda
     está comprometida con él, y por eso `restoreVaultKdfSalt` es un undo
     completo. El estado previo se **pasa** a `rotateVaultKdfSalt` en lugar de
     releerse ahí, para que no pueda recoger su propia escritura a medias.
3. **Se re-envuelve todo lo cifrado con la contraseña**, no solo el salt:

   | Artefacto | Cómo se re-clava | Motivo |
   |---|---|---|
   | `encrypted_db_key`, `encrypted_api_key` | `decryptWithBytes` + `encryptWithBytes` con la contraseña nueva; salen `v6:` con el salt nuevo | son el corpus que un atacante cosecharía |
   | device key envuelto (H5) | `rewrapDeviceKeyWithPasswordBytes(old, new)` mientras los bytes de la contraseña antigua siguen vivos | el handle en memoria no cambia, solo su sobre at-rest |
   | token de verificación (H5) | `createVerificationToken(newPassword)` | es el oráculo de verificación oficial; debe quedar bajo la contraseña nueva **y** el salt nuevo |
   | registro de integridad S1 del token | reemitido con el token | un registro desincronizado haría fallar la verificación al siguiente arranque |

4. **Contrato de rollback.** Un fallo en cualquier punto restaura, en este
   orden, todo lo que se había escrito:

   | Artefacto | Snapshot previo | Restauración |
   |---|---|---|
   | `encrypted_api_key`, `encrypted_db_key` | valor por clave antes de tocar nada | `setSecret` del valor previo |
   | device key envuelto | `getWrappedDeviceKeyBlob()` | `restoreWrappedDeviceKeyBlob` |
   | token de verificación | `getVerificationToken()` | `restoreVerificationToken` |
   | registro de integridad S1 | `getVerificationIntegrity()` | `storeVerificationIntegrity` o `deleteSecret` si no existía |
   | salt KDF | `snapshotVaultKdfSalt()` → `{ stored, installed }` | `restoreVaultKdfSalt()`, **el último** |

   Reglas del contrato:

   - **El salt se restaura el último**, cuando ya se ha puesto de vuelta cada
     payload escrito bajo el nuevo. La mitad **en memoria** es la que sostiene
     la sesión actual (sigue con la contraseña vieja, así que debe seguir con
     la derivación con la que esa contraseña se estiraba); la mitad
     **almacenada** es la que instalará el siguiente desbloqueo. Las dos
     intentan restaurarse, incluso si la escritura falla.
   - **`stored: undefined` no es `null`.** `undefined` significa "la lectura
     falló" (device key bloqueado) y no se "restaura" borrando un valor que
     nunca se llegó a ver; `null` significa "no había salt" y sí se borra.
   - **`restoreVaultKdfSalt` nunca lanza.** Corre en el camino de fallo: si
     lanzara, enmascararía el error original que provocó el rollback.
   - El snapshot se toma **antes** de tocar el salt, así que una rotación que
     muera entre "persistido" e "instalado" sigue siendo deshacible.
5. **La rotación falla en voz alta; el aprovisionamiento no.** `rotateVaultKdfSalt`
   propaga el error si el salt nuevo no se puede persistir (el llamador
   deshace y devuelve `false`), al contrario que `ensureVaultKdfSalt`, que
   corre en el camino de desbloqueo y por eso degrada a modo legacy con un
   aviso en lugar de romper el desbloqueo.
6. **RNG roto = error, no rotación aparente.** Si el salt recién acuñado
   coincide con el anterior (probabilidad 2^-128: al llegar ahí el generador
   está roto), se reintenta una vez y luego se **lanza**
   (`Vault KDF salt rotation produced a repeated salt`): devolver el mismo salt
   declararía una rotación que no ha ocurrido.
7. **Serialización.** `rotationPromise` hace que dos rotaciones concurrentes
   compartan una sola operación en lugar de pisarse. Serializa **rotaciones,
   no escrituras**: otro servicio que escriba durante la ventana de rollback
   (milisegundos) lo haría bajo el salt nuevo.
8. **Propagación a las pestañas abiertas.** El salt vive en estado de módulo,
   así que una rotación solo llegaba a las demás pestañas al recargar. El
   tab que rota **anuncia** el cambio y los demás **vuelven a leer el salt de
   storage** (`kdf-salt-sync.ts` + `adoptVaultKdfSaltFromStorage`):
   - **El mensaje no lleva el valor, solo el disparador.** Cualquier script del
     origen puede escribir en un `BroadcastChannel` (por eso el canal externo
     de `BroadcastBridgeService` va firmado con HMAC) y aquí no hay clave
     compartida con la que firmar: tras una rotación las dos pestañas tienen
     contraseñas **distintas**. Storage es la autoridad, así que un mensaje
     falsificado solo provoca una relectura del mismo salt, nunca la
     instalación de uno elegido por el atacante (el downgrade que importaría:
     un salt elegido vuelve a hacer reutilizable un único diccionario).
   - **Solo se anuncia una rotación ya confirmada**, nunca una reversible:
     avisar a mitad dejaría a las otras pestañas en un salt que esta puede
     deshacer, con cada `v6:` escrito en esa ventana clavado a un salt que la
     bóveda ya no tiene. Si la rotación se deshace, no se anuncia nada, storage
     vuelve al salt anterior y las pestañas — que nunca se movieron — siguen
     consistentes con él.
   - **Idempotente y a prueba de entregas tardías o duplicadas:** el manejador
     relee el salt ACTUAL, así que un mensaje repetido, reordenado o posterior
     a un rollback converge al mismo valor en vez de resucitar el no confirmado.
   - **Se escucha solo con la bóveda desbloqueada** (leer el salt necesita la
     device key), y al bloquear se cierra el canal. Una pestaña bloqueada no
     necesita nada: ni puede leer el salt ni puede escribir con él, y su
     siguiente desbloqueo aprovisiona el corriente.
   - **La contraseña no se transmite**: la pestaña que adopta conserva la
     antigua en memoria y eso se registra como aviso (ver Consecuencias).

## Consecuencias

- Un diccionario construido contra la contraseña anterior deja de aplicar a la
  bóveda en cuanto `rotateMasterPassword` devuelve `true`, porque los payloads
  re-escritos van clavados a una contraseña **y** un salt nuevos.
- Nada ya migrado queda ilegible, pase lo que pase: el descifrado de un `v6:`
  no depende del salt del módulo ni del almacenado. Backups, comparticiones y
  una pestaña que aún tenga el salt viejo siguen descifrando.
- Una rotación escribe varios payloads + el token + el wrapper + el registro de
  integridad. El coste es el de una operación explícita y poco frecuente, a
  cambio de que el rollback cubra exactamente esas escrituras.
- **La ventana de dos salts vivos se cierra sin recargar:** una pestaña
  abierta adopta el salt rotado en cuanto la rotación se confirma (verificado
  end-to-end con dos pestañas reales en
  `tests/e2e/vault-kdf-salt-cross-tab.spec.ts`), así que deja de acumular
  ciphertext bajo el salt retirado. El caso que **no** cubre la notificación es
  una pestaña sin `BroadcastChannel` (modo privado, navegador antiguo): esa
  sigue con el salt anterior hasta recargar, que es el comportamiento previo,
  no peor.

### Extensión de alcance (2026-09-17): el índice Voy deriva bajo el mismo salt por-vault

El índice de búsqueda vectorial persistido (envelope AES-GCM del worker
`voy.worker.ts`) mantenía un corpus cifrado paralelo cuyo KDF **no** estaba
cubierto por este ADR: `deriveIndexKey` estiraba la contraseña con Argon2id
contra `SHA-256("bookmarkforge-voy-index-v1")[0..16]`, una constante del
bundle idéntica para toda bóveda — exactamente la clase de fallo de A-1 que
este ADR corrigió para el corpus maestro. Un diccionario construido contra el
índice cosechado de IndexedDB valía contra el de cualquier bóveda.

Alineación con este ADR (2026-09-17):

- **Contrato `SET_KEY` actualizado:** `VectorIndexService.setVaultKey` lee el
  salt por-vault instalado (`getVaultKdfSaltHex`) y lo envía explícitamente
  (`{ passwordBytes, vaultSalt, keyId }`). El campo `userId` constante queda
  retirado. El orden ya garantizado por este ADR hace seguro el cambio: el
  unlock instala el salt **antes** de disparar los listeners `onUnlock` desde
  donde se instala la clave del índice.
- **Fail-closed en ambos extremos:** el worker valida `vaultSalt` como 32 hex
  y rechaza el `SET_KEY` antes de derivar (los `passwordBytes` se zeroizan
  igualmente); sin salt instalado, el servicio no envía `SET_KEY` y degrada al
  carril existente de `ensureVaultKey` — búsqueda en memoria sí, persistencia
  cifrada no. Nunca se escribe un índice bajo un salt equivocado.
- **Rotación de contraseña incluida gratis:** como el salt del índice es el
  mismo que rota este ADR, la re-derivación tras una rotación re-clava el
  corpus del índice sin código adicional.
- **Compatibilidad de envelopes:** los índices ya persistidos bajo el salt
  constante retirado **no** se migran; en el siguiente unlock la clave
  re-derivada (salt nuevo) falla la autenticación AES-GCM y el path
  fail-closed existente de `LOAD_INDEX` purga el registro y reconstruye el
  índice desde las colecciones fuente de RxDB. Sin exposición de plaintext:
  el coste es un re-indexado único por bóveda.
- **Anclas de regresión:** `p0-voy-dedup.regression.test.ts` (roundtrip:
  el envelope re-abierto exige el mismo salt en ambos `SET_KEY`),
  `voy.worker.test.ts` (`vaultSalt` malformado rechazado sin derivar, con
  ceroización) y `VectorIndexService.test.ts` (el `SET_KEY` lleva el salt
  por-vault; la constante retirada jamás llega al worker). Archivos:
  `src/services/ai/VectorIndexService.ts`, `src/workers/voy.worker.ts`.
- **La pestaña que adopta queda con credencial obsoleta.** Su contraseña en
  memoria es la **antigua**: el salt adoptado la hace escribir `v6:` bajo el
  salt nuevo pero clavados a la contraseña anterior, que la contraseña nueva
  (la que el usuario tiene ahora) no abre tras recargar. Es el hazard previo de
  rotar con varias pestañas abiertas — y la propagación no lo empeora, lo
  mejora: ese corpus pasa de estar bajo el salt retirado (cuya precomputación
  el atacante ya pagó) a estarlo bajo uno único. Cerrarlo del todo exigiría
  transmitir la contraseña nueva entre pestañas, que es exactamente lo que no
  se hace; la salida honesta es reloguear, y adoptar el salt no rompe la propia
  lectura de esa pestaña (la caché de clave maestra va indexada por salt).
- El salt sigue siendo metadato público y no se cifra ni se deriva de nada: la
  propiedad que se mantiene es unicidad + rotación, no secreto.
- Tests que anclan el contrato: `rotateVaultKdfSalt` (persistir antes de
  instalar, fallo ruidoso sin instalar nada, rechazo de salt repetido, lectura
  fallida reportada como desconocida, re-clavado real) y `restoreVaultKdfSalt`
  (ambas mitades, borrado de un salt inexistente, no borrar lo ilegible, salt
  malformado tratado como ausente) en
  `src/tests/security/p0-vault-kdf-salt.regression.test.ts`; las tres pruebas
  de rotación con rollback, abort temprano y re-envoltura completa en
  `src/tests/services/SecurityVault.test.ts`, incluidos los dos extremos de la
  notificación (anunciada una vez tras confirmar, **no** anunciada si la
  rotación se deshace); la propagación cross-tab (adopción desde storage,
  indiferencia a un salt falsificado, salt malformado/ausente/ilegible
  rechazados, `stop` real y ausencia de `BroadcastChannel`) en el mismo
  fichero P0; y dos comprobaciones end-to-end: que el salt **cambia de verdad**
  (leyéndolo del ciphertext del token H5, en
  `tests/e2e/vault-change-password.spec.ts`) y que una **segunda pestaña**
  adopta el salt nuevo sin recargar y pasa a escribir con él
  (`tests/e2e/vault-kdf-salt-cross-tab.spec.ts`).

## Alternativas descartadas

- **A-1. Conservar el salt en la rotación (statu quo).** Es el fallo que este
  ADR corrige: el corpus cosechado sobrevive al cambio de contraseña y un
  diccionario antiguo sigue valiendo. Habría hecho falta que el atacante
  repitiera el trabajo solo si el salt cambiase.
- **A-2. Salt determinista derivado de la contraseña** (por ejemplo
  `HKDF(password, "salt")`). Reproduce la clase de fallo que A-1 eliminó: el
  salt deja de ser único por bóveda (dos bóvedas con la misma contraseña
  comparten derivación) y pasa a ser adivinable/cosechable junto con la
  contraseña. Además haría la rotación cosmética: el salt "nuevo" sería
  verificable desde la contraseña candidata.
- **A-3. Instalar primero y persistir después.** Un crash entre ambos pasos deja
  payloads escritos bajo un salt que el almacenamiento no conoce; el siguiente
  desbloqueo instala el salt antiguo y la bóveda queda partida entre dos
  derivaciones, con datos potencialmente irrecuperables. Es la razón de que el
  orden sea una decisión y no un detalle.
- **A-4. Rotar sin rollback (fail-forward), por simplicidad.** Una bóveda a
  medio re-envolver (un secreto con la contraseña nueva y otro con la vieja, el
  token desincronizado de su registro S1) no se puede deshacer desde la UI y
  puede costar los datos. Preferimos una operación que falla limpia a una que
  falla a medias.
- **A-5. Rotar el salt sin re-envolver los blobs existentes.** Cambiar solo el
  metadato no reduce nada: los blobs ya cosechados seguirían clavados al salt
  viejo, y el atacante solo tendría que usar el salt anterior que ya conoce.
  La rotación vale por lo que se re-clava, no por lo que se escribe en el
  almacén de metadatos.
- **A-6. Bóveda nueva o migración completa en lugar de rotación in-place.**
  Mucho más invasivo (invalidaría comparticiones y obligaría a re-importar),
  y no aportaría nada frente al ataque offline: los objetos secretos son los
  mismos y habría que re-envolverlos igual.
- **A-7. Rotar el salt en cada desbloqueo** (defensa en profundidad "gratis").
  No defiende de nada mientras la contraseña no cambie — el corpus cosechado y
  su salt siguen siendo el mismo par — y metería una escritura y una derivación
  Argon2id extra en el camino que nunca debe fallar, que es justo lo que hace
  que `ensureVaultKdfSalt` sea silencioso y la rotación ruidosa.
- **A-8. No persistir el salt y tomarlo del último payload descifrado.** Es
  circular en el aprovisionamiento (una bóveda nueva no tiene payload del que
  leerlo) y añadiría una lectura adicional en cada escritura para reconstruir
  un valor que la capa criptográfica necesita disponible.
- **A-9. Derivar el salt de material ya existente** (device key, id de bóveda)
  en lugar de usar el RNG. Acopla dos ciclos de vida: re-envolver o regenerar
  el device key cambiaría la derivación en silencio, y la rotación dejaría de
  producir un valor independiente de todo lo que sobrevive al cambio.
- **A-10. Snapshot sin distinguir "no hay salt" de "no se pudo leer".**
  Restaurar borrando cuando la lectura falló destruiría el salt real de la
  bóveda basándose en una suposición, y el siguiente desbloqueo acuñaría uno
  distinto: pérdida de acceso a todo lo escrito `v5:` bajo el salt perdido.
- **A-11. Transmitir el salt nuevo en el mensaje cross-tab.** Ahorra una
  lectura de storage y convierte el canal en una vía para instalar un valor de
  terceros: un `BroadcastChannel` es escribible por cualquier script del
  origen, y tras la rotación las pestañas no comparten clave con la que firmar
  (tienen contraseñas distintas). Un salt elegido por un atacante reintroduce
  el fallo de A-1 — un único diccionario vuelve a servir para muchas bóvedas.
  Con el disparador sin carga, storage decide y la falsificación es inerte.
- **A-12. Anunciar en cuanto se instala el salt nuevo** (antes de re-envolver
  los payloads y de la confirmación). Adopción más rápida, y a cambio las
  otras pestañas se moverían a un salt que esta operación aún puede deshacer:
  un rollback dejaría a las vecinas clavadas a un valor que la bóveda ya no
  tiene, escribiendo con él. Se anuncia al confirmar, no al instalar.
- **A-13. Bloquear las demás pestañas al detectar la rotación**, como forma
  fuerte de "dejen de escribir". Es más seguro para los datos que quedarse con
  una credencial obsoleta, pero es una decisión de producto (expulsa al usuario
  de una pestaña que no ha tocado) y no es necesaria para el objetivo: el salt
  adoptado ya evita que se acumule ciphertext bajo el retirado, y el modo en
  que la pestaña convencional resuelve su credencial vieja — reloguear — sigue
  disponible. La decisión queda registrada aquí como no tomada, no como
  imposible.
