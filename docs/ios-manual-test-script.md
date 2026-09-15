# Guion de prueba manual en iPhone — BookmarkForge (pre-lanzamiento)

> **Objetivo:** validar en un iPhone real las rutas que ninguna automatización
> puede certificar — Safari/WebKit iOS es el motor con el comportamiento más
> agresivo contra los datos locales (expulsa IndexedDB tras 7 días de
> inactividad, cuotas distintas, gestión de descargas diferente). Si algo falla
> aquí, es un bloqueante de lanzamiento: los usuarios que pierden datos no
> perdonan.
>
> - **Duración total:** ~45 min la primera sesión + 2 visitas de 5 min durante
>   8 días (prueba de expulsión de Safari).
> - **Necesitas:** iPhone con iOS 16+, la URL de producción (o staging HTTPS —
>   el SW y la instalación requieren contexto seguro), papel para la frase,
>   acceso a tu correo para verificar la copia en la nube.
> - **Regla de oro:** documenta cada resultado con captura de pantalla. Lo que
>   no está documentado, no cuenta como probado.
> - **Relación:** complementa el ítem 16 de [launch-checklist.md](launch-checklist.md)
>   y el runbook [launch-day-smoke.md](launch-day-smoke.md). Las 24 palabras y
>   la contraseña mínima ya están automatizadas en Chromium/Firefox/WebKit de
>   escritorio; aquí se certifica el dispositivo real.

---

## Preparación (5 min)

1. [ ] Abre Safari en el iPhone y navega a la URL de la app (HTTPS obligatorio).
2. [ ] Verifica que la página carga sin advertencias de certificado.
3. [ ] Ajustes → activa **Copiar de Safari** si quieres guardar capturas:
       botón lateral + volumen arriba (o Asistencia → "captura de pantalla").
4. [ ] Ten a mano: **contraseña de prueba** (mínimo 12 caracteres — p. ej.
       `prueba-iphone-2026`), papel y bolígrafo.

---

## 1. Creación de bóveda y contraseña de 12 caracteres (10 min)

1. [ ] Inicia la app por primera vez: debe aparecer el flujo de creación
       (SecurityConfirmation → crear bóveda).
2. [ ] **Prueba negativa:** escribe una contraseña de **11 caracteres**
       (p. ej. `prueba-11-abc`). El validador debe rechazarla ANTES de crear
       nada — busca el mensaje de mínimo de caracteres. _Captura._
3. [ ] Escribe la contraseña de 12+ (`prueba-iphone-2026`) y confirma.
4. [ ] La creación en iPhone puede tardar **20-60 s** (Argon2id móvil,
       64 MiB): es normal; si tarda más de 2 min, anótalo como hallazgo.
5. [ ] Al terminar, la app debe abrir desbloqueada (Dashboard).
6. [ ] **Bloquea la bóveda** y desbloquéala con la misma contraseña:
       el round-trip bloquear→desbloquear debe funcionar sin errores.
       _Captura del desbloqueo._
7. [ ] Deja la app con **1 marcador de prueba** creado (lo necesitas para la
       sección 3): añade un marcador con URL y título reconocibles
       (p. ej. "iPhone smoke test").

**✅ Criterio de éxito:** contraseña de 11 rechazada, 12 aceptada,
bloquear/desbloquear OK, marcador visible.

---

## 2. Frase de recuperación de 24 palabras (10 min)

1. [ ] Si aún la tienes en pantalla, salta al paso 3. Si no: Ajustes de la
       bóveda → opción de mostrar/verificar frase de recuperación
       (introduce la contraseña si la pide).
2. [ ] **Copia las 24 palabras A MANO en papel** — no uses capturas ni notas
       del teléfono. Es exactamente lo que pediremos a los usuarios.
3. [ ] Verifica el contador: deben ser **24 palabras exactas**, ni 12 ni 23.
       _Captura de la pantalla de la frase (sin las palabras en el marco)._
4. [ ] **Prueba negativa:** usa la función de recuperación con la frase
       **incompleta a propósito** (23 palabras). Debe rechazarla con mensaje
       claro y NO desbloquear nada.
5. [ ] Ahora recupera con las 24 palabras correctas (en el orden exacto).
       La bóveda debe desbloquearse.
6. [ ] OJO: entre un intento fallido y el reintento espera **unos segundos** —
       el servicio limita a un intento cada 2 s (anti fuerza bruta).

**✅ Criterio de éxito:** 24 palabras exactas en papel; 23 rechazadas;
24 desbloquean la bóveda.

---

## 3. Backup cifrado .bmf y restauración (10 min)

1. [ ] Con la bóveda desbloqueada: Ajustes → Almacenamiento → **Export Backup**.
2. [ ] Cuando pida contraseña del backup, usa **la misma contraseña de la
       bóveda** (`prueba-iphone-2026`) — el asistente de restauración la
       esperará tras una pérdida total.
3. [ ] Safari descargará el archivo: localízalo en **Archivos → Descargas**
       (Safari iOS). Mueve una copia a **iCloud Drive** (o mándatela por
       correo) — esto simula el backup FUERA del dispositivo que recomendamos.
       _Captura del archivo en iCloud/Correo._
4. [ ] Verifica que el archivo tiene extensión **.bmf** y tamaño no cero.
5. [ ] **Simula pérdida total:** Ajustes → Safari → Avanzado → **Datos de
       sitios web** → busca el dominio de la app → **Eliminar**. Esto borra
       IndexedDB/localStorage — el desastre real que puede provocar Safari.
6. [ ] Vuelve a abrir la app: debe arrancar como primera vez.
7. [ ] Sigue el asistente de restauración (F0-2): elige restaurar desde
       archivo → selecciona el .bmf de iCloud Drive → introduce la contraseña
       del backup.
8. [ ] La bóveda debe abrirse desbloqueada y **tu marcador de prueba debe
       estar** (búscalo por su título). _Captura del marcador restaurado._
9. [ ] Nota: tras restaurar, la app usa la MISMA contraseña de bóveda de
       siempre — la restauración no cambia las credenciales.

**✅ Criterio de éxito:** .bmf exportado y fuera del dispositivo; tras borrar
datos del sitio, la restauración recupera el marcador.

---

## 4. PWA e instalación en pantalla de inicio (5 min)

1. [ ] En Safari: botón Compartir → **Añadir a pantalla de inicio**.
       Debe sugerir el nombre/icono de la app (manifest cargado).
2. [ ] Ábrela desde el icono: debe abrir **a pantalla completa** (sin barra
       de Safari — `display: standalone`).
3. [ ] Verifica el **modo avión**: con la app ya cargada, activa avión,
       cierra y reabre la app desde el icono. Debe abrir desde el caché del
       service worker (puede mostrar estado "sin conexión", pero la bóveda
       desbloqueable si la sesión lo permite).
4. [ ] Desactiva avión.

**✅ Criterio de éxito:** instalable con icono/nombre correctos, standalone,
y la app en modo avión no se rompe.

---

## 5. La prueba de los 7 días — expulsión de IndexedDB por Safari (8 días)

> Esta es LA prueba que motiva los avisos de la app. Safari borra los datos
> de sitios web tras **7 días de inactividad** (los datos de la app de inicio
> instalada tienen mejor trato, pero NO confíes: pruébalo también en Safari
> normal). Tu defensa: el aviso de riesgo de expulsión + backups + sync.

### Día 0 (hoy, 2 min)

1. [ ] En Safari (no en la PWA), abre la app y verifica que tu marcador
       sigue. Deja la sesión PERSISTENTE cerrada (no la abras más).
2. [ ] Opcional pero recomendado: instala la captura del aviso — verifica que
       la app MUESTRA el aviso de expulsión de Safari (7 días) en algún punto
       del onboarding/ajustes. _Captura del aviso._

### Día 3 (2 min) — control intermedio

1. [ ] NO abras la app todavía. Solo verifica que tu .bmf sigue en iCloud
       Drive / correo.
2. [ ] Anota la fecha del día 7 previsto.

### Día 8 (5 min) — la prueba real

1. [ ] Abre la app en **Safari** (no la PWA) por primera vez desde el día 0.
2. [ ] **Resultado A (esperado):** la app arranca "vacía" — Safari expulsó
       los datos. Debe mostrarse el flujo de primera vez / restauración, NO
       un error de base de datos corrupta. _Captura._
3. [ ] Restaura desde tu .bmf de iCloud (sección 3, pasos 7-8). Todo debe
       volver, incluido el marcador de prueba.
4. [ ] **Resultado B (si los datos sobrevivieron):** anótalo — puede pasar si
       el iPhone consideró el sitio activo. Repite el experimento abriendo
       solo la PWA instalada, o acepta que iOS moderno trató tu uso como
       actividad. En cualquiera de los dos casos, la app no debe corromperse.
5. [ ] En ambos casos: verifica que la app NO pierde la bóveda de forma
       silenciosa — siempre debe avisar (aviso de expulsión, asistente de
       restauración) antes de dar por perdidos datos.

**✅ Criterio de éxito:** tras 7+ días sin abrir, la app degrada con gracia
(primera vez + restauración), nunca con corrupción ni pérdida silenciosa.

---

## 6. Lo que NO cubre esta prueba (y por qué está bien)

- **Rendimiento del KDF en hardware real**: el perfil de 64 MiB ya está
  certificado en CI con Android emulado (`npm run e2e:mobile`); en iPhone lo
  que se mide aquí es que la creación tarda un tiempo razonable (<2 min).
- **Firefox/iPad/Android reales**: cubiertos por las baterías automatizadas
  (e2e:engines, e2e:mobile). Este guion es específico del motor que ninguna
  automatización local alcanza: Safari iOS real.
- **Sincronización P2P entre dispositivos**: merece su propio guion (iPhone ↔
  escritorio con QR). Si vas a lanzar sync, prueba aparte ANTES del anuncio.

---

## Registro de resultados

| Sección | Resultado (OK/FALLO/N-A) | Evidencia (captura/nota) | Fecha |
|---|---|---|---|
| 1. Bóveda + contraseña 12 | | | |
| 2. Frase de 24 palabras | | | |
| 3. Backup .bmf + restauración | | | |
| 4. PWA / standalone | | | |
| 5. Expulsión Safari (día 8) | | | |

**Criterio de cierre:** las 5 filas en OK = dispositivo iOS certificado para
lanzamiento. Cualquier FALLO en 1-3 es bloqueante; en 4-5, bloqueante si
impide recuperar datos, hallazgo si es cosmético.
