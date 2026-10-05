/**
 * Script para mezclar traducciones parciales de landing-translations.json
 * con la estructura completa de en.json para crear archivos de traducción completos
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Leer landing-translations.json (traducciones parciales)
const landingTranslations = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'landing-translations.json'), 'utf-8')
);

// Leer en.json como plantilla completa
const enTemplate = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'translations', 'en.json'), 'utf-8')
);

// Mapeo de regiones por idioma
const LOCALE_REGIONS = {
  ar: 'AR', es: 'ES', pt: 'PT', ja: 'JP', ko: 'KR', el: 'GR',
  he: 'IL', hi: 'IN', hu: 'HU', id: 'ID', da: 'DK', no: 'NO', uk: 'UA',
  vi: 'VN', zh: 'CN', bg: 'BG', cs: 'CZ', de: 'DE', fi: 'FI',
  fr: 'FR', hr: 'HR', it: 'IT', nl: 'NL', pl: 'PL', ro: 'RO', ru: 'RU',
  sv: 'SE', th: 'TH', tr: 'TR',
};

// Nombres de idiomas en el idioma mismo
const LANG_NAMES = {
  ar: 'العربية', bg: 'Български', cs: 'Čeština', da: 'Dansk', el: 'Ελληνικά',
  fi: 'Suomi', he: 'עברית', hi: 'हिन्दी', hr: 'Hrvatski', hu: 'Magyar',
  id: 'Bahasa Indonesia', ja: '日本語', ko: '한국어', nl: 'Nederlands',
  no: 'Norsk', pl: 'Polski', ro: 'Română', ru: 'Русский', sv: 'Svenska',
  th: 'ไทย', tr: 'Türkçe', uk: 'Українська', vi: 'Tiếng Việt', zh: '中文',
};

// Mapeo de campos de landing-translations.json a la estructura completa
const FIELD_MAPPING = {
  metaDesc: 'description',
  title: 'title',
  heroBadge: 'hero.badge',
  heroTitle: 'hero.title',
  heroSub: 'hero.subtitle',
  heroCtaPrimary: 'hero.ctaPrimary',
  heroCtaSecondary: 'hero.ctaSecondary',
  heroPillars: 'hero.pillars',
  pocketTag: 'pocketAlternative.tag',
  pocketTitle: 'pocketAlternative.title',
  pocketDesc: 'pocketAlternative.subtitle',
  pocketFeat1Title: 'pocketAlternative.features.0.title',
  pocketFeat1Desc: 'pocketAlternative.features.0.text',
  pocketFeat2Title: 'pocketAlternative.features.1.title',
  pocketFeat2Desc: 'pocketAlternative.features.1.text',
  pocketFeat3Title: 'pocketAlternative.features.2.title',
  pocketFeat3Desc: 'pocketAlternative.features.2.text',
  pocketCta: 'pocketAlternative.ctaPrimary',
  pocketLink: 'pocketAlternative.ctaSecondary',
  featTag: 'features.tag',
  featTitle: 'features.title',
  featItems: 'features.items',
  aiTag: 'ai.tag',
  aiTitle: 'ai.title',
  aiSub: 'ai.subtitle',
  aiProvidersTitle: 'ai.providers.title',
  aiModesTitle: 'ai.modes.title',
  aiMode1Title: 'ai.modes.items.0.title',
  aiMode1Desc: 'ai.modes.items.0.text',
  aiMode2Title: 'ai.modes.items.1.title',
  aiMode2Desc: 'ai.modes.items.1.text',
  aiMode3Title: 'ai.modes.items.2.title',
  aiMode3Desc: 'ai.modes.items.2.text',
};

// Función para setear valor en un objeto usando notación de puntos
function setByPath(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key]) current[key] = {};
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

// Función para convertir pillars de strings HTML a objetos
function convertPillars(pillars) {
  if (!Array.isArray(pillars)) return [];
  return pillars.map(pillar => {
    if (typeof pillar === 'string') {
      const match = pillar.match(/<strong>(.*?)<\/strong>\s*—\s*(.*)/);
      if (match) {
        return { strong: match[1], text: match[2] };
      }
      let text = pillar;
      for (;;) {
        const open = text.indexOf('<');
        if (open === -1) break;
        const close = text.indexOf('>', open + 1);
        if (close === -1) { text = text.slice(0, open); break; }
        text = text.slice(0, open) + text.slice(close + 1);
      }
      return { strong: '', text };
    }
    return pillar;
  });
}

// Procesar cada idioma en landing-translations.json
Object.keys(landingTranslations).forEach(lang => {
  const landingData = landingTranslations[lang];
  const region = LOCALE_REGIONS[lang];
  
  // Crear traducción basada en en.json
  const translation = JSON.parse(JSON.stringify(enTemplate));
  
  // Actualizar campos básicos
  translation.lang = lang;
  translation.langName = LANG_NAMES[lang] || lang.toUpperCase();
  translation.dir = ['ar', 'he'].includes(lang) ? 'rtl' : 'ltr';
  translation.canonical = `https://bookmarkforgeapp.com/${lang}/`;
  translation.ogLocale = `${lang}_${region}`;
  translation.ogLocaleAlternate = 'en_US';
  translation.homeHref = `/${lang}/`;
  translation.langLink = {
    href: '/?lang=en',
    hreflang: 'en',
    lang: 'en',
    text: 'English'
  };
  
  // Mezclar traducciones de landing-translations.json
  Object.keys(FIELD_MAPPING).forEach(landingField => {
    const targetPath = FIELD_MAPPING[landingField];
    const value = landingData[landingField];
    
    if (value !== undefined) {
      if (landingField === 'heroPillars' && Array.isArray(value)) {
        translation.hero.pillars = convertPillars(value);
      } else if (landingField === 'featItems' && Array.isArray(value)) {
        translation.features.items = value;
      } else {
        setByPath(translation, targetPath, value);
      }
    }
  });
  
  // Actualizar paths /app a /
  if (translation.pricing.plans[0].ctaHref === '/app') {
    translation.pricing.plans[0].ctaHref = '/';
  }
  
  // Escribir archivo
  const outputPath = path.join(__dirname, 'translations', `${lang}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(translation, null, 2), 'utf-8');
  console.log(`✓ Generated ${lang}.json with partial translations`);
});

console.log('\nAll 24 secondary locale translation files generated with partial translations.');
console.log('Note: Fields not in landing-translations.json remain in English.');
console.log('For production-quality translations, complete the missing fields.');
