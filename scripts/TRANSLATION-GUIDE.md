# Guía de Traducción para Landing Pages

## 📋 Estado Actual

### Idiomas Completos (6):
- ✅ **en** (Inglés) - Completo
- ✅ **es** (Español) - Completo
- ✅ **fr** (Francés) - Completo
- ✅ **de** (Alemán) - Completo
- ✅ **pt** (Portugués) - Completo
- ✅ **it** (Italiano) - Completo

### Idiomas Parciales (24):
Los siguientes idiomas tienen contenido en inglés. Necesitan traducción manual:

- ar (Árabe)
- bg (Búlgaro)
- cs (Checo)
- da (Danés)
- el (Griego)
- fi (Finlandés)
- he (Hebreo)
- hi (Hindi)
- hr (Croata)
- hu (Húngaro)
- id (Indonesio)
- ja (Japonés)
- ko (Coreano)
- nl (Neerlandés)
- no (Noruego)
- pl (Polaco)
- ro (Rumano)
- ru (Ruso)
- sv (Sueco)
- th (Tailandés)
- tr (Turco)
- uk (Ucraniano)
- vi (Vietnamita)
- zh (Chino)

## 🔄 Cómo Traducir

### Paso 1: Archivo de Traducción

Cada idioma tiene su archivo en `scripts/translations/{lang}.json`:
- Ejemplo: `scripts/translations/ar.json` para árabe
- Ejemplo: `scripts/translations/es.json` para español

### Paso 2: Campos a Traducir

Los campos principales son:

```json
{
  "lang": "código del idioma",
  "langName": "Nombre del idioma en su propio idioma",
  "title": "Título de la página",
  "description": "Descripción para SEO",
  "hero": {
    "badge": "Badge del hero",
    "title": "Título principal",
    "subtitle": "Subtítulo",
    "ctaPrimary": "Texto del botón principal",
    "ctaSecondary": "Texto del botón secundario",
    "pillars": [
      { "strong": "Negrita", "text": "Texto del pillar" }
    ]
  },
  "pocketAlternative": { ... },
  "raindropCompare": { ... },
  "features": { ... },
  "ai": { ... },
  "privacy": { ... },
  "pricing": { ... },
  "faq": { ... },
  "cta": { ... },
  "footer": { ... }
}
```

### Paso 3: Traducir

1. Abre el archivo del idioma: `scripts/translations/{lang}.json`
2. Traduce cada campo manteniendo la estructura JSON
3. NO cambies claves ni estructura
4. Mantene placeholders como `{{...}}` si aparecen
5. Para RTL (árabe, hebreo): asegúrate de que `dir` sea `"rtl"`

### Paso 4: Regenerar Landing Pages

```bash
npm run build:landings
```

Esto regenerará todas las 31 landing pages con las nuevas traducciones.

### Paso 5: Verificar

```bash
npm run check:landings-fresh
npm run check:i18n
```

## 📁 Traducciones Parciales Existentes

Hay traducciones parciales en `scripts/landing-translations.json` para los 24 idiomas. Puedes usar estas como base:

- El archivo tiene campos como `heroTitle`, `heroSub`, `pocketTitle`, etc.
- Estos campos están traducidos al idioma correspondiente
- Pero NO cubren todos los campos necesarios para las landing pages completas

### Script de Mezcla

He creado `scripts/merge-landing-translations.mjs` que:
- Lee `landing-translations.json` (traducciones parciales)
- Mezcla con la estructura completa de `en.json`
- Genera archivos con traducciones parciales aplicadas
- Los campos faltantes quedan en inglés

**⚠️ El script generó errores en algunos idiomas por campos faltantes.**

## 🎯 Recomendación

### Opción 1: Traducción Manual (Recomendada)
1. Usar `landing-translations.json` como referencia
2. Completar manualmente los campos faltantes en cada idioma
3. Requiere hablantes nativos o traductores profesionales

### Opción 2: Servicios de Traducción
- Usar servicios como DeepL, Google Translate, etc.
- Requiere revisión manual por hablantes nativos
- Los servicios de IA pueden tener errores en contextos técnicos

### Opción 3: Reducir a 6 Idiomas
- Mantener solo los 6 idiomas completos
- Eliminar los 24 idiomas parciales
- Simplifica mantenimiento

## 🔧 Scripts Disponibles

### `scripts/generate-basic-translations.mjs`
Genera archivos de traducción básicos con contenido en inglés (estado actual).

### `scripts/merge-landing-translations.mjs`
Intenta mezclar traducciones parciales con la estructura completa (experimental).

### `scripts/generate-language-links.cjs`
Genera los enlaces del selector de idioma.

## 📊 Resumen

- **Total idiomas**: 30
- **Completos**: 6 (en, es, fr, de, pt, it)
- **Parciales**: 24 (necesitan traducción manual)
- **Landing pages**: 31 (incluye pocket-alternative)

## 💡 Próximos Pasos

1. Decidir qué idiomas priorizar (idiomas con más usuarios)
2. Traducir esos idiomas primero
3. Probar las landing pages en cada idioma
4. Verificar contraste y legibilidad
4. Hacer commit de las traducciones completadas
