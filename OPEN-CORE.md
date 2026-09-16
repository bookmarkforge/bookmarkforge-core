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

## Core MIT

Incluye el vault local, CRUD de marcadores, notas, búsqueda básica, importación
y exportación básica, seguridad del vault, interfaz, PWA/extensiones,
i18n y las vistas de organización que no estén identificadas como Pro.

## Pro propietario

Incluye, entre otros, IA local y proxy de IA, RAG y agentes especializados,
sincronización P2P, flashcards, PDF/OCR, exportaciones avanzadas, backups
avanzados y los servicios comerciales asociados. La lista exacta y sus rutas
se mantiene en `scripts/export-public-repo.mjs`; si existe una discrepancia,
la exclusión automatizada prevalece hasta que el mantenedor la revise.

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
