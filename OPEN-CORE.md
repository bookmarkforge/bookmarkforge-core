# Modelo Open Core de BookmarkForge

BookmarkForge usa un modelo **Open Core**: el núcleo que permite guardar,
organizar, importar, buscar y proteger un vault se publica bajo la licencia
MIT; determinadas funciones comerciales y servicios avanzados permanecen
propietarios y se distribuyen mediante una licencia Pro.

## Qué significa en la práctica

- Puedes estudiar, ejecutar, modificar y redistribuir el Core MIT respetando
  `LICENSE`.
- El repositorio privado de desarrollo contiene también código Pro. La licencia
  MIT **no cubre automáticamente todo lo que aparece en este checkout**.
- `scripts/export-public-repo.mjs` produce el repositorio público y elimina los
  componentes Pro, contratos privados, operaciones internas y secretos.
- La exportación pública incluye un `manifest.json` auditable y falla si un
  archivo Pro aparece en el resultado.
- El nombre, el logotipo y los dominios de BookmarkForge siguen sujetos a la
  política de marca de `TRADEMARKS.md`; la licencia MIT no concede derechos de
  marca.

## Frontera de compilación

Excluir archivos Pro no basta: el Core los **importa**. Sin nada en su lugar, la
exportación materializaba pero no compilaba (327 errores de módulo no
encontrado). `scripts/pro-boundary.mjs` cierra esa frontera en el momento de la
exportación, sin tocar ni una línea del código de producto:

- por cada módulo propietario referenciado, el árbol público publica en la ruta
  original un par formado por
  - `<ruta>.d.ts`, la superficie de tipos generada desde el código real (solo
    declaraciones, sin comentarios ni implementación), que es lo que mantiene
    limpio el `tsc` del Core exportado;
  - `<ruta>.js`, un módulo inerte que expone los mismos nombres. Sus valores se
    pueden llamar, construir y encadenar sin lanzar nunca una excepción (una
    compilación Open Core no debe romper su arranque por una llamada Pro) y
    avisa una vez por propiedad, de modo que una superficie Pro alcanzada se
    identifica en lugar de fingir que funciona;
- los especificadores que escriben la extensión `.ts` (URLs de worker de Vite,
  imports por URL de desarrollo en las pruebas de extremo a extremo) pierden la
  extensión para que resuelvan al par generado;
- las entradas de configuración que solo **nombran** un archivo Pro (exclusiones
  de cobertura, listas de dependencias) se eliminan, porque en la exportación no
  existe nada a lo que apunten.

Las pruebas que leen desde el disco la implementación propietaria y verifican su
texto son pruebas de comportamiento Pro, así que no se copian: viven en el
repositorio privado.

`check:open-core` verifica esa frontera. En el repositorio privado solo registra
la política (ahí las implementaciones Pro deben estar); en un árbol exportado
comprueba el conjunto completo: ninguna implementación Pro presente, cada
referencia cubierta por un par marcado y sin extensión explícita, y metadatos
MIT coherentes. Como el repositorio público **es** una exportación, su CI vuelve
a auditar su propia frontera en cada ejecución.

## Carga Pro en tiempo de ejecución

La frontera de compilación evita que la exportación se rompa; el gate de
entitlement decide qué se ejecuta. Los componentes del Core ya no importan
estáticamente los módulos Pro no-IA (backups, extracción de PDF,
sincronización P2P): los resuelven a través de `src/services/pro-access.ts`
(MIT), que consulta `licenseService.hasProAccess()` antes de pedir el primer
byte del chunk Pro:

- un usuario Free no descarga el código Pro — la petición misma está detrás del
  gate — y la llamada rechaza con `ProUnavailableError`, un error tipado que la
  interfaz presenta como estado «requiere Pro» o aviso de mejora, nunca como un
  botón muerto silencioso;
- un usuario Pro con licencia válida carga la implementación real bajo demanda,
  en su propio chunk;
- el árbol de IA sigue la misma regla con matiz de producto: la decisión de
  licencia (lista exacta en `scripts/pro-boundary.mjs`) declara Pro solo las
  superficies propietarias reales — el runtime local (WebLLMService), la
  orquestación RAG (GlobalRAGService), el registro de agentes expertos y la
  generación de flashcards — mientras que el resto del árbol (la nube BYOK vía
  ProviderManager, el motor de embeddings RAGEngine que alimenta la búsqueda
  semántica del plan Free, TTS) es Core MIT y sigue importable directamente.
  Los consumidores Core de los cuatro módulos Pro IA los resuelven a través
  del cargador; la degradación es honesta: la sonda de capacidad resuelve
  false, los diagnósticos informan «no inicializado» y el panel de agentes
  muestra el aviso de mejora.
- cuando una superficie placeholder se toca de verdad, el helper emite el
  evento `open-core:pro-reached` y el cargador rechaza con `ProUnavailableError`
  en lugar de entregar el módulo inerte; `ProRequiredBoundary` (montado en
  MainApp) convierte cualquiera de las dos señales en el panel «Disponible en
  Pro», de modo que una build Core explica la ausencia en lugar de fingir.
- `check:pro-imports` impide que esta situación se erosione: falla si cualquier
  archivo del Core — árbol IA incluido — vuelve a enlazar estáticamente un
  módulo Pro fuera del seam. No hay zona tolerada: toda referencia o va por el
  cargador o es parte del propio lado Pro.

## Core MIT

Incluye el vault local, CRUD de marcadores, notas, búsqueda básica, importación
y exportación básica, seguridad del vault, interfaz, PWA/extensiones,
i18n y las vistas de organización que no estén identificadas como Pro.

## Pro propietario

Incluye, entre otros, IA local y proxy de IA, RAG y agentes especializados,
sincronización P2P, flashcards, PDF/OCR, exportaciones avanzadas, backups
avanzados y los servicios comerciales asociados. La lista exacta y sus rutas se
mantiene en `scripts/pro-boundary.mjs` y la consumen por igual el exportador, el
generador de la frontera de compilación y el gate `check:open-core`; si existe
una discrepancia, la exclusión automatizada prevalece hasta que el mantenedor la
revise.

## Contribuciones

Las contribuciones al Core se aceptan bajo MIT. No envíes código Pro ni copies
código de terceros con una licencia incompatible. Antes de abrir un cambio que
cruce el límite Core/Pro, documenta la decisión y actualiza el gate de
exportación.

## Marca

Un fork del Core debe usar otro nombre, logotipo y dominio, y no debe sugerir
que es una versión oficial de BookmarkForge. Consulta `TRADEMARKS.md` en la
exportación pública.

## Estado legal

Este documento explica la intención de distribución técnica; no es asesoría
jurídica. Antes de publicar una versión comercial, el mantenedor debe revisar
la titularidad de copyright, las licencias de dependencias y la clasificación
archivo por archivo.
