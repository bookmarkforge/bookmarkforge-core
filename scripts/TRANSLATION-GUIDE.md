# Guía de Traducción para Landing Pages

## Flujo actual

BookmarkForge mantiene 30 locales de landing, con las traducciones versionadas en `scripts/translations/{lang}.json`.

El flujo de generación actual es:

1. Editar el JSON del locale manteniendo claves, estructura y placeholders.
2. Usar `scripts/generate-complete-translations.mjs` para generar/completar las traducciones secundarias cuando corresponda.
3. Ejecutar `npm run build:landings`.
4. Verificar con `npm run check:landings-fresh` y los gates de i18n.

La arquitectura actual utiliza:

- `scripts/landing-registry.mjs`: registro central de locales.
- `scripts/generate-complete-translations.mjs`: generador actual.
- `scripts/generate-language-links.cjs`: selector de idiomas.
- `scripts/build-landings.cjs`: builder de landings.

Los generadores parciales y scripts one-shot históricos ya no forman parte del flujo y no deben utilizarse para regenerar las páginas.

Para idiomas RTL, conserva la configuración de dirección del sistema de traducciones y plantillas.

No crees un segundo generador para cambios puntuales: modifica la fuente de traducción y vuelve a ejecutar el pipeline actual.
