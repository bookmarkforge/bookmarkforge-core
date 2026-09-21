# Medios de demostración (capturas, GIF y vídeo)

Este documento describe los medios de demostración que acompañan al README, cómo
se generan de forma reproducible y qué comprobaciones superan antes de
publicarse. Ningún medio muestra datos reales: la bóveda, la contraseña, el kit
de recuperación y los bookmarks son datos de demostración creados por los
propios scripts.

## Inventario

| Archivo | Contenido | Tamaño |
| --- | --- | --- |
| `docs/bookmarkforge-demo-tour.webm` | Recorrido completo en vídeo, 1280×720, 47 s | 1,0 MB |
| `docs/bookmarkforge-demo-tour-poster.png` | Póster enlazado al vídeo, con distintivo de reproducción | 360 KB |
| `docs/bookmarkforge-demo-tour.gif` | Resumen en bucle, 640 px, 6 fotogramas | 87 KB |
| `docs/bookmarkforge-demo-app.png` | Panel desbloqueado (1440×900) | 140 KB |
| `docs/bookmarkforge-demo-capture.png` | Captura rápida con URL escrita | 142 KB |
| `docs/bookmarkforge-demo-bookmarks.png` | Lista de bookmarks | 102 KB |
| `docs/bookmarkforge-demo-search.png` | Búsqueda en vivo | 102 KB |
| `docs/bookmarkforge-demo-locked.png` | Bóveda bloqueada | 41 KB |
| `docs/bookmarkforge-demo-mobile-*.png` | Flujo móvil (390×844 a 2×) | 70–150 KB |
| `docs/bookmarkforge-demo-landing-hero.png` | Hero de la landing | 187 KB |
| `public/landing-demo-tour.gif` | Copia que sirve la landing (`/landing-demo-tour.gif`) | 87 KB |

La columna `public/` es la única excepción al «todo vive en `docs/`»: es una
copia derivada, no una fuente. El motivo y el contrato están en
[Publicación en el README y la landing](#publicación-en-el-readme-y-la-landing).

## Flujo compartido

Las capturas y el vídeo no se generan por separado: ambos importan
`scripts/demo-tour-flow.mjs`, que contiene los pasos reales (confirmación de
seguridad, creación de bóveda, kit de recuperación, captura rápida, lista de
bookmarks, búsqueda y bloqueo). Un cambio de selector o de flujo no puede hacer
que el vídeo y las capturas muestren productos distintos.

Los helpers aceptan un gancho `pause(ms)` opcional: las capturas lo omiten
(esperan solo a estados reales de la interfaz) y el vídeo lo usa para que un
observador humano pueda seguir las transiciones.

## Generación

### Receta completa de cero

```bash
# 0) prerrequisitos
npx playwright install chromium      # navegador de la grabación y las capturas
# ffmpeg: se usa el que Playwright ya trae para grabar vídeo (ver limitaciones)

# 1) servidor de desarrollo en un puerto libre
npm run dev -- --host 127.0.0.1 --port 5199

# 2) capturas estáticas (escritorio y móvil)
npm run demo:capture-screens -- --base-url http://127.0.0.1:5199
npm run demo:capture-screens -- --base-url http://127.0.0.1:5199 --mobile

# 3) grabación del recorrido (WebM en bruto)
npm run demo:capture-tour -- --base-url http://127.0.0.1:5199

# 4) codificación, póster y verificación del WebM publicado
npm run demo:build-video

# 5) GIF de resumen a partir de las capturas
npm run demo:build-gif

# 6) copia que sirve la landing y verificación de todo el set
npm run demo:publish
npm run check:demo-media

# 7) puertas que cubren estas superficies
npm run check:landings-fresh && npm run check:marketing
npm run check:landing-smoke -- http://127.0.0.1:5199
```

`npm run demo:video` ejecuta los pasos 3 y 4 en secuencia. Los pasos 1–5 no
tocan `public/`; el paso 6 es el único que publica en la landing.

## Publicación en el README y la landing

Los medios tienen dos consumidores y cada uno necesita una ruta distinta:

| Consumidor | Ruta que referencia | Cómo llega ahí |
| --- | --- | --- |
| README de GitHub | `docs/bookmarkforge-demo-tour.gif`, `docs/bookmarkforge-demo-*.png` | Generados directamente en `docs/` |
| Landing (`/landing.html`, `/es/`, `/fr/`, `/de/`, `/pt/`, `/it/`) | `/landing-demo-tour.gif` | **Copia derivada** en `public/` |

El sitio solo sirve lo que está bajo `public/`, así que la sección de producto de
la landing usa una copia. Para que esa copia no se convierta en un fork del
medio real:

- `npm run demo:publish` copia `docs/bookmarkforge-demo-tour.gif` a
  `public/landing-demo-tour.gif`;
- `npm run demo:publish:check` y `npm run check:demo-media` comparan copia y
  fuente **byte a byte** y fallan si difieren, si la copia está truncada o si
  falta. El presupuesto de bytes y la estructura del GIF se aplican a la copia
  igual que al original.

La sección vive en `scripts/templates/landing/landing.njk` (bloque
`<!-- Product Demo Section -->`) y su copy en la clave `demo` de
`scripts/translations/{en,es,fr,de,pt,it}.json`. Sus estilos
(`.demo-tour…`) están en `public/landing.css`, todos con tokens de marca: no
hay hexadecimales propios, como exige `check:static-brand`.

Después de cambiar el template, la copy o los medios hay que regenerar las
páginas y confirmarlas:

```bash
npm run demo:publish          # refresca la copia que sirve la landing
npm run build:landings        # reescribe public/landing.html, es, fr, de, pt, it
npm run check:landings-fresh  # el HTML confirmado debe coincidir con el template
```

Añadir otro medio a la landing es declararlo en `PUBLISHED_DERIVATIVES`
(`scripts/check-demo-media.mjs`): una entrada da la copia, el presupuesto, la
comprobación de estructura y el control de deriva a la vez.

## Por qué hay vídeo y GIF

El formato GIF no tiene compresión entre fotogramas y su paleta se limita a 256
colores: el resumen en bucle solo puede mantener 6 fotogramas a 640 px. El vídeo
WebM (VP8) conserva movimiento real, color completo y texto nítido a 1280×720 en
1,0 MB.

Los dos formatos siguen publicados porque GitHub no reproduce dentro del README
un vídeo alojado en el repositorio, mientras que un GIF sí se anima en línea. El
vídeo es el recorrido completo; el GIF es el resumen que se ve sin hacer clic.

## Cómo conseguir reproducción en línea en GitHub

1. Abre un issue o un comentario y adjunta `docs/bookmarkforge-demo-tour.webm`
   arrastrándolo al cuadro de texto.
2. GitHub responde con una URL `https://github.com/user-attachments/assets/…`.
3. Sustituye en el README el enlace al archivo por esa URL conservando el
   póster.

Así el README muestra un reproductor nativo, sin sacar el archivo del
repositorio ni depender de servicios externos.

## Verificación del vídeo

`npm run demo:build-video` no publica nada hasta que se cumplen cuatro controles,
y falla con salida distinta de cero si alguno no pasa:

| Control | Qué comprueba |
| --- | --- |
| Estructura | Cabecera EBML y `DocType` `webm` reales, sin archivo truncado |
| Presupuesto | Tamaño dentro del presupuesto de medios del README (`--max-bytes`, 3 MB por defecto) |
| Fidelidad | Diferencia media absoluta por canal frente a la grabación original en fotogramas muestreados (`--max-mae`, 6 por defecto) |
| Reproducción | Chromium real: geometría, duración y presentación de fotogramas sucesivos |

El control de fidelidad existe porque una recodificación puede parecer correcta
en el registro del codificador y aun así emborronar el texto. El de reproducción
existe porque un contenedor estructuralmente válido puede no decodificar.

Medición del artefacto actual (equipo de desarrollo, 2026-09-21):

```text
Duración            47,64 s
Resolución          1280x720
Fotogramas          25 fps
Tamaño publicado    1.055.518 bytes (1,0 MB)
Grabación en bruto  3.390.096 bytes
Fidelidad           diferencia media absoluta máxima 3,47 sobre 6
Reproducción        Chromium, readyState 4, fotogramas sucesivos confirmados
```

## Job nocturno de CI

El workflow `demo-media.yml` regenera los medios cada noche a las 04:41 UTC (y
bajo `workflow_dispatch`) ejecutando un único comando versionado:

```bash
npm run demo:nightly
```

Ese runner hace el ciclo completo y responde a dos preguntas:

| Pregunta | Cómo se comprueba | Consecuencia |
| --- | --- | --- |
| ¿Cabrá el GIF en el presupuesto? | El constructor lo rechaza y el gate revalida el archivo final | Falla el job |
| ¿Siguen coincidiendo las capturas con la UI actual? | Comparación de píxeles contra `docs/` con tolerancia | Falla el job si la procedencia coincide |
| ¿La copia que sirve la landing sigue siendo la misma? | `npm run demo:publish:check` compara `public/landing-demo-tour.gif` con su fuente byte a byte | Falla el job antes de gastar tiempo de navegador |

El job **nunca escribe en `docs/` ni en `public/`, ni hace commit**: las
capturas nuevas, el GIF regenerado y el informe JSON se suben como artefacto
(`demo-media-nightly`, 14 días) para que una persona revise el cambio y lo
confirme. Publicar la copia de la landing sigue siendo un paso humano
(`npm run demo:publish`) para que el medio servido no cambie sin revisión.

### Política de procedencia

El rasterizado de tipografías cambia entre sistemas operativos, así que comparar
píxeles contra imágenes generadas en otra plataforma mide el entorno, no la UI.
El manifiesto `docs/bookmarkforge-demo-manifest.json` registra la plataforma que
produjo los medios, y el runner lo lee: si coincide con la del ejecutor, la
deriva es un fallo; si no coincide, la registra como aviso y el presupuesto de
bytes sigue aplicándose igual.

Una vez que se confirman medios generados en el ejecutor, la comparación
estricta se reactiva sola.

### Calibración de umbrales

Los umbrales no son estimaciones, están medidos sobre este repositorio:

```text
Ruido entre dos capturas idénticas (misma máquina, reloj fijado)
  escritorio   0,000 – 0,006 % de píxeles
  móvil        hasta 0,025 % (contador de almacenamiento del panel)

Cambio real simulado (barra lateral redibujada)
  escritorio   8,132 % → 105.395 de 1.296.000 píxeles

Presupuesto de deriva por defecto   0,10 %   (4x el peor ruido, 81x bajo el cambio real)
Presupuesto del GIF por defecto     150 KB   (artefacto actual: 87 KB)
```

El ruido no es una propiedad del producto sino del reloj: la vista de bookmarks
muestra marcas de tiempo relativas, y dos capturas separadas por segundos
diferían en ese texto. Por eso las capturas fijan el reloj con
`DEMO_FIXED_TIME` (`page.clock.setFixedTime`, que fija `Date` sin congelar los
temporizadores, de modo que la creación de la bóveda y Argon2id siguen
ejecutándose de verdad). Antes de fijar el reloj, esa única vista derivaba un
0,713 % entre pasadas y obligaba a un presupuesto siete veces más laxo (0,40 %).

Con el reloj fijado, la separación entre «regenerado, mismo producto» y «el
producto cambió» supera los tres órdenes de magnitud.

### Comandos

```bash
npm run check:demo-media                 # presupuestos, estructura y copias publicadas
npm run demo:publish                     # refresca las copias que sirve la landing
npm run demo:publish:check               # solo verifica esas copias (sin escribir)
npm run demo:drift -- --reference docs --generated <dir>
npm run demo:nightly                     # ciclo completo (arranca el servidor si hace falta)
npm run demo:nightly -- --no-drift-check # solo presupuesto
```

El presupuesto y el umbral también se pueden apretar o relajar por ejecución con
`--max-bytes` y `--max-diff-ratio`, pero los valores por defecto son los
calibrados y están fijados por un test para que relajarlos sea una decisión
explícita.

`--gif <archivo>` en `check:demo-media` valida un GIF recién construido, y
`--json` devuelve un documento único parseable por otro script (los mensajes
humanos van a stderr).

## Requisitos y limitaciones conocidas

- La grabación necesita Playwright (`@playwright/test`) y su navegador Chromium.
- La codificación usa el `ffmpeg` que Playwright ya incluye para grabar vídeo. Si
  no se encuentra, el script falla con instrucciones y admite
  `BMF_FFMPEG_PATH` para apuntar a un `ffmpeg` completo, con el que además se
  usaría VP9.
- La creación de la bóveda y el desbloqueo están dominados por Argon2id. En el
  equipo ARM de referencia esto supuso unos 14 s de creación y 7 s de
  desbloqueo. Por eso `scripts/capture-demo-tour.mjs` crea la bóveda en una
  página que **no** se publica y graba una segunda página que empieza en la
  bóveda bloqueada: el vídeo muestra el producto en uso, no la latencia del
  equipo.
- El vídeo se graba con un viewport de escritorio de 1280×720; el flujo móvil se
  cubre con las capturas `bookmarkforge-demo-mobile-*.png`.
- Las capturas fijan el reloj de la página (`DEMO_FIXED_TIME`) para que las
  marcas de tiempo relativas no cambien entre pasadas. El reloj fijado solo
afecta a `Date`: los temporizadores siguen corriendo y la criptografía real
  (Argon2id) se ejecuta con normalidad.
- Los tiempos de espera están dimensionados para un runner compartido y no para
  el equipo de referencia: la creación y el desbloqueo de la bóveda permiten
  180 s cada uno (13 s medidos en local) y cada pasada de captura tiene un
testigo de 420 s. Una pasada llegó a fallar con el techo anterior de 60 s por
contensión de CPU.
- La compilación de módulos de Vite se calienta antes de grabar (`prepareVaultOffCamera`)
  para que la grabación no empiece con tirones de carga diferida.
