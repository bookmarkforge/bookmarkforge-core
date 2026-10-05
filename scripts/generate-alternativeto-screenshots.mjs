/**
 * Script para generar screenshots automáticamente para AlternativeTo
 * 
 * Genera 5 screenshots optimizados:
 * 1. Main Dashboard
 * 2. Bookmark Editor
 * 3. AI Chat
 * 4. Privacy/Security
 * 5. Mobile/Responsive
 * 
 * Uso:
 *   node scripts/generate-alternativeto-screenshots.mjs
 * 
 * Requisitos:
 *   - La app debe estar corriendo en http://localhost:5173/
 *   - Debe haber bookmarks de prueba en la app
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'screenshots-alternativeto');

// Crear directorio de salida
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Configuración de la app
const APP_URL = 'http://localhost:5173/';

// Configuración de screenshots
const SCREENSHOT_CONFIG = {
  width: 1280,
  height: 800,
  deviceScaleFactor: 2, // Retina quality
  fullPage: false
};

// Función para tomar screenshot
async function takeScreenshot(page, filename, description) {
  const outputPath = path.join(OUTPUT_DIR, filename);
  console.log(`📸 Capturing: ${description}...`);
  
  await page.screenshot({
    path: outputPath,
    ...SCREENSHOT_CONFIG
  });
  
  console.log(`✓ Saved: ${filename}`);
}

// Función principal
async function main() {
  console.log('🖼️  Generating AlternativeTo screenshots...\n');
  
  const browser = await puppeteer.launch({ 
    headless: false, // Mostrar navegador para debugging
    protocolTimeout: 300000 // Aumentar a 5 minutos
  });
  
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  
  // Configurar viewport
  await page.setViewport({
    width: SCREENSHOT_CONFIG.width,
    height: SCREENSHOT_CONFIG.height,
    deviceScaleFactor: SCREENSHOT_CONFIG.deviceScaleFactor
  });
  
  try {
    // 1. Navegar a la app
    console.log('🌐 Navigating to app...');
    await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    
    // Esperar a que la app cargue
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 2. Screenshot 1: Main Dashboard
    console.log('\n--- Screenshot 1: Main Dashboard ---');
    await takeScreenshot(page, '01-main-dashboard.png', 'Main Dashboard');
    
    // 3. Navegar a un bookmark para el editor
    console.log('\n--- Screenshot 2: Bookmark Editor ---');
    
    // Intentar hacer click en el primer bookmark
    const firstBookmark = await page.$('[data-testid="bookmark-item"] .bookmark-title, .bookmark-list-item, [role="listitem"]');
    if (firstBookmark) {
      await firstBookmark.click();
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      console.log('⚠️  No bookmark found, taking screenshot of dashboard instead');
    }
    
    await takeScreenshot(page, '02-bookmark-editor.png', 'Bookmark Editor');
    
    // 4. Navegar al chat AI
    console.log('\n--- Screenshot 3: AI Chat ---');
    
    // Intentar encontrar el botón de chat
    const chatButton = await page.$('[data-testid="ai-chat-button"], button[aria-label*="chat"], button[aria-label*="AI"], .ai-chat-trigger');
    if (chatButton) {
      await chatButton.click();
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      console.log('⚠️  Chat button not found, navigating to chat page...');
      await page.goto(`${APP_URL}chat`, { waitUntil: 'networkidle0' });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    await takeScreenshot(page, '03-ai-chat.png', 'AI Chat');
    
    // 5. Navegar a settings/privacy
    console.log('\n--- Screenshot 4: Privacy/Security ---');
    
    await page.goto(`${APP_URL}settings`, { waitUntil: 'networkidle0' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Intentar scroll a la sección de seguridad
    const securitySection = await page.$('[data-testid="security"], [data-testid="privacy"], .security-settings, .privacy-settings');
    if (securitySection) {
      await securitySection.scrollIntoView();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    await takeScreenshot(page, '04-privacy-security.png', 'Privacy/Security');
    
    // 6. Screenshot 5: Mobile/Responsive
    console.log('\n--- Screenshot 5: Mobile/Responsive ---');
    
    // Cambiar a viewport móvil
    await page.setViewport({
      width: 375, // iPhone width
      height: 667, // iPhone height
      deviceScaleFactor: 2,
      isMobile: true
    });
    
    // Volver al dashboard
    await page.goto(APP_URL, { waitUntil: 'networkidle0' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await takeScreenshot(page, '05-mobile-responsive.png', 'Mobile/Responsive');
    
    console.log('\n✅ All screenshots generated successfully!');
    console.log(`📁 Output directory: ${OUTPUT_DIR}`);
    console.log('\nScreenshots generated:');
    console.log('  - 01-main-dashboard.png');
    console.log('  - 02-bookmark-editor.png');
    console.log('  - 03-ai-chat.png');
    console.log('  - 04-privacy-security.png');
    console.log('  - 05-mobile-responsive.png');
    
  } catch (error) {
    console.error('❌ Error generating screenshots:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
