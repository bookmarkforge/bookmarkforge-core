# Hoja de sesión — Drill P2P iPhone ↔ escritorio (capturas y orden)

> **Qué es:** la hoja de ejecución para tener al lado durante el drill.
> El guion completo con criterios y explicaciones está en
> [p2p-sync-manual-test-script.md](p2p-sync-manual-test-script.md); aquí solo
> va el **orden de ejecución** y **qué capturar en cada momento** para que la
> sesión produzca evidencia utilizable (soporte, marketing de privacidad y
> diagnóstico post-mortem si algo falla).
>
> - **Duración:** ~40 min. **Imprime o abre esta hoja en un tercer dispositivo.**
> - Antes de empezar: lee el guion completo una vez. Durante la sesión, NO
>   improvises: si algo se desvía, captura y anota — no arregles y sigas.

---

## 0. Pre-sesión (antes de tocar la app)

| # | Verificación | Hecho |
|---|---|---|
| 0.1 | iPhone y escritorio en la **misma Wi-Fi** (no red de invitados) | |
| 0.2 | Ambos con la app en **HTTPS** y bóveda desbloqueada | |
| 0.3 | Escritorio con **cámara web** operativa (pruébala en otra web) | |
| 0.4 | iPhone con Safari con permiso de cámara pendiente de aceptar | |
| 0.5 | Papel y bolígrafo para la lista de títulos de prueba | |
| 0.6 | Carpeta de evidencia creada con convención de nombres: `p2p-<NN>-<qué>-<dispositivo>.png` (ej.: `p2p-05-sync-success-phone.png`) | |
| 0.7 | Anota en papel: **versión de iOS**, modelo de iPhone, navegador/versión del escritorio, SSID de la red | |

**Datos de prueba (crea y anota los títulos exactos):**
- Escritorio: 2 marcadores + 1 documento con **DESK**
- iPhone: 2 marcadores + 1 documento con **PHONE**
- (Se crean sobre la marcha en secciones posteriores: **SWAP**, **INC1**,
  **INC2**, **WINS-DESK**, **WINS-PHONE**, **DUPTEST**)

---

## 1. Aviso LAN (nuevo) — ANTES de emparejar (2 min)

> La app ahora advierte del requisito de misma LAN en el selector de roles.
> Verifícalo en ambos dispositivos: es la primera línea de defensa del
> usuario contra el fallo de conectividad más común.

| # | Acción | Captura esperada |
|---|---|---|
| 1.1 | Escritorio: Dashboard → "Secure P2P Sync" | Tarjeta de advertencia visible: *"Both devices must be on the same Wi-Fi network"* + cuerpo + consejo | `p2p-01-lan-warning-desk.png` **(ya pre-capturada** por `node scripts/capture-p2p-desk-drill.mjs`**)** |
| 1.2 | iPhone: mismo modal | La tarjeta en el **idioma del iPhone** (los 30 idiomas están traducidos — si sale en inglés siendo otro el idioma del sistema, es hallazgo) | `p2p-02-lan-warning-phone.png` |

---

## 2. Emparejamiento #1 — escritorio anfitrión (10 min)

| # | Momento | Captura |
|---|---|---|
| 2.1 | QR de oferta en el escritorio | `p2p-03-offer-qr-desk.png` **(ya pre-capturada** por el script**; genera un QR nuevo en cada sesión** — el de la carpeta es de otra sesión y expiró) |
| 2.2 | iPhone tras escanear: **su** QR de respuesta | `p2p-04-answer-qr-phone.png` |
| 2.3 | Barra "Syncing vaults..." a mitad (cualquiera de los dos) | `p2p-05-syncing.png` |
| 2.4 | "Sync Successful!" en **ambos** | `p2p-06-success-desk.png` + `p2p-07-success-phone.png` |
| 2.5 | iPhone mostrando los títulos **DESK** (marcadores y documentos) | `p2p-08-desk-items-on-phone.png` |
| 2.6 | Escritorio mostrando los títulos **PHONE** | `p2p-09-phone-items-on-desk.png` |

**Anota:** tiempo total del emparejamiento (de QR a "Successful").

---

## 3. Roles invertidos — iPhone anfitrión (5 min)

| # | Momento | Captura |
|---|---|---|
| 3.1 | iPhone como host mostrando su QR | `p2p-10-offer-qr-phone.png` |
| 3.2 | "Sync Successful!" en ambos | `p2p-11-success-swap.png` |
| 3.3 | Marcadores **SWAP** presentes en el lado contrario | `p2p-12-swap-converged.png` |

---

## 4. Sync incremental (5 min)

| # | Momento | Captura |
|---|---|---|
| 4.1 | **INC1** (creado en iPhone) visible en escritorio | `p2p-13-inc1-on-desk.png` |
| 4.2 | **INC2** (creado en escritorio) visible en iPhone | `p2p-14-inc2-on-phone.png` |
| 4.3 | Edición de descripción de un **DESK** llegada al iPhone | `p2p-15-edit-propagated.png` |

**Anota:** cualquier duplicado (mismo título 2 veces = FALLO de sección).

---

## 5. Conflictos LWW y deduplicación (8 min)

> Recuerda: 2-3 minutos entre las dos ediciones de WINS para timestamps
> inequívocos. Anota el ORDEN de edición ANTES de emparejar.

| # | Momento | Captura |
|---|---|---|
| 5.1 | Tu nota en papel: "edité WINS-DESK primero, WINS-PHONE después" | (papel) |
| 5.2 | Tras sync: AMBOS dispositivos mostrando el ganador | `p2p-16-lww-winner-desk.png` + `p2p-17-lww-winner-phone.png` |
| 5.3 | El marcador conflictivo aparece UNA sola vez por bóveda | (visible en 16/17) |
| 5.4 | **DUPTEST** creado en ambos: una sola entrada tras el sync | `p2p-18-dedup.png` |
| 5.5 | DESK/PHONE/INC intactos (sin daños colaterales) | (visible en 16/17) |

---

## 6. Offline real y cortes (7 min)

| # | Momento | Captura |
|---|---|---|
| 6.1 | Router sin internet: sync completo igual que en sección 2 | `p2p-19-offline-success.png` |
| 6.2 | Corte a mitad de barra (cierra modal en el escritorio) → el error visible si lo hay | `p2p-20-midcut.png` |
| 6.3 | Re-emparejamiento tras el corte: completa sin duplicados | `p2p-21-recovery-success.png` |
| 6.4 | Safari 10 s en segundo plano a mitad de emparejamiento → error visible (nunca "completado" falso) | `p2p-22-bg-interrupt.png` |
| 6.5 | Ambas bóvedas desbloqueables con datos intactos tras todo lo anterior | `p2p-23-vaults-intact.png` |

---

## 7. Límites de red — lo que NO debe conectar (5 min)

| # | Momento | Captura |
|---|---|---|
| 7.1 | iPhone en **datos móviles**: intento de emparejamiento → error/timeout visible | `p2p-24-mobiledata-error.png` |
| 7.2 | Vuelta a la LAN → sync funciona (sin estado roto) | `p2p-25-back-on-lan.png` |

**El valor de 7.1:** junto con `p2p-02`, demuestra que al usuario se le avisó
ANTES (tarjeta LAN) y que el fallo fuera de la LAN es visible, no un cuelgue.

---

## 8. Hallazgos iOS (captura SIEMPRE que ocurran)

- [ ] Banner "WebRTC is not supported" en el iPhone → **BLOQUEANTE**, captura
      `p2p-30-webrtc-unsupported.png` y anota la versión de iOS.
- [ ] Cámara falla en la PWA instalada pero funciona en Safari → captura
      `p2p-31-pwa-camera.png`; documentar "empareja desde Safari".
- [ ] QR que la webcam del escritorio no lee (óptica): anótalo, no es código.
- [ ] Cualquier error con texto vacío, en inglés en un sistema en otro idioma,
      o un cuelgue sin mensaje → captura + descripción del paso exacto.

---

## Al terminar la sesión (15 min)

1. Rellena la tabla de resultados del
   [guion P2P](p2p-sync-manual-test-script.md) (6 filas).
2. Sube las capturas a la carpeta de evidencia del proyecto (no las borres:
   son tu material de soporte y de marketing de privacidad).
3. Cada hallazgo de la sección 8 → issue o entrada en el registro de
   lanzamiento con la captura enlazada.
4. Si las 6 filas están en OK: marca el ítem 16 (parte P2P) del
   [launch-checklist](launch-checklist.md) como verificado.

**Criterios de bloqueo (resumen del guion):**
- Sección 1-2 (emparejamiento básico) falla → **bloqueante del anuncio de
  sync**; el resto del lanzamiento puede seguir.
- Sección 6 (offline) falla → **bloqueante de reputación**: no se anuncia
  "air-gapped" hasta revisarlo.
- Pérdida/duplicación de datos en 5 o 7 → **bloqueante absoluto**.
