# ADR-055: Las superficies colapsables se colapsan y se ocultan con `visibility`

- **Estado:** aceptado (`CollapsibleSurface` implementado y usado por los tres
  banners del dashboard). **Enmendado 2026-09-22:** el hold pasa de altura
  *medida* a altura *natural* — ver "Enmienda 2026-09-22" al final.
- **Fecha:** 2026-09-18

## Contexto

Los banners del dashboard — riesgo de expulsión de Safari/iOS
(`EvictionBanner`), recordatorio de respaldo (`BackupReminderBanner`) y muro de
Free (`FreeTierNudge`) — se montaban siempre y se ocultaban con `opacity: 0`
más `pointer-events: none`, dejando su caja entera en el layout «para no
provocar layout shift». `HomeDashboard` añadía un contenedor con el mismo
contrato por banner.

Ese diseño tenía dos costes medidos en la app real (2026-09-18; webview de
escritorio, Windows, bóveda recién creada con cero marcadores):

1. **Ocupaba cientos de píxeles de nada.** Los contenedores ocultos medían
   280 px y 496 px: unos 780 px de espacio en blanco bajo banners invisibles.
   El espacio reservado es exactamente lo que el usuario percibe como
   «dashboard vacío» en la primera visita.
2. **No ocultaba de verdad.** `opacity: 0` no saca un subárbol del árbol de
   accesibilidad ni del orden de tabulación: el upsell «Llegaste a 1.000 — el
   límite de Free» se anunciaba por lector de pantalla con cero marcadores
   guardados, y sus botones «Ver Pro — $59» y «Seguir con Free» recibían foco
   con Tab estando invisibles (`document.activeElement === btn`, `tabIndex` 0)
   sin indicación de foco → WCAG 2.4.7. La alerta de pérdida de datos de
   Safari/iOS se anunciaba en una plataforma sin riesgo de expulsión.
   axe-core no evalúa enfocables con opacidad 0, así que la accesibilidad
   automatizada en CI no cubría esta clase de fallo.

## Decisión

1. **El box se colapsa; no se reserva.** `CollapsibleSurface`
   (`src/components/dashboard/components/CollapsibleSurface.tsx`) anima su
   propia altura entre `0` (oculto) y la altura medida de su contenido
   (visible), junto con sus márgenes verticales. Un banner que no debe estar en
   pantalla no cuesta espacio. `HomeDashboard` deja de montar contenedores
   espaciadores: el ritmo vertical lo fija la superficie.

2. **La medición es la única fuente de la altura.** La altura se mide con
   `scrollHeight` y se re-mide con `ResizeObserver`, de modo que un banner cuyo
   texto cambia estando colapsado (el recordatorio de respaldo cambiando a su
   redacción de «atrasado») se expande a la altura correcta en el siguiente
   revelado.

3. **Una medición fallida nunca oculta contenido.** Si la altura no se puede
   medir (jsdom, embedders exóticos: `scrollHeight` siempre 0), la superficie
   cae a `auto` cuando está visible. El peor caso es el comportamiento anterior
   —espacio reservado—, nunca un banner en blanco.

4. **`visibility: hidden` es obligatorio al ocultar.** `visibility` conserva el
   box y a la vez retira el subárbol del árbol de accesibilidad y del orden de
   tabulación; no hace falta `aria-hidden` ni `inert`.

5. **La transición es unidireccional.** Al ocultar, el cambio se difiere la
   duración de la animación (`visibility 0s linear 200ms`) para que el colapso
   se vea. Al mostrar, es inmediato: un revelado diferido animaría el contenido
   dentro de un subárbol todavía oculto y no se vería nada.

6. **Una sola duración.** `DURATION_COLLAPSE` / `COLLAPSE_MS`
   (`src/constants/motion.ts`) es el origen único del tiempo de la animación,
   compartido por la transición CSS de altura y por el fundido de motion del
   contenido, para que el box y su contenido no terminen en momentos distintos.

7. **El contrato queda fijado por tests.** `CollapsibleSurface.test.tsx` cubre
   colapso, expansión medida, re-medición tras un cambio de tamaño, el fallback
   `auto`, la transición unidireccional y que el contenido oculto no es
   alcanzable. Cada banner verifica además su propio estado oculto.

## Consecuencias

- Una bóveda nueva deja de arrastrar ~780 px de espacio en blanco: los banners
  ocultos ahora miden 0 px. Un usuario de teclado o de lector de pantalla ya no
  puede aterrizar en contenido que no está en pantalla.
- **Se acepta un layout shift al revelar — y está medido.** Reservar el
  espacio era, precisamente, la técnica que lo evitaba. Ahora, un banner que
  aparece tras su comprobación asíncrona (el de respaldo, el de expulsión)
  desplaza hacia abajo el contenido siguiente, animadamente. La decisión
  prioriza que el estado por defecto —todo oculto— no ocupe espacio sobre que
  la aparición tardía no mueva nada.

  Medición E2E con la Layout Shift API del navegador
  (`tests/e2e/dashboard-banner-cls.spec.ts`, Chromium, 2026-09-18), con dos
  baterías — escritorio 1200×720 y móvil 390×844 (emulación Pixel 7):

  | Batería | CLS del revelado | Bandas CWV |
  |---|---|---|
  | Escritorio | **0.068–0.085** (3 runs) | «good» (< 0.1) |
  | Móvil | **0.133–0.318** (2 runs, varianza alta) | fuera de «good» |

  **Enmienda 2026-09-22 — la deuda móvil queda cerrada con el hold natural.**
  La sonda de la batería (`tests/e2e/dashboard-banner-cls.spec.ts`) destapó
  que el hold de altura *medida* perdía la carrera contra el primer pintado:
  la caja pintaba con el estimado por defecto (160 px) antes de que llegara la
  medición, y la corrección 160→531 px **se animaba** (curva de transición
  visible: 160→312→516→531 en siete frames; CLS móvil 0.152 en la run de
  2026-09-22). El hold usa ahora la **altura natural** (`height: auto`,
  transiciones desactivadas mientras dura el hold): el contenido permanece
  montado bajo `visibility: hidden`, que no afecta al layout, así que la caja
  es exactamente tan alta como su contenido desde el primer layout — sin
  medición que perder la carrera, sin estimado que corregir, sin nada que
  animar. Medido tras la enmienda (misma batería): móvil `path=held`,
  `heldAtBaseline=531px`, `total=0.0000`; el hold es la altura real desde el
  primer layout. Ambos presupuestos de la batería se endurecen a la banda
  «good» de CWV (< 0.1) en ambas baterías — de tripwire de regresión bruta a
  exigencia de la banda buena. La reserva inicial no provoca shift cuando
  ocurre antes del primer pintado (el layout inicial del usuario ya la
  incluye); el spec lo verifica con el hold ya en sitio en la línea base.

  Fuentes atribuidas al propio banner (el bloque que crece) y al contenido que
  empuja (rejilla de funcionalidades, cabecera). El colapso tras descartar
  registra 0 (los shifts activados por interacción los excluye el navegador) y
  el arranque mide 0 en ambas baterías. El spec afirma los números con margen
  como guardia de regresión (escritorio ~3x; móvil ~2x sobre el peor run por
  su varianza) y escribe el artefacto JSON con `BMF_CLS_REPORT`.

  **Conclusión doble:** en escritorio, el colapso se mantiene sin reservar
  espacio — un revert parcial no está justificado por los datos. En móvil, en
  cambio, el mismo revelado sale del umbral «good»: el trade-off del colapso
  **no se sostiene tal cual en teléfonos**, y queda registrado como deuda con
  su arreglo designado (revelar desde un placeholder de altura medida, que
  elimina el shift sin reintroducir el vacío permanente) antes de instrumentar
  CLS real de usuarios móviles.
  *(Deuda cerrada el 2026-09-22 por la enmienda anterior: el hold natural es
  el «placeholder de altura medida» sin su defecto — la medición ya no corre
  contra el primer pintado.)*
- El residuo de espaciado no es cero: el `space-y-*` del contenedor del
  dashboard sigue aplicando su `margin-top` al hermano siguiente, así que una
  superficie colapsada deja a lo sumo el hueco de un párrafo. Llevarlo a cero
  exigiría que el contenedor conociera el estado de cada banner; no merece la
  complejidad acoplada.
