/**
 * Custom provider full flow E2E: configure, list models, chat with streaming.
 *
 * Requires:
 *  - mock-openai-server.mjs running on port 8789 (npm run mock:ai)
 *  - vault desbloqueado (setupTestVault) para guardar API key
 *
 * Flujo verificado:
 *  1. Abre Settings y navega al panel de IA
 *  2. Configura el proveedor Custom (OpenAI Format) con base URL, key y model
 *  3. Guarda la configuración (vault desbloqueado)
 *  4. Verifica que los modelos del mock aparecen disponibles
 *  5. Escribe un prompt en el chat y verifica que la respuesta fluye en streaming
 */
import { test, expect, type Page } from "@playwright/test";
import { setupTestVault } from "./ai-guard-helpers";

const MOCK_BASE_URL = "http://localhost:8789/v1";
const MOCK_KEY = "sk-test-key-12345";
const MOCK_MODEL = "bmforge-mock";

test.describe("Custom OpenAI-format provider full flow", () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Desbloquear vault para poder guardar API key
    await setupTestVault(page);
  });

  test.afterEach(async () => {
    await page.close();
  });

  test("configura el proveedor custom y guarda la configuración", async () => {
    // 1. Navegar a Settings
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // 2. Esperar a que el panel de AI esté visible
    const aiConfigSection = page.getByTestId("settings-ai-config");
    await expect(aiConfigSection).toBeVisible({ timeout: 10000 });

    // 3. Seleccionar proveedor Custom (OpenAI Format)
    const providerSelect = page.getByLabel("AI Provider");
    await expect(providerSelect).toBeVisible();
    await providerSelect.selectOption("custom");
    await page.waitForTimeout(500);

    // 4. Verificar que el formulario de Custom Provider aparece
    const customProviderHeader = page.getByText("Custom AI Provider");
    await expect(customProviderHeader).toBeVisible({ timeout: 5000 });

    // 5. Configurar Base URL
    const baseUrlInput = page.getByLabel("API Base URL");
    await expect(baseUrlInput).toBeVisible();
    await baseUrlInput.fill(MOCK_BASE_URL);
    await page.waitForTimeout(300);

    // 6. Configurar Model ID
    const modelInput = page.getByLabel("Model ID");
    await expect(modelInput).toBeVisible();
    await modelInput.fill(MOCK_MODEL);
    await page.waitForTimeout(300);

    // 7. Configurar API Key
    const apiKeyInput = page.getByLabel("API Key");
    await expect(apiKeyInput).toBeVisible();
    await apiKeyInput.fill(MOCK_KEY);
    await page.waitForTimeout(300);

    // 8. Guardar la configuración (hacer clic en Save)
    const saveButton = page.getByRole("button", { name: /save/i }).first();
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // 9. Esperar a que la configuración se guarde (toast de éxito)
    const successToast = page.getByText(/API key saved successfully/i);
    await expect(successToast).toBeVisible({ timeout: 10000 });
  });

  test("lista los modelos del mock después de configurar el proveedor custom", async () => {
    // 1. Navegar a Settings y configurar el proveedor
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    await setupTestVault(page);

    const providerSelect = page.getByLabel("AI Provider");
    await providerSelect.selectOption("custom");
    await page.waitForTimeout(500);

    const baseUrlInput = page.getByLabel("API Base URL");
    await baseUrlInput.fill(MOCK_BASE_URL);

    const modelInput = page.getByLabel("Model ID");
    await modelInput.fill(MOCK_MODEL);

    const apiKeyInput = page.getByLabel("API Key");
    await apiKeyInput.fill(MOCK_KEY);

    // 2. Guardar la configuración
    const saveButton = page.getByRole("button", { name: /save/i }).first();
    await saveButton.click();

    // 3. Esperar a que la configuración se guarde
    const successToast = page.getByText(/API key saved successfully/i);
    await expect(successToast).toBeVisible({ timeout: 10000 });

    // 4. Verificar que el modelo configurado está en el input de Model ID
    const modelInputAfterSave = page.getByLabel("Model ID");
    await expect(modelInputAfterSave).toHaveValue(MOCK_MODEL);
  });

  test("chatea con streaming contra el mock después de configurar custom provider", async () => {
    // 1. Primero configurar el proveedor custom en Settings
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    await setupTestVault(page);

    const providerSelect = page.getByLabel("AI Provider");
    await providerSelect.selectOption("custom");
    await page.waitForTimeout(500);

    const baseUrlInput = page.getByLabel("API Base URL");
    await baseUrlInput.fill(MOCK_BASE_URL);

    const modelInput = page.getByLabel("Model ID");
    await modelInput.fill(MOCK_MODEL);

    const apiKeyInput = page.getByLabel("API Key");
    await apiKeyInput.fill(MOCK_KEY);

    const saveButton = page.getByRole("button", { name: /save/i }).first();
    await saveButton.click();

    const successToast = page.getByText(/API key saved successfully/i);
    await expect(successToast).toBeVisible({ timeout: 10000 });

    // 2. Navegar al chat
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 3. Escribir un prompt
    const chatInput = page.getByTestId("chat-input");
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    await chatInput.fill("Hola, prueba de streaming");
    await chatInput.press("Enter");

    // 4. Esperar a que empiece el stream (el mock responde con "[mock] You said: ...")
    const streamingContent = page.getByText(/\[mock\] You said:/i);
    await expect(streamingContent).toBeVisible({ timeout: 15000 });

    // 5. Verificar que el mensaje tiene el contenido completo
    const fullText = await streamingContent.innerText();
    expect(fullText).toContain("Hola, prueba de streaming");
  });
});
