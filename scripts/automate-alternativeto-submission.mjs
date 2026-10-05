/**
 * Script para automatizar el llenado del formulario de AlternativeTo
 * 
 * NOTA: Este script requiere login manual - no automatizamos el login por seguridad
 * El script espera que ya estés logueado en AlternativeTo
 * 
 * Uso:
 *   1. Loguéate manualmente en https://alternativeto.net/
 *   2. Ejecuta: node scripts/automate-alternativeto-submission.mjs
 *   3. El script abrirá el navegador y llenará el formulario automáticamente
 *   4. Revisa y haz submit manualmente
 * 
 * Requisitos:
 *   - Estar logueado en AlternativeTo
 *   - Puppeteer instalado
 *   - Archivo ALTERNATIVETO-PROFILE.md con el contenido
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, '..');
const PROFILE_PATH = path.join(PROJECT_ROOT, 'ALTERNATIVETO-PROFILE.md');

// Leer el perfil (requisito del script: sin contenido no hay datos que enviar)
const profileContent = fs.readFileSync(PROFILE_PATH, 'utf-8');
if (profileContent.trim().length === 0) {
  console.error('✗ ALTERNATIVETO-PROFILE.md está vacío — completa el perfil antes de enviar.');
  process.exit(1);
}

// Datos del producto
const PRODUCT_DATA = {
  name: 'BookmarkForge',
  shortDescription: 'Local-first AI bookmark manager with zero-knowledge encryption. Your bookmarks, notes, and AI conversations stay on your device - never in the cloud.',
  fullDescription: `BookmarkForge is a privacy-first, local-first bookmark manager and knowledge vault that keeps your data encrypted on your device. Unlike Raindrop or Pocket, we never see your bookmarks, notes, or AI conversations.

Key Features:
- 100% Local Storage: All your bookmarks, notes, and documents are stored in your browser using IndexedDB with AES-GCM-256 encryption
- Zero-Knowledge Architecture: We can't access your data even if we wanted to - encryption keys never leave your device
- AI-Powered Knowledge: Chat RAG over your bookmarks using local AI models (WebLLM) or your own API keys (OpenAI, Anthropic, etc.)
- Works Offline: Full functionality without internet connection
- 30 Languages: Available in 30 languages with complete Spanish, French, German, Portuguese, and Italian translations
- One-Time Payment: Lifetime license - no monthly subscriptions
- P2P Sync: Sync across 5 devices peer-to-peer, no central server
- Advanced Export: Export to JSON, Markdown, CSV, PDF, and 10+ formats
- Flashcards: Generate flashcards with spaced repetition from your content
- Expert AI Agents: Coder, Writer, Analyst, and Researcher agents for specialized tasks

Perfect for:
- Privacy-conscious users who want control over their data
- Researchers and academics who need offline access
- Students organizing study materials with AI assistance
- Professionals managing knowledge bases with sensitive information
- Anyone tired of subscription-based bookmark managers

Security:
- AES-GCM-256 encryption for all stored content
- Argon2id (memory-hard KDF) for password-derived keys
- Client-side encryption - keys never transmitted
- No analytics by default
- CSP reports with IP hashing for rate limiting only

Privacy:
- No bookmarks or URLs sent to servers
- No notes or documents leave your device
- No AI prompts or responses logged by us
- No browsing history tracked
- No personal information required to use the app`,
  website: 'https://www.bookmarkforgeapp.com',
  license: 'Freeware, Commercial',
  platform: 'Web Browser',
  tags: [
    'bookmark-manager',
    'bookmarks',
    'productivity',
    'privacy',
    'local-first',
    'offline',
    'encryption',
    'zero-knowledge',
    'ai',
    'artificial-intelligence',
    'knowledge-management',
    'note-taking',
    'research',
    'study'
  ],
  alternatives: [
    'Raindrop.io',
    'Pocket',
    'Notion',
    'Obsidian'
  ]
};

// Función principal
async function main() {
  console.log('🤖 Automating AlternativeTo submission...\n');
  console.log('⚠️  NOTE: You must be logged into AlternativeTo first!');
  console.log('📝 Login at: https://alternativeto.net/account/login/\n');
  
  const browser = await puppeteer.launch({ 
    headless: false, // Mostrar navegador para revisión
    protocolTimeout: 120000
  });
  
  const page = await browser.newPage();
  
  try {
    // 1. Navegar a la página de agregar software
    console.log('🌐 Navigating to AlternativeTo add page...');
    await page.goto('https://alternativeto.net/software/add/', { 
      waitUntil: 'networkidle0',
      timeout: 60000 
    });
    
    // Esperar que el formulario cargue
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 2. Llenar el nombre
    console.log('📝 Filling name...');
    const nameInput = await page.$('input[name="name"], input[id*="name"], input[placeholder*="name"]');
    if (nameInput) {
      await nameInput.click({ clickCount: 3 }); // Seleccionar todo
      await nameInput.type(PRODUCT_DATA.name);
      console.log('✓ Name filled');
    } else {
      console.log('⚠️  Name input not found');
    }
    
    // 3. Llenar descripción corta
    console.log('📝 Filling short description...');
    const shortDescInput = await page.$('textarea[name="shortDescription"], textarea[id*="short"], textarea[placeholder*="short"]');
    if (shortDescInput) {
      await shortDescInput.click({ clickCount: 3 });
      await shortDescInput.type(PRODUCT_DATA.shortDescription);
      console.log('✓ Short description filled');
    } else {
      console.log('⚠️  Short description input not found');
    }
    
    // 4. Llenar descripción larga
    console.log('📝 Filling full description...');
    const fullDescInput = await page.$('textarea[name="description"], textarea[id*="description"], textarea[placeholder*="description"]');
    if (fullDescInput) {
      await fullDescInput.click({ clickCount: 3 });
      await fullDescInput.type(PRODUCT_DATA.fullDescription);
      console.log('✓ Full description filled');
    } else {
      console.log('⚠️  Full description input not found');
    }
    
    // 5. Llenar website
    console.log('📝 Filling website...');
    const websiteInput = await page.$('input[name="website"], input[id*="website"], input[type="url"]');
    if (websiteInput) {
      await websiteInput.click({ clickCount: 3 });
      await websiteInput.type(PRODUCT_DATA.website);
      console.log('✓ Website filled');
    } else {
      console.log('⚠️  Website input not found');
    }
    
    // 6. Llenar tags
    console.log('📝 Filling tags...');
    const tagsInput = await page.$('input[name="tags"], input[id*="tags"], input[placeholder*="tags"]');
    if (tagsInput) {
      await tagsInput.click({ clickCount: 3 });
      await tagsInput.type(PRODUCT_DATA.tags.join(', '));
      console.log('✓ Tags filled');
    } else {
      console.log('⚠️  Tags input not found');
    }
    
    // 7. Añadir alternativas (esto puede requerir clicks adicionales)
    console.log('📝 Adding alternatives...');
    for (const alt of PRODUCT_DATA.alternatives) {
      const altInput = await page.$('input[name="alternative"], input[placeholder*="alternative"]');
      if (altInput) {
        await altInput.type(alt);
        await page.keyboard.press('Enter');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    console.log('✓ Alternatives added');
    
    console.log('\n✅ Form filled automatically!');
    console.log('\n📋 MANUAL STEPS REQUIRED:');
    console.log('1. Review all filled fields');
    console.log('2. Upload screenshots manually (automation not possible due to file input restrictions)');
    console.log('3. Select categories manually');
    console.log('4. Click "Submit" when ready');
    console.log('\n⏸️  Browser will stay open for manual review...');
    
    // No cerrar el navegador - dejar abierto para revisión manual
    console.log('\nPress Ctrl+C in terminal to close browser when done.');
    
    // Esperar input del usuario para cerrar
    await new Promise(resolve => {
      process.on('SIGINT', resolve);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
