/**
 * Script para abrir AlternativeTo en el navegador predeterminado
 * con los datos impresos en consola para copiar
 * 
 * Este script NO usa Puppeteer - abre tu navegador normal
 * para evitar problemas de detección de bots
 * 
 * Uso:
 *   node scripts/open-alternativeto-browser.mjs
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, '..');
const PROFILE_PATH = path.join(PROJECT_ROOT, 'ALTERNATIVETO-PROFILE.md');

// Leer el perfil
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

// Función para abrir URL en navegador predeterminado
function openInBrowser(url) {
  const os = platform();
  
  let command;
  switch (os) {
    case 'win32':
      command = `start "" "${url}"`;
      break;
    case 'darwin':
      command = `open "${url}"`;
      break;
    default:
      command = `xdg-open "${url}"`;
  }
  
  exec(command, (error) => {
    if (error) {
      console.error('❌ Error opening browser:', error);
      console.log('📝 Please open manually:', url);
    } else {
      console.log('✅ Browser opened');
    }
  });
}

// Función principal
async function main() {
  console.log('🌐 Opening AlternativeTo in your default browser...\n');
  console.log('⚠️  Make sure you are logged into AlternativeTo first!');
  console.log('📝 Login at: https://alternativeto.net/account/login/\n');
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 COPY THESE VALUES TO THE FORM:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('Name:');
  console.log(PRODUCT_DATA.name);
  console.log('\nShort Description:');
  console.log(PRODUCT_DATA.shortDescription);
  console.log('\nFull Description:');
  console.log(PRODUCT_DATA.fullDescription);
  console.log('\nWebsite:');
  console.log(PRODUCT_DATA.website);
  console.log('\nLicense:');
  console.log(PRODUCT_DATA.license);
  console.log('\nPlatform:');
  console.log(PRODUCT_DATA.platform);
  console.log('\nTags (comma-separated):');
  console.log(PRODUCT_DATA.tags.join(', '));
  console.log('\nAlternatives (add one by one):');
  PRODUCT_DATA.alternatives.forEach(alt => console.log(`  - ${alt}`));
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const url = 'https://alternativeto.net/software/add/';
  console.log(`🌐 Opening: ${url}\n`);
  
  openInBrowser(url);
  
  console.log('📝 MANUAL STEPS:');
  console.log('1. Login to AlternativeTo if not already logged in');
  console.log('2. Copy the values above to the form fields');
  console.log('3. Upload screenshots from screenshots-alternativeto/ directory');
  console.log('4. Select categories: Bookmark Manager, Note-taking, Knowledge Management');
  console.log('5. Click "Submit" when ready');
  console.log('\n💡 Tip: Take screenshots manually with Win+Shift+S (Windows) or Cmd+Shift+4 (Mac)');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
