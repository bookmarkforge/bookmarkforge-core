import { chromium } from "@playwright/test";
import { setupDemoVault, freezeDemoClock } from "./scripts/demo-tour-flow.mjs";
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:5173", viewport: { width: 1280, height: 720 } });
  
  // Setup page
  const setupPage = await context.newPage();
  await freezeDemoClock(setupPage);
  await setupDemoVault(setupPage);
  console.log("Setup done, URL:", setupPage.url());
  await setupPage.close();
  
  // Record page
  const page = await context.newPage();
  await freezeDemoClock(page);
  await page.goto("http://127.0.0.1:5173/app");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  console.log("Record page URL:", page.url());
  
  const fab = page.locator('[data-testid="add-bookmark-button"]');
  console.log("FAB count:", await fab.count());
  
  // Check vault state
  const lockedScreen = page.locator('[data-testid="vault-locked-screen"]');
  console.log("Locked screen visible:", await lockedScreen.isVisible().catch(() => false));
  
  const allButtons = await page.locator("button").allTextContents();
  console.log("All button texts:", JSON.stringify(allButtons.slice(0, 15)));
  
  await page.screenshot({ path: "debug-app.png" });
  await browser.close();
})().catch(e => console.error(e.message, e.stack));
