import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRANSLATIONS_DIR = path.join(__dirname, 'translations');
const ENGLISH_FILE = path.join(TRANSLATIONS_DIR, 'en.json');

// Language configurations for the missing 21 languages
const LANGUAGES = [
  { code: 'cs', name: 'Čeština', dir: 'ltr', locale: 'cs_CZ' },
  { code: 'da', name: 'Dansk', dir: 'ltr', locale: 'da_DK' },
  { code: 'el', name: 'Ελληνικά', dir: 'ltr', locale: 'el_GR' },
  { code: 'fi', name: 'Suomi', dir: 'ltr', locale: 'fi_FI' },
  { code: 'he', name: 'עברית', dir: 'rtl', locale: 'he_IL' },
  { code: 'hi', name: 'हिन्दी', dir: 'ltr', locale: 'hi_IN' },
  { code: 'hr', name: 'Hrvatski', dir: 'ltr', locale: 'hr_HR' },
  { code: 'hu', name: 'Magyar', dir: 'ltr', locale: 'hu_HU' },
  { code: 'id', name: 'Bahasa Indonesia', dir: 'ltr', locale: 'id_ID' },
  { code: 'ja', name: '日本語', dir: 'ltr', locale: 'ja_JP' },
  { code: 'ko', name: '한국어', dir: 'ltr', locale: 'ko_KR' },
  { code: 'nl', name: 'Nederlands', dir: 'ltr', locale: 'nl_NL' },
  { code: 'no', name: 'Norsk', dir: 'ltr', locale: 'no_NO' },
  { code: 'pl', name: 'Polski', dir: 'ltr', locale: 'pl_PL' },
  { code: 'ro', name: 'Română', dir: 'ltr', locale: 'ro_RO' },
  { code: 'ru', name: 'Русский', dir: 'ltr', locale: 'ru_RU' },
  { code: 'sv', name: 'Svenska', dir: 'ltr', locale: 'sv_SE' },
  { code: 'th', name: 'ไทย', dir: 'ltr', locale: 'th_TH' },
  { code: 'tr', name: 'Türkçe', dir: 'ltr', locale: 'tr_TR' },
  { code: 'uk', name: 'Українська', dir: 'ltr', locale: 'uk_UA' },
  { code: 'vi', name: 'Tiếng Việt', dir: 'ltr', locale: 'vi_VN' },
  { code: 'zh', name: '中文', dir: 'ltr', locale: 'zh_CN' }
];

function generateTranslation(englishData, langConfig) {
  const translation = JSON.parse(JSON.stringify(englishData)); // Deep copy
  
  // Update language-specific fields
  translation.lang = langConfig.code;
  translation.langName = langConfig.name;
  translation.dir = langConfig.dir;
  translation.canonical = `https://bookmarkforgeapp.com/${langConfig.code}/`;
  translation.ogLocale = langConfig.locale;
  translation.ogLocaleAlternate = 'en_US';
  translation.homeHref = `/${langConfig.code}/`;
  
  // Note: The content (title, description, etc.) remains in English
  // and should be professionally translated later
  
  return translation;
}

function main() {
  console.log('Generating missing translation files...\n');
  
  // Read the English template
  const englishContent = fs.readFileSync(ENGLISH_FILE, 'utf-8');
  const englishData = JSON.parse(englishContent);
  
  let generatedCount = 0;
  
  for (const langConfig of LANGUAGES) {
    const outputPath = path.join(TRANSLATIONS_DIR, `${langConfig.code}.json`);
    
    // Skip if file already exists
    if (fs.existsSync(outputPath)) {
      console.log(`⏭️  Skipping ${langConfig.code}.json (already exists)`);
      continue;
    }
    
    // Generate translation
    const translation = generateTranslation(englishData, langConfig);
    
    // Write file
    fs.writeFileSync(outputPath, JSON.stringify(translation, null, 2), 'utf-8');
    console.log(`✓ Generated ${langConfig.code}.json (${langConfig.name})`);
    generatedCount++;
  }
  
  console.log(`\n✓ Generated ${generatedCount} translation files`);
  console.log('⚠️  Note: Content is in English and needs professional translation');
}

main();