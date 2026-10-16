/**
 * Custom provider full flow E2E: configure, list models, chat with streaming.
 *
 * Requires:
 *  - mock-openai-server.mjs running on port 8789 (npm run mock:ai)
 */
import { test, expect, type Page } from "@playwright/test";
import { skipPassword, dismissOverlays } from "./vault-helpers";
import { setupTestVault } from "./ai-guard-helpers";

const MOCK_BASE_URL = "http://127.0.0.1:8789/v1";
const MOCK_KEY = "sk-test-key-12345";
const MOCK_MODEL = "bmforge-mock";

async function configureCustomProvider(page: Page): Promise<void> {
  await page.evaluate(
    async ({ baseUrl, key, model }) => {
      const { aiManager } = await import("/src/services/ai/ProviderManager.ts");
      await aiManager.setProvider("custom");
      await aiManager.setCustomBaseUrl(baseUrl);
      await aiManager.setModel(model);
      await aiManager.setApiKey(key);
    },
    { baseUrl: MOCK_BASE_URL, key: MOCK_KEY, model: MOCK_MODEL },
  );
}

test.describe("@nightly Custom OpenAI-format provider full flow", () => {
  test("configura el proveedor custom via production path y verifica provider info", async ({
    page,
  }) => {
    await skipPassword(page);
    await dismissOverlays(page);
    await setupTestVault(page);
    await configureCustomProvider(page);

    const info = await page.evaluate(async () => {
      const { aiManager } = await import("/src/services/ai/ProviderManager.ts");
      const providerInfo = aiManager.getProviderInfo();
      return {
        provider: providerInfo.provider,
        model: providerInfo.model,
        isConfigured: providerInfo.isConfigured,
      };
    });

    expect(info.provider).toBe("custom");
    expect(info.model).toBe(MOCK_MODEL);
    expect(info.isConfigured).toBe(true);
  });

  test("lista los modelos del mock via fetchAvailableModels", async ({
    page,
  }) => {
    await skipPassword(page);
    await dismissOverlays(page);
    await setupTestVault(page);
    await configureCustomProvider(page);

    const models = await page.evaluate(async () => {
      const { aiManager } = await import("/src/services/ai/ProviderManager.ts");
      return aiManager.fetchAvailableModels();
    });

    expect(models).toContain("bmforge-mock");
    expect(models).toContain("bmforge-mock-mini");
  });

  test("chatea con streaming contra el mock", async ({ page }) => {
    await skipPassword(page);
    await dismissOverlays(page);
    await setupTestVault(page);
    await configureCustomProvider(page);

    // Open the Local RAG Chat tab
    const chatTab = page.locator('[data-tab-id="chatLocal"]');
    await expect(chatTab).toBeVisible({ timeout: 10_000 });
    await chatTab.click();

    // Wait for chat input
    const chatInput = page.getByTestId("chat-input");
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    // Send a message
    await chatInput.fill("Hola, prueba de streaming");
    await chatInput.press("Enter");

    // Verify the mock responds — wait for any element containing the mock's
    // reply prefix. The mock wraps prompts in <<<USER_DATA_START>>> sentinels,
    // so the streamed reply starts with "[mock] You said: <<<USER_DATA_START>>>".
    await expect
      .poll(
        async () => {
          const bodyText = await page.evaluate(() => document.body.innerText);
          return bodyText.includes("[mock] You said:");
        },
        { timeout: 15_000, intervals: [500] },
      )
      .toBe(true);
  });
});
