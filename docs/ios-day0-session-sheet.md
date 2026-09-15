# Day 0 — Drill de expulsión Safari/iOS: hoja de inicio HOY

> **Qué es:** la hoja ejecutable para **hoy**, que arranca la prueba de 8 días
> del [guion iPhone](ios-manual-test-script.md) (sección 5) y deja las
> secciones 0–4 listas o hechas. La prueba real (día 8) es automática: pasa el
> tiempo; hoy solo hay que **sembrar** el estado correcto.

---

## Datos de la sesión

| Campo | Valor |
|---|---|
| **Fecha día 0** | `____________` (hoy) |
| **Día 7 previsto** | `____________` (+7 días) |
| **Día 8 de verificación** | `____________` (+8 días) |
| **iOS del iPhone** | `____________` |
| **SSID de tu Wi-Fi** | `____________` |
| **Carpeta de capturas** | `evidencia-ios-day0/` (`ios-NN-que.png`) |

---

## 0. Servidor de la sesión — producción + HTTPS (ya arrancado en tu PC)

La app necesita **contexto seguro** (WebCrypto, cámara, PWA) y el drill usa la
**build de producción real**: en dev el service worker es un passthrough y la
sección 4 (PWA + modo avión) daría falsos negativos. Estado actual:

```powershell
# En PowerShell, desde D:\bookmark6 (por si hay que rearrancarlo):
$env:VITE_DEV_HTTPS = "1"
node node_modules/vite/bin/vite.js preview --host 0.0.0.0 --port 4174 --strictPort
```

- Build verificada hoy: `node scripts/build-ci.mjs` (presupuestos OK) —
  **reconstruye si tocas código después de esto**.
- PC ya verificado: `https://192.168.0.22:4174/app`, `/sw.js`,
  `/manifest.webmanifest` responden **200** (esa es TU IP Wi-Fi ahora; si
  cambia, usa la que imprima el server).
- iPhone y PC deben estar en la **misma red** (el SSID anotado arriba).
- Si Safari no conecta: permite Node.js en el **Firewall de Windows** para
  redes privadas (o marca tu Wi-Fi doméstico como red *Privada*) y reintenta.
- El certificado es **auto-firmado**: el iPhone pedirá aceptarlo UNA vez
  (paso 1.2 abajo). En producción NO hará falta.

---

## 1. Preparación en el iPhone (según guion §Preparación)

| # | Paso | OK |
|---|---|---|
| 1.1 | Safari → `https://192.168.0.22:4174/app` (o tu URL prod) | |
| 1.2 | Safari avisa de certificado no confiable → **Visit Website** → **Visit Anyway** (solo para el drill en dev; en producción NO hará falta) | |
| 1.3 | Capturas activas (botón lateral + volumen arriba) | |
| 1.4 | Contraseña de prueba en papel: `prueba-iphone-2026` (18 chars) | |

---

## 2. Secciones 1–4 del guion (~35 min)

Ejecútalas en orden desde el guion; aquí solo el mapa de capturas:

| Sección | Capturas mínimas (`evidencia-ios-day0/`) |
|---|---|
| **1. Bóveda + 12 chars** | `ios-01-rechazo-11.png`, `ios-02-creacion.png`, `ios-03-unlock.png` |
| **2. Frase 24 palabras** | `ios-04-frase.png` (sin las palabras), papel con las 24 |
| **3. Backup .bmf** | `ios-05-export.png`, `ios-06-bmf-icloud.png`, `ios-07-restaurado.png` |
| **4. PWA** | `ios-08-instalada.png`, `ios-09-standalone.png`, `ios-10-avion.png` |

Criterios de éxito por sección: los del guion (11 rechazada / 24 exactas /
.bmf fuera del dispositivo / standalone sin barra Safari).

---

## 3. Día 0 — sembrar la expulsión (2 min, lo importante de hoy)

1. [ ] Abre la app en **Safari normal** (NO desde el icono PWA) y verifica que
   tu marcador de prueba sigue ahí.
2. [ ] **Cierra la pestaña y NO vuelvas a abrir esa URL en Safari** hasta el
   día 8. Ni un vistazo: una apertura resetea el contador de inactividad.
3. [ ] Opcional: captura el aviso de expulsión de Safari si la app lo muestra
   (`ios-11-aviso-expulsion.png`).
4. [ ] La **PWA instalada** puedes usarla con normalidad durante la semana
   (de hecho es interesante: la app instalada suele tener mejor trato de
   almacenamiento — el día 8 comparamos ambos mundos).
5. [ ] Rellena la fila "Día 0" del registro de abajo.

---

## 4. Día 3 — control intermedio (2 min)

1. [ ] NO abras la app en Safari. Solo verifica que tu `.bmf` sigue en iCloud
   Drive / correo (`ios-12-bmf-sigue.png` opcional).
2. [ ] Confirma la fecha del día 8 en el calendario con un recordatorio.

---

## 5. Día 8 — la prueba real (5 min, según guion §5)

1. [ ] Abre la app en **Safari** por primera vez desde el día 0.
2. [ ] **Resultado A (esperado):** arranca "vacía" — flujo de primera vez /
   restauración, NUNCA error de corrupción. → `ios-13-dia8-expulsada.png`
3. [ ] Restaura desde el `.bmf` de iCloud → todo vuelve → `ios-14-restaurada.png`
4. [ ] **Resultado B (sobrevivió):** anótalo; repite abriendo solo la PWA, o
   acepta que iOS trató tu sitio como activo. En ambos casos: sin corrupción.
5. [ ] En ambos casos la app debe **avisar** antes de dar datos por perdidos
   (nunca pérdida silenciosa).

---

## Registro de la sesión

| Hito | Fecha | Resultado | Notas |
|---|---|---|---|
| Secciones 1–4 ejecutadas | | | |
| Día 0 sembrado (Safari cerrado) | | | |
| Día 3 control (.bmf en iCloud) | | | |
| Día 8 apertura Safari | | | Resultado A / B |
| Restauración día 8 | | | |

**Cierre:** con las secciones 1–4 en OK y el día 8 en A-o-B-sin-corrupción,
el iPhone queda **certificado para lanzamiento** (fila 5 del registro del
guion).
