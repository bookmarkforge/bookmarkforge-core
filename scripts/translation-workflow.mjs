/**
 * Script de flujo de trabajo para traducción manual de landing pages
 * 
 * Este script ayuda a organizar el trabajo de traducción de las 24 landing pages
 * proporcionando herramientas para:
 * 1. Exportar contenido en formato fácil de traducir (CSV)
 * 2. Importar traducciones desde CSV
 * 3. Generar un reporte de progreso
 * 4. Validar traducciones
 * 
 * Uso:
 *   node scripts/translation-workflow.mjs export {lang}   # Exporta a CSV para traducir
 *   node scripts/translation-workflow.mjs import {lang}   # Importa traducciones desde CSV
 *   node scripts/translation-workflow.mjs report            # Reporte de progreso
 *   node scripts/translation-workflow.mjs validate {lang} # Valida traducción
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

// Idiomas a traducir (24 idiomas parciales)
const LANGUAGES_TO_TRANSLATE = [
  'ar', 'bg', 'cs', 'da', 'el', 'fi', 'he', 'hi', 'hr', 'hu', 'id',
  'ja', 'ko', 'nl', 'no', 'pl', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'
];

// Función para extraer valor de un objeto usando notación de puntos
function getByPath(obj, path) {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return null;
    }
  }
  return current;
}

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

// Extraer campos traducibles a formato plano
function extractTranslatableFields(obj, prefix = '') {
  const fields = [];
  
  function traverse(current, path) {
    if (typeof current === 'string' && current.trim()) {
      // Solo extraer campos de texto relevantes
      if (current.length > 0 && current.length < 500 && !current.startsWith('http') && !current.startsWith('/')) {
        fields.push({ path, value: current });
      }
    } else if (Array.isArray(current)) {
      current.forEach((item, index) => {
        traverse(item, `${path}[${index}]`);
      });
    } else if (typeof current === 'object' && current !== null) {
      Object.keys(current).forEach(key => {
        traverse(current[key], `${path}.${key}`);
      });
    }
  }
  
  traverse(obj, prefix);
  return fields;
}

// Exportar a traducción a CSV
function exportToCSV(lang) {
  console.log(`📤 Exporting ${lang} to CSV...`);
  
  const outputPath = path.join(__dirname, 'translations', `${lang}.json`);
  
  if (!fs.existsSync(outputPath)) {
    console.log(`⚠️  ${lang}.json does not exist, creating from template...`);
    fs.writeFileSync(outputPath, JSON.stringify(enTemplate, null, 2), 'utf-8');
  }
  
  const translation = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
  const fields = extractTranslatableFields(translation, lang);
  
  // Crear CSV
  const csvLines = ['Path,English,Translation,Notes'];
  const langFields = extractTranslatableFields(enTemplate, lang);
  
  langFields.forEach(field => {
    const translatedValue = getByPath(translation, field.path);
    csvLines.push(`"${field.path}","${field.value.replace(/"/g, '""')}","${translatedValue ? translatedValue.replace(/"/g, '""') : ''}",""`);
  });
  
  const csvContent = csvLines.join('\n');
  const csvPath = path.join(__dirname, 'translations', `${lang}-translation.csv`);
  fs.writeFileSync(csvPath, csvContent, 'utf-8');
  
  console.log(`✓ Exported to ${lang}-translation.csv (${fields.length} fields)`);
  console.log(`  Path: ${csvPath}`);
}

// Importar traducciones desde CSV
function importFromCSV(lang) {
  console.log(`📥 Importing ${lang} from CSV...`);
  
  const csvPath = path.join(__dirname, 'translations', `${lang}-translation.csv`);
  
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found: ${csvPath}`);
    return;
  }
  
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').slice(1); // Skip header
  
  const outputPath = path.join(__dirname, 'translations', `${lang}.json`);
  const translation = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
  
  let imported = 0;
  lines.forEach(line => {
    if (!line.trim()) return;
    
    // Parse CSV (simple)
    const matches = line.match(/"([^"]*)"|"([^"]*)"|"([^"]*)"|"([^"]*)"/g);
    if (matches && matches.length >= 3) {
      const path = matches[0];
      const translationValue = matches[2].replace(/""/g, '"');
      
      if (translationValue && translationValue.trim()) {
        setByPath(translation, path, translationValue);
        imported++;
      }
    }
  });
  
  fs.writeFileSync(outputPath, JSON.stringify(translation, null, 2), 'utf-8');
  console.log(`✓ Imported ${imported} translations to ${lang}.json`);
}

// Generar reporte de progreso
function generateReport() {
  console.log('📊 Generating translation progress report...\n');
  
  const report = [];
  
  LANGUAGES_TO_TRANSLATE.forEach(lang => {
    const outputPath = path.join(__dirname, 'translations', `${lang}.json`);
    
    if (!fs.existsSync(outputPath)) {
      report.push({ lang, status: 'missing', translated: 0, total: 0 });
      return;
    }
    
    const translation = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    const enFields = extractTranslatableFields(enTemplate, lang);
    const translatedFields = extractTranslatableFields(translation, lang);
    
    // Contar cuántos están traducidos (diferentes del inglés)
    let translated = 0;
    translatedFields.forEach(field => {
      const enField = enFields.find(f => f.path === field.path);
      if (enField && field.value !== enField.value) {
        translated++;
      }
    });
    
    const percent = Math.round((translated / enFields.length) * 100);
    report.push({ lang, status: 'partial', translated, total: enFields.length, percent });
  });
  
  console.log('Language Status Translated Progress');
  console.log('─────────────────────────────────────────────────────────');
  report.forEach(r => {
    const bar = '█'.repeat(Math.floor(r.percent / 10)) + '░'.repeat(10 - Math.floor(r.percent / 10));
    console.log(`${r.lang.padEnd(4)} ${r.status.padEnd(8)} ${r.translated}/${r.total} ${bar} ${r.percent}%`);
  });
  
  const totalTranslated = report.reduce((sum, r) => sum + r.translated, 0);
  const totalFields = report.reduce((sum, r) => sum + r.total, 0);
  const overallPercent = Math.round((totalTranslated / totalFields) * 100);
  
  console.log('─────────────────────────────────────────────────────────');
  console.log(`Total: ${totalTranslated}/${totalFields} (${overallPercent}%)`);
  
  // Guardar reporte
  const reportPath = path.join(__dirname, 'translations', 'translation-progress.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n✓ Report saved to translation-progress.json`);
}

// Validar traducción
function validateTranslation(lang) {
  console.log(`🔍 Validating ${lang} translation...\n`);
  
  const outputPath = path.join(__dirname, 'translations', `${lang}.json`);
  
  if (!fs.existsSync(outputPath)) {
    console.error(`❌ ${lang}.json does not exist`);
    return;
  }
  
  const translation = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
  const enFields = extractTranslatableFields(enTemplate, lang);
  const translatedFields = extractTranslatableFields(translation, lang);
  
  let missing = 0;
  let unchanged = 0;
  let translated = 0;
  
  console.log('Field Status');
  console.log('─────────────────────────────────────────────────────────');
  
  enFields.forEach(field => {
    const translatedField = translatedFields.find(f => f.path === field.path);
    
    if (!translatedField) {
      console.log(`❌ MISSING: ${field.path}`);
      missing++;
    } else if (translatedField.value === field.value) {
      console.log(`⚠️  UNCHANGED: ${field.path}`);
      unchanged++;
    } else {
      console.log(`✓ TRANSLATED: ${field.path}`);
      translated++;
    }
  });
  
  console.log('─────────────────────────────────────────────────────────');
  console.log(`Missing: ${missing}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Translated: ${translated}`);
  console.log(`Total: ${enFields.length}`);
  
  if (missing > 0) {
    console.log(`\n❌ Validation failed: ${missing} missing fields`);
  } else if (unchanged > 0) {
    console.log(`\n⚠️  Warning: ${unchanged} fields unchanged from English`);
  } else {
    console.log(`\n✅ Validation passed: All fields translated`);
  }
}

// Generar template para un idioma
function generateTemplate(lang) {
  console.log(`📝 Generating translation template for ${lang}...\n`);
  
  const outputPath = path.join(__dirname, 'translations', `${lang}.json`);
  
  if (!fs.existsSync(outputPath)) {
    console.log(`⚠️  ${lang}.json does not exist, creating from template...`);
    fs.writeFileSync(outputPath, JSON.stringify(enTemplate, null, 2), 'utf-8');
  }
  
  const fields = extractTranslatableFields(enTemplate, lang);
  
  // Crear template simple
  const templatePath = path.join(__dirname, 'translations', `${lang}-template.txt`);
  const templateLines = [
    `Translation Template for ${lang.toUpperCase()}`,
    `===================================================`,
    ``,
    `Instructions:`,
    `- Translate each field below`,
    `- Keep the JSON structure intact`,
    `- Do not change field names or structure`,
    `- For RTL languages (ar, he): ensure dir is "rtl"`,
    ``,
    `Fields to translate (${fields.length}):`,
    ``,
  ];
  
  fields.forEach((field, index) => {
    templateLines.push(`${index + 1}. ${field.path}`);
    templateLines.push(`   English: ${field.value}`);
    templateLines.push(`   Translation: [TO FILL]`);
    templateLines.push(``);
  });
  
  fs.writeFileSync(templatePath, templateLines.join('\n'), 'utf-8');
  console.log(`✓ Template generated: ${lang}-template.txt`);
  console.log(`  Path: ${templatePath}`);
}

// CLI
const command = process.argv[2];
const lang = process.argv[3];

switch (command) {
  case 'export':
    if (!lang) {
      console.error('Usage: node scripts/translation-workflow.mjs export {lang}');
      console.log('Available languages:', LANGUAGES_TO_TRANSLATE.join(', '));
      process.exit(1);
    }
    exportToCSV(lang);
    break;
    
  case 'import':
    if (!lang) {
      console.error('Usage: node scripts/translation-workflow.mjs import {lang}');
      console.log('Available languages:', LANGUAGES_TO_TRANSLATE.join(', '));
      process.exit(1);
    }
    importFromCSV(lang);
    break;
    
  case 'report':
    generateReport();
    break;
    
  case 'validate':
    if (!lang) {
      console.error('Usage: node scripts/translation-workflow.mjs validate {lang}');
      console.log('Available languages:', LANGUAGES_TO_TRANSLATE.join(', '));
      process.exit(1);
    }
    validateTranslation(lang);
    break;
    
  case 'template':
    if (!lang) {
      console.error('Usage: node scripts/translation-workflow.mjs template {lang}');
      console.log('Available languages:', LANGUAGES_TO_TRANSLATE.join(', '));
      process.exit(1);
    }
    generateTemplate(lang);
    break;
    
  default:
    console.log('Translation Workflow Script');
    console.log('=========================');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/translation-workflow.mjs export {lang}   # Exporta a CSV para traducir');
    console.log('  node scripts/translation-workflow.mjs import {lang}   # Importa traducciones desde CSV');
    console.log('  node scripts/translation-workflow.mjs report            # Reporte de progreso');
    console.log('  node scripts/translation-workflow.mjs validate {lang} # Valida traducción');
    console.log('  node scripts/translation-workflow.mjs template {lang} # Genera template para traducir');
    console.log('');
    console.log('Available languages:', LANGUAGES_TO_TRANSLATE.join(', '));
    console.log('');
    console.log('Example workflow:');
    console.log('  1. node scripts/translation-workflow.mjs template es');
    console.log('  2. Open es-template.txt and translate');
    console.log('  3. node scripts/translation-workflow.mjs export es');
    console.log('  4. Open es-translation.csv in Excel/Google Sheets');
    console.log('  5. Translate the Translation column');
    console.log('  6. node scripts/translation-workflow.mjs import es');
    console.log('  7. node scripts/translation-workflow.mjs validate es');
    console.log('  8. npm run build:landings');
    break;
}
