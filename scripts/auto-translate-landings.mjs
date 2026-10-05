/**
 * Script para traducir automáticamente las landing pages
 * Usa Google Translate API para traducir los 24 idiomas secundarios
 * 
 * Uso:
 *   node scripts/auto-translate-landings.mjs
 * 
 * ⚠️ IMPORTANTE:
 * - La API gratuita tiene límites de rate limiting
 * - Las traducciones automáticas requieren revisión manual
 * - No traduce términos técnicos perfectamente
 * - Ejecuta en pequeños lotes para evitar límites de la API
 */

import translate from '@vitalets/google-translate-api';
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

// Lista de idiomas a traducir (excluyendo los 6 completos)
// Para pruebas, solo traducir 2 idiomas primero
const LANGUAGES_TO_TRANSLATE = [
  'ja', 'ko'  // Prueba con 2 idiomas asiáticos
];

// Para traducir todos, descomentar esta línea:
// const LANGUAGES_TO_TRANSLATE = ['ar', 'bg', 'cs', 'da', 'el', 'fi', 'he', 'hi', 'hr', 'hu', 'id', 'ja', 'ko', 'nl', 'no', 'pl', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'];

// Campos que NO traducir (códigos, URLs, etc.)
const DO_NOT_TRANSLATE = [
  'lang', 'langName', 'dir', 'canonical', 'ogLocale', 'ogLocaleAlternate',
  'ogImage', 'twitterImage', 'href', 'hreflang', 'code', 'type', 'currency',
  'availability', 'priceValidUntil', 'ogLocaleAlternate'
];

// Función para traducir texto
async function translateText(text, targetLang) {
  try {
    // Saltar si está vacío o es código
    if (!text || typeof text !== 'string' || text.startsWith('http') || text.startsWith('/')) {
      return text;
    }
    
    // Saltar si contiene HTML complejo o variables
    if (text.includes('{{') || text.includes('<') && text.includes('>')) {
      return text;
    }
    
    const result = await translate(text, { to: targetLang });
    return result.text;
  } catch (error) {
    console.warn(`Translation failed for "${text.substring(0, 50)}...": ${error.message}`);
    return text; // Fallback al original
  }
}

// Función para traducir un objeto recursivamente
async function translateObject(obj, targetLang, path = '') {
  if (Array.isArray(obj)) {
    const translated = [];
    for (let i = 0; i < obj.length; i++) {
      translated[i] = await translateObject(obj[i], targetLang, `${path}[${i}]`);
    }
    return translated;
  } else if (typeof obj === 'object' && obj !== null) {
    const translated = {};
    for (const key of Object.keys(obj)) {
      const keyPath = `${path}.${key}`;
      
      // No traducir ciertos campos
      if (DO_NOT_TRANSLATE.includes(key)) {
        translated[key] = obj[key];
      } else {
        translated[key] = await translateObject(obj[key], targetLang, keyPath);
      }
    }
    return translated;
  } else if (typeof obj === 'string') {
    return await translateText(obj, targetLang);
  } else {
    return obj;
  }
}

// Traducir un idioma
async function translateLanguage(lang) {
  console.log(`\n🌐 Translating ${lang}...`);
  
  const region = LOCALE_REGIONS[lang];
  
  // Crear traducción basada en en.json
  const translation = JSON.parse(JSON.stringify(enTemplate));
  
  // Actualizar campos básicos (no traducir)
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
  
  // Traducir el contenido
  const translated = await translateObject(translation, lang);
  
  // Actualizar paths /app a /
  if (translated.pricing.plans[0].ctaHref === '/app') {
    translated.pricing.plans[0].ctaHref = '/';
  }
  
  // Escribir archivo
  const outputPath = path.join(__dirname, 'translations', `${lang}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(translated, null, 2), 'utf-8');
  console.log(`✓ Translated ${lang}.json`);
  
  // Pausa para evitar rate limiting
  await new Promise(resolve => setTimeout(resolve, 1000));
}

// Traducir todos los idiomas en lotes pequeños
async function translateAll() {
  console.log('🌍 Starting automatic translation of 24 languages...');
  console.log('⚠️  This may take several minutes due to API rate limits');
  console.log('⚠️  Automatic translations require manual review for quality');
  
  for (const lang of LANGUAGES_TO_TRANSLATE) {
    await translateLanguage(lang);
  }
  
  console.log('\n✅ All translations completed!');
  console.log('⚠️  IMPORTANT: Review each translation manually for quality');
  console.log('⚠️  Run: npm run build:landings to regenerate landing pages');
}

// Ejecutar
translateAll().catch(error => {
  console.error('❌ Translation failed:', error);
  process.exit(1);
});
