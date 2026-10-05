/**
 * Script para generar archivos de traducción básicos para los 24 idiomas secundarios
 * Usa en.json como base con cambios mínimos (lang, langName, dir, canonical, etc.)
 * Estos archivos permitirán que las landing pages se rendericen sin errores
 * El contenido estará en inglés como punto de partida para traducción
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Leer en.json como plantilla
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

const SECONDARY_LOCALES = [
  'ar', 'bg', 'cs', 'da', 'el', 'fi', 'he', 'hi', 'hr', 'hu', 'id',
  'ja', 'ko', 'nl', 'no', 'pl', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'
];

SECONDARY_LOCALES.forEach(lang => {
  const region = LOCALE_REGIONS[lang];
  
  // Crear traducción basada en en.json con cambios mínimos
  const translation = {
    ...enTemplate,
    lang,
    langName: LANG_NAMES[lang] || lang.toUpperCase(),
    dir: ['ar', 'he'].includes(lang) ? 'rtl' : 'ltr',
    canonical: `https://bookmarkforgeapp.com/${lang}/`,
    ogLocale: `${lang}_${region}`,
    ogLocaleAlternate: 'en_US',
    homeHref: `/${lang}/`,
    langLink: {
      href: '/?lang=en',
      hreflang: 'en',
      lang: 'en',
      text: 'English'
    },
  };

  // Actualizar paths /app a /
  if (translation.pricing.plans[0].ctaHref === '/app') {
    translation.pricing.plans[0].ctaHref = '/';
  }

  // Escribir archivo
  const outputPath = path.join(__dirname, 'translations', `${lang}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(translation, null, 2), 'utf-8');
  console.log(`✓ Generated ${lang}.json (English content, ready for translation)`);
});

console.log('\nAll 24 secondary locale translation files generated.');
console.log('Note: Content is in English - requires human translation for production.');
