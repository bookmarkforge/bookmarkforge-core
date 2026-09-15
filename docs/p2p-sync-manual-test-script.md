# Guion de prueba manual — Sync P2P iPhone ↔ escritorio (pre-lanzamiento)

> **Objetivo:** certificar en dispositivos reales el flujo que ninguna batería
> automatizada puede cubrir del todo: emparejamiento por doble QR con cámara
> física, sync real entre dos bóvedas en la misma red y comportamiento offline.
> La lógica (replicación de colecciones, reconciliación LWW, recuperación tras
> interrupción) ya está automatizada en `tests/e2e/vault-sync-real.spec.ts`;
> aquí se prueba lo que solo existe con hardware real: cámaras, Wi-Fi real,
> avión real y Safari iOS real.
>
> - **Duración:** ~40 min con ambos dispositivos a mano.
> - **Necesitas:** un escritorio/portátil **con cámara web** (ambos roles
>     escanean un QR exactamente una vez) + un iPhone con iOS 16+, ambos con
>     la app en HTTPS (producción o staging), papel para notas.
> - **Importante:** el P2P de BookmarkForge es **air-gapped por diseño**
>     (`iceServers: []` — sin STUN/TURN): los dos dispositivos deben estar en
>     la **misma red local**. Si no conectan, el 90% de las veces es la red,
>     no la app (sección 6).
> - **Relación:** complementa el [guion iPhone](ios-manual-test-script.md) y
>     el ítem 16 de [launch-checklist.md](launch-checklist.md).

---

## Preparación (5 min)

1. [ ] Conecta el iPhone y el escritorio a la **misma red Wi-Fi**.
       Evita redes de "invitados": suelen tener *client isolation* y bloquean
       el tráfico entre dispositivos (el sync no podrá conectar y NO es un bug).
2. [ ] Abre la app en ambos dispositivos (HTTPS obligatorio: cámara y WebRTC
       requieren contexto seguro) y desbloquea cada bóveda.
3. [ ] En el escritorio, deja el portátil **sin cable de red** si quieres
       validar el modo 100% offline (sección 5). Wi-Fi puede seguir conectado:
       el sync nunca sale de la LAN de todas formas.
4. [ ] En el iPhone: ajustes de Safari → cámara permitida para el dominio
       (te lo pedirá al escanear; acéptalo).
5. [ ] Datos de prueba reconocibles: crea en el ESCRITORIO 2 marcadores y 1
       documento con la palabra **DESK** en el título; en el iPhone 2 marcadores
       y 1 documento con **PHONE**. Anota los títulos exactos en papel.
6. [ ] Mantén **ambas pantallas encendidas** durante todo el emparejamiento
       (si el iPhone bloquea o Safari va a segundo plano, la conexión ICE se
       corta y hay que reintentar desde el paso 1).

---

## 1. Emparejamiento por QR (escritorio = anfitrión) (10 min)

1. [ ] Escritorio: Dashboard → tarjeta **"Secure P2P Sync"** → botón
       **"This is the host"**. Tras unos segundos aparece el QR (paso 1) sobre
       fondo blanco. _Captura._
2. [ ] iPhone: misma tarjeta → **"Link this device"** → Safari pedirá cámara.
       Acepta y apunta al QR del escritorio.
3. [ ] El iPhone muestra ahora **su QR de respuesta** ("Step 2: Show this QR
       to your main device camera").
4. [ ] Escritorio: pulsa **"Step 2: Scan answer"** y apunta la webcam al
       iPhone. La cámara del escritorio debe leer el QR del teléfono (ajusta
       distancia/brillo si tarda más de ~15 s).
5. [ ] Ambos lados pasan por **"Syncing vaults..."** con barra de progreso y
       terminan en **"Sync Successful!"** / "Both devices are up to date."
       _Captura del estado final en ambos._
6. [ ] **Verifica la convergencia:** en el iPhone deben aparecer los títulos
       con **DESK**; en el escritorio los de **PHONE** (marcadores Y
       documentos). Los cuentas en voz alta contra tu papel.

**✅ Criterio de éxito:** ambos lados llegan a "Sync Successful!" y cada
dispositivo ve los 4 elementos del otro.

---

## 2. Roles invertidos (iPhone = anfitrión) (5 min)

1. [ ] Cierra el modal en ambos dispositivos (la desconexión es automática).
2. [ ] Repite el emparejamiento con **roles al revés**: el iPhone como
       "This is the host" y el escritorio como "Link this device".
3. [ ] De nuevo: doble QR, progreso, "Sync Successful!" y convergencia
       (usa un marcador nuevo **SWAP** en cada lado para verificar).

**✅ Criterio de éxito:** el flujo funciona igual en ambas direcciones — el
rol no es privilegio, es solo quién genera el primer QR.

---

## 3. Sync incremental (5 min)

1. [ ] Con la sesión aún conectada (o repitiendo el emparejamiento, ~1 min):
       crea un marcador nuevo en el iPhone (**INC1**) mientras la barra aún
       puede sincronizar, o crea ANTES y empareja después — ambos caminos
       deben converger.
2. [ ] Comprueba que **INC1** aparece en el escritorio y **INC2** (creado en
       escritorio) aparece en el iPhone.
3. [ ] Edita en el escritorio la descripción de un marcador **DESK** y
       verifica que el cambio llega al iPhone tras el siguiente emparejamiento.

**✅ Criterio de éxito:** los cambios nuevos viajan en la siguiente sesión sin
crear duplicados (mismo título = 1 fila, no 2).

---

## 4. Ediciones concurrentes y resolución de conflictos (8 min)

> La reconciliación es **last-writer-wins por timestamp**: la versión con
> modificación MÁS RECIENTE gana, en ambos dispositivos. Este bloque verifica
> que sea determinista y sin duplicados.

1. [ ] Antes de conectar: edita el MISMO marcador en ambos dispositivos
       (título distinto en cada uno: **WINS-DESK** en escritorio,
       **WINS-PHONE** en iPhone). Deja pasar **2-3 minutos** entre las dos
       ediciones para que los timestamps no sean casi simultáneos.
2. [ ] Empareja y espera "Sync Successful!".
3. [ ] Resultado esperado: **ambos** dispositivos muestran la edición más
       reciente (si editaste WINS-PHONE después, ambos muestran WINS-PHONE).
       _Anota cuál ganó y en qué orden editaste — debe coincidir._
4. [ ] **Sin duplicados:** el marcador conflictivo aparece UNA sola vez en
       cada bóveda (ni fusiones raras ni filas gemelas).
5. [ ] **Creación simultánea del mismo título:** crea en ambos lados un
       marcador con título idéntico (p. ej. **DUPTEST**) antes de conectar.
       Tras el sync: una sola entrada (deduplicación por id/operación), no dos.
6. [ ] Verifica que el perdedor del conflicto no corrompió nada más: los
       títulos DESK/PHONE/INC siguen íntegros en ambos lados.

**✅ Criterio de éxito:** LWW determinista (la edición más nueva gana en ambos),
sin duplicados y sin daños colaterales.

---

## 5. Offline real / air-gapped (7 min)

> La promesa del producto: los datos **nunca salen de tu red**. Aquí se demuestra.

1. [ ] **Modo avión total en el iPhone** (Wi-Fi OFF también)… pero entonces no
       hay LAN: este paso verifica lo contrario — que NO necesita internet:
       con el router **desconectado de internet** (o el portátil sin cable y
       el móvil con Wi-Fi al router sin WAN), empareja y sincroniza.
2. [ ] El sync debe completar igual que en la sección 1 (la app no debe
       mostrar errores de red ni bloquearse por no haber internet).
3. [ ] **Corte a mitad de sync:** durante "Syncing vaults..." (con una bóveda
       grande para que dure), fuerza el cierre del modal en el escritorio a
       mitad de la barra. Reabre y re-empareja: debe completar sin duplicados
       ni corrupción (la e2e ya cubre la recuperación tras interrupción;
       aquí se confirma en hardware real).
4. [ ] **Safari en segundo plano:** con el emparejamiento a medias, envía el
       iPhone a segundo plano 10 s y vuelve. Comportamiento esperado: error
       visible de conexión o reintentos limpios — nunca un estado "completado"
       falso ni un cuelgue silencioso. _Captura si hay error._
5. [ ] Verifica tras cada paso que ambas bóvedas siguen desbloqueables y
       con sus datos intactos.

**✅ Criterio de éxito:** sync completo SIN internet; interrupciones degradan
con error visible y se recuperan re-emparejando.

---

## 6. Límites de red: lo que NO debe conectar (5 min)

> Privacidad por diseño: fuera de la LAN, el sync no existe.

1. [ ] iPhone en **datos móviles** (Wi-Fi OFF) + escritorio en su red:
       intenta emparejar. Tras el QR debe quedarse en "connecting" y acabar en
       error/timeout visible — **nunca** completar. _Captura del error._
2. [ ] iPhone en una **red de invitados** distinta (si tienes una) con el
       escritorio en la principal: mismo resultado esperado (no conecta).
3. [ ] Restaura el iPhone a la red correcta y empareja de nuevo: debe volver
       a funcionar (el fallo anterior no dejó estado roto).

**✅ Criterio de éxito:** redes distintas = no hay conexión (y hay error
visible, no cuelgue); volver a la LAN = funciona.

---

## 7. Particularidades de iOS que vigilar (hallazgos, no bloqueantes siempre)

- **Banner "WebRTC is not supported"** en el modal en lugar del selector de
  roles: si aparece en tu iOS, es hallazgo **bloqueante** (anota versión de
  iOS) — el sync P2P no funcionará para usuarios de iPhone.
- **Cámara dentro de la PWA instalada:** iOS es restrictivo con getUserMedia
  en modo standalone. Si el escaneo falla en la PWA pero funciona en Safari,
  anótalo: la documentación de usuario debe decir "empareja siempre desde
  Safari".
- **Bloqueo de pantalla** a mitad de emparejamiento: el ICE se corta. La app
  debe mostrar error y permitir reintentar (verificado en 5.4).
- **QR que no lee la webcam del escritorio:** baja el brillo del iPhone o
  aléjalo — es óptica, no software, si el mismo QR se lee con otra cámara.

---

## Registro de resultados

| Sección | Resultado (OK/FALLO/N-A) | Evidencia (captura/nota) | Fecha |
|---|---|---|---|
| 1. Emparejamiento QR (desk host) | | | |
| 2. Roles invertidos (iPhone host) | | | |
| 3. Sync incremental | | | |
| 4. Conflictos LWW / deduplicación | | | |
| 5. Offline real + cortes | | | |
| 6. Límites de red (no conectar) | | | |

**Criterio de cierre:** las 6 filas en OK = sync P2P certificado para
anunciar. FALLO en 1-2 = bloqueante del anuncio de sync (el resto del
lanzamiento puede seguir); FALLO en 5 = bloqueante de reputación (revisar
ANTES de lanzar cualquier mención de "air-gapped"); FALLO en 4 o 6 =
bloqueante si implica pérdida o duplicación de datos del usuario.
