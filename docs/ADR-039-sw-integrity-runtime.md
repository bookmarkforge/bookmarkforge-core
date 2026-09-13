# ADR-039: Verificación de integridad de assets dentro del Service Worker (chunks lazy incluidos)

- **Estado:** aceptado (implementado; ancla `p3-sw-integrity-runtime`)
- **Fecha:** 2026-09-02

## Contexto

La auditoría del 2026-09-02 (`docs/audit-report-2026-09-02.md`, hallazgo B-1,
primera de las "mejoras de alto impacto") demostró que la verificación de
integridad en runtime solo cubría el DOM inicial:

1. `checkBundleIntegrity` (`src/utils/bundleIntegrity.ts`) hashea los
   `script[src]` / `link[stylesheet]` / `link[modulepreload]` presentes al
   arrancar. Los chunks lazy (blocknote, pdf, WebLLM, locales — los mismos
   que el SW sirve vía CacheFirst/StaleWhileRevalidate) se cargan después y
   nunca se re-hashean.
2. El MutationObserver (`startScriptInjectionGuard`) solo ve elementos
   `<script>`; un chunk entregado a un `import()` dinámico no pasa por ahí.

Un atacante con escritura en el origen (deploy comprometido, CDN envenenada,
cache poisoning) podía servir un chunk modificado tras el boot sin disparar
`bundle-integrity-failed`.

## Decisión

1. **El punto de verificación es el Service Worker** — el cuello de botella
   por el que pasa CADA asset servido. Dos plugins de `vite.config.ts`
   colaboran:
   - `bookmarkforge:integrity-manifest` escribe `dist/integrity-manifest.json`
     (copia de la superficie verificada, fuente única de verdad para el
     embed y para tooling/diagnóstico);
   - `bookmarkforge:sw-integrity-embed` — un plugin DEDICADO con
     `closeBundle: { order: "post" }` — incrusta ese manifest JSON y el
     runtime `scripts/sw-integrity-runtime.js` al INICIO del `sw.js`
     generado por Workbox (byte 0). El `order: "post"` es obligatorio:
     vite-plugin-pwa escribe `sw.js` en su PROPIO closeBundle y los hooks
     sin `order` corren en orden de array (verificado empíricamente — una
     suposición de "orden inverso" hacía que el embed saltara en silencio
     porque `sw.js` aún no existía). El embed es idempotente (marcadores
     `__BMF_SW_INTEGRITY_EMBED_START__/END__`); la asignación del manifest
     termina en `;` para evitar el join ASI con la IIFE del runtime (bug
     real detectado por la verificación de artefacto: el SW completo
     lanzaba TypeError al evaluar). El runtime envuelve
     `FetchEvent.prototype.respondWith`, por lo que su cobertura no depende
     del orden de registro de las rutas de Workbox.
   - `sw.js` e `index.html` quedan excluidos del manifest
     (auto-referenciales).
2. **Runtime fail-closed** (`scripts/sw-integrity-runtime.js`, cuerpo de
   script puro, sin imports/exports): envuelve `FetchEvent.prototype.
   respondWith`; para GET same-origin cuyo pathname está en el manifest,
   hashea el body (SHA-256 WebCrypto) y en mismatch responde **504** (el
   chunk NUNCA ejecuta), borra la entrada envenenada de todas las caches
   (`ignoreSearch` para las URLs de precache con revisión) y notifica a los
   clients con `postMessage({type:"bundle-integrity-failed", reason:
   "sw-cache-handler", …})`. Sin manifest (dev/test) no se parchea nada.
3. **Puente hacia el contrato existente:** `initSwIntegrityBridge`
   (`src/utils/swIntegrityBridge.ts`, cableado en `main.tsx`) reproduce el
   mensaje del SW como `window` CustomEvent `bundle-integrity-failed`, así
   AppInitializer (pantalla de recuperación) y `telemetry/productionMonitor`
   reaccionan sin cambios.
4. **Gate de build (scripts/build-ci.mjs):** `build:ci` verifica que el
   embed existe exactamente una vez en el byte 0 del `sw.js`, extrae el
   manifest embebido (sin auto-referencias), EJECUTA los bytes embebidos
   contra un entorno SW sintético y prueba los veredictos: runtime activo,
   `respondWith` envuelto, asset genuino verificado y byte alterado
   rechazado — sobre un asset REAL de `dist/`. Esto convierte en fallo de
   CI las dos clases de fallo encontradas durante el desarrollo (salto
   silencioso del embed por orden de hooks; TypeError ASI al evaluar).
5. **Regresión anclada:** `src/tests/security/p3-sw-integrity-runtime.
   regression.test.ts` (ancla `p3-sw-integrity-runtime` en
   `scripts/audit-anchors.mjs` + baseline) fija las tres costuras; el
   comportamiento del runtime se prueba ejecutando los bytes reales contra
   un SW sintético (`scripts/__tests__/sw-integrity-runtime.test.mjs`).

## Consecuencias

- La integridad pasa de "DOM inicial" a "todo el runtime": cada respuesta de
  asset servida por el SW — precache y chunks lazy — se verifica contra el
  manifest antes de llegar a la página; un chunk modificado se convierte en
  un 504 + evento de auditoría, no en código en ejecución.
- Coste acotado y asumido: SHA-256 por respuesta servida (sin memo, porque
  una entrada de cache puede reescribirse tras un primer hit verificado); el
  mayor asset custodiado es el chunk WebLLM (~6.5 MB ≈ 10 ms una vez por
  carga). Requests no-GET, cross-origin, no-listados y no-ok pasan intactos.
- `sw.js` e `index.html` quedan fuera del hash por auto-referencia; su
  protección es el transporte del servidor + SRI para el HTML, y el
  byte-diff del navegador en los update checks del SW.
- La notificación entra por el mismo contrato `bundle-integrity-failed`, de
  modo que la alerta de spike de monitoreo (`bundle-integrity-spike`, 3
  fallos/5 min) y el registro en AuditLog aplican sin duplicar canales.
