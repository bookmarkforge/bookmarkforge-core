import { test, expect } from '@playwright/test';

/**
 * Demostración automatizada de BookmarkForge con comportamiento humano
 * Versión robusta con selectores flexibles y manejo de errores
 */

test.describe('Demo BookmarkForge - Human-like Automation', () => {
  // Opt-in (the repo's house pattern, cf. webrtc-handshake-diagnostics): this
  // spec is a scripted 5-minute demo with NO assertions at all — it has zero
  // `expect` calls, so as a nightly test it measured theatre: the multi-user
  // shard paid ~1 min of runner time per night for a run that could not fail
  // by construction. Set BMF_RUN_DEMO_AUTOMATION=true to run it on purpose;
  // the vacuous-tests ratchet still tracks it as declared debt.
  test.skip(!process.env.BMF_RUN_DEMO_AUTOMATION, 'opt-in demo: set BMF_RUN_DEMO_AUTOMATION=true');
  test('demo completa automatizada', async ({ page }) => {
    test.setTimeout(300000); // 5 minutos timeout para demo completa
    // Configurar viewport como escritorio normal
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    // Human-like delay function
    const humanDelay = (min: number, max: number) => {
      const delay = Math.random() * (max - min) + min;
      return new Promise(resolve => setTimeout(resolve, delay));
    };

    // Human-like scroll
    const humanScroll = async (pixels: number) => {
      await page.evaluate((p) => {
        window.scrollBy({ top: p, behavior: 'smooth' });
      }, pixels);
      await humanDelay(500, 1000);
    };

    // Human-like typing
    const humanType = async (selector: string, text: string) => {
      await page.fill(selector, ''); // Limpiar primero
      await humanDelay(200, 400);
      for (const char of text) {
        await page.keyboard.type(char);
        await humanDelay(50, 150);
      }
    };

    console.log('🎬 Iniciando demo automatizada...');
    
    // ESCENA 1: Introducción
    console.log('📍 Escena 1: Introducción');
    await page.goto('http://localhost:4173');
    await humanDelay(3000, 4000);
    
    // Scroll suave para ver toda la página
    await humanScroll(300);
    await humanDelay(1000, 1500);
    await humanScroll(-300);
    await humanDelay(1000, 1500);

    // ESCENA 2: Navegación principal
    console.log('📍 Escena 2: Navegación principal');
    
    // Intentar encontrar elementos de navegación comunes
    const navSelectors = [
      'nav a:has-text("Bookmarks")',
      'a:has-text("Bookmarks")',
      '[href*="bookmarks"]',
      'button:has-text("Bookmarks")'
    ];
    
    let foundBookmarks = false;
    for (const selector of navSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          await element.click();
          foundBookmarks = true;
          await humanDelay(1500, 2000);
          break;
        }
      } catch {
        continue;
      }
    }

    if (!foundBookmarks) {
      console.log('⚠️ No se encontró navegación Bookmarks, continuando con demo visual');
    }

    // ESCENA 3: Demo visual de interfaz
    console.log('📍 Escena 3: Demo visual de interfaz');
    
    // Scroll por la página actual
    await humanScroll(400);
    await humanDelay(1500, 2000);
    await humanScroll(-200);
    await humanDelay(1000, 1500);
    await humanScroll(200);
    await humanDelay(1000, 1500);
    await humanScroll(-400);
    await humanDelay(1000, 1500);

    // ESCENA 4: Interacción con búsqueda
    console.log('📍 Escena 4: Interacción con búsqueda');
    
    const searchSelectors = [
      'input[placeholder*="search" i]',
      'input[type="search"]',
      '[role="search"] input'
    ];
    
    for (const selector of searchSelectors) {
      try {
        const searchInput = page.locator(selector).first();
        if (await searchInput.isVisible({ timeout: 2000 })) {
          await humanType(selector, 'security');
          await humanDelay(1000, 1500);
          await page.keyboard.press('Enter');
          await humanDelay(2000, 3000);
          
          // Limpiar
          await searchInput.fill('');
          await humanDelay(500, 800);
          break;
        }
      } catch {
        continue;
      }
    }

    // ESCENA 5: Navegación por secciones
    console.log('📍 Escena 5: Navegación por secciones');
    
    // Intentar navegar a diferentes secciones
    const sections = ['Settings', 'Notes', 'Dashboard', 'Home'];
    for (const section of sections) {
      try {
        const link = page.locator(`a:has-text("${section}"), button:has-text("${section}")`).first();
        if (await link.isVisible({ timeout: 1000 })) {
          await link.click();
          await humanDelay(1500, 2000);
          break;
        }
      } catch {
        continue;
      }
    }

    // ESCENA 6: Demo de scroll y contenido
    console.log('📍 Escena 6: Demo de scroll y contenido');
    
    // Scroll vertical completo
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    await humanDelay(1000, 1500);
    
    await page.evaluate(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
    await humanDelay(2000, 3000);
    
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    await humanDelay(1000, 1500);

    // ESCENA 7: Interacción con botones
    console.log('📍 Escena 7: Interacción con botones');
    
    // Encontrar y hacer click en botones visibles
    const buttons = await page.locator('button').all();
    let clickCount = 0;
    for (const button of buttons.slice(0, 3)) { // Solo primeros 3 botones
      try {
        if (await button.isVisible() && clickCount < 2) {
          await button.click();
          await humanDelay(1000, 1500);
          clickCount++;
          
          // Navegar back si es posible
          if (clickCount > 0) {
            await page.goBack();
            await humanDelay(1000, 1500);
          }
        }
      } catch {
        continue;
      }
    }

    // ESCENA 8: Conclusión
    console.log('📍 Escena 8: Conclusión');
    await page.goto('http://localhost:4173');
    await humanDelay(3000, 4000);
    
    // Scroll final dramático
    await humanScroll(500);
    await humanDelay(2000, 3000);
    await humanScroll(-500);
    await humanDelay(1000, 1500);

    console.log('✅ Demo automatizada completada');
    await humanDelay(2000, 3000);
  });
});