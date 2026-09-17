import { test, expect, type Page } from "@playwright/test";
import {
  pinDeterministicEnv,
  setupTestVault,
} from "./ai-guard-helpers";

/**
 * Custom (OpenAI Format) provider E2E — the app's REAL settings and REAL
 * provider code against the local OpenAI-compatible mock
 * (scripts/mock-openai-server.mjs, topology in
 * playwright.custom-provider.config.ts, run with `npm run e2e:custom-provider`).
 *
 * No page.route interception of the app's own provider calls: the browser
 * talks to http://127.0.0.1:8789/v1 over loopback (the SSRF firewall always
 * allows loopback without disabling it), so everything below exercises
 * production code paths:
 *
 *   Settings UI (AIConfigSection) → aiManager.setCustomBaseUrl → config
 *     → aiManager.setApiKey → ProviderConfiguration (custom wiring: the user's
 *     selection wins over detectProvider, so generic keys stay "custom")
 *     → OpenAICompatibleProvider(provider="custom") → firewalledFetch → mock
 *
 * Asserted contract:
 *  - selecting Custom + base URL + generic key builds a configured provider
 *    (regression guard for the ProviderConfiguration custom-wiring fix)
 *  - aiManager.fetchAvailableModels() lists the mock's models via GET /models
 *  - generateText/streamGenerateText round-trip the mock, including SSE
 *    streaming through readSSEStream
 *  - scenario models error-401/429/500 drive the provider's status→message
 *    mapping: 401/429 map to the i18n messages (ai_error_invalidKey /
 *    ai_error_rateLimit); 500 surfaces the raw "custom API error 500"
 *    (documented gap: no friendly mapping for 5xx — changing that must be a
 *    conscious product decision, cf. the utils.test.ts contract tests)
 *
 * Scenario selection mirrors the Settings UI: the scenario model is SET as
 * the provider's Model ID (setModel + setApiKey rebuild), exactly like a
 * user typing it into the Custom form — the dispatch path does not forward
 * per-request model overrides to the custom provider instance.
 */

const MOCK_BASE = `http://127.0.0.1:${
  Number(process.env.MOCK_AI_PORT ?? 8789)
}/v1`;
const MOCK_KEY = "sk-mock-local-key";

const INVALID_KEY_MSG = "Invalid API key. Please check your settings.";
const RATE_LIMIT_MSG =
  "Rate limit exceeded or insufficient quota. Try another model or provider.";

interface CustomCallResult {
  ok: boolean;
  error: string;
  text: string;
  chunks: string[];
  providerInfo: { provider: string; model: string; isConfigured: boolean };
}

/**
 * Drive the configured custom provider through aiManager inside the page —
 * the same entry points the Chat UI and agents use. The model under test is
 * the one configured in the provider (see configureCustomProvider), matching
 * how the Settings UI's Model ID field works.
 */
async function callCustom(
  page: Page,
  mode: "unary" | "stream",
  label: string,
): Promise<CustomCallResult> {
  return page.evaluate(
    async ({ mode, label }) => {
      const { aiManager } = await import("/src/services/ai/ProviderManager.ts");
      const chunks: string[] = [];
      const info = { ...aiManager.getProviderInfo() };
      const providerInfo = {
        provider: info.provider,
        model: info.model,
        isConfigured: info.isConfigured,
      };
      try {
        const opts = { isPrivate: false, complexity: "simple" as const };
        // Unique prompt per test: the semantic cache matches by intent, so a
        // repeated prompt could serve a previous test's (successful) reply
        // here and mask the error path under test.
        const prompt = `custom-provider e2e ${label} ${mode} prompt`;
        const result =
          mode === "stream"
            ? await aiManager.streamGenerateText(
                prompt,
                undefined,
                opts,
                (chunk: string) => chunks.push(chunk),
              )
            : await aiManager.generateText(prompt, undefined, opts);
        return {
          ok: true,
          error: "",
          text: result.text ?? chunks.join(""),
          chunks: [...chunks],
          providerInfo,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          text: "",
          chunks: [...chunks],
          providerInfo,
        };
      }
    },
    { mode, label },
  );
}

/**
 * Configure the Custom provider through the app's own production path — the
 * exact calls the Settings UI's CustomProviderForm makes (select → base URL →
 * Model ID → key). This is deliberately NOT a page.evaluate shortcut around
 * the config: it is the wiring under test. setApiKey LAST because it is the
 * call that builds the OpenAICompatibleProvider instance with the model and
 * base URL set beforehand (same as saving the key in the UI).
 */
async function configureCustomProvider(
  page: Page,
  model = "bmforge-mock",
): Promise<void> {
  await page.evaluate(
    async ({ mockBase, key, model }) => {
      const { aiManager } = await import("/src/services/ai/ProviderManager.ts");
      const { routingOptimizer } = await import(
        "/src/services/ai/adapters/RoutingOptimizer.ts"
      );
      routingOptimizer.clear();
      await aiManager.setProvider("custom");
      await aiManager.setCustomBaseUrl(mockBase);
      await aiManager.setModel(model);
      await aiManager.setApiKey(key);
    },
    { mockBase: MOCK_BASE, key: MOCK_KEY, model },
  );
}

test.describe("@nightly Custom provider via local OpenAI-compatible mock", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await pinDeterministicEnv(page);
    // /src/... dynamic imports need the page ON the app first.
    await page.goto("/");
    // The vault must be unlocked so setApiKey persists and cloud calls pass
    // the S9 vault guard (ai-guard-helpers contract).
    await setupTestVault(page);
  });

  test("settings path builds a configured custom provider from a generic key", async ({
    page,
  }) => {
    await configureCustomProvider(page);

    const info = await page.evaluate(async () => {
      const { aiManager } = await import("/src/services/ai/ProviderManager.ts");
      const info = { ...aiManager.getProviderInfo() };
      return {
        provider: info.provider,
        isConfigured: info.isConfigured,
        model: info.model,
      };
    });

    // The core regression guard for the ProviderConfiguration fix: a generic
    // key ("sk-mock-local-key" matches no vendor prefix) must NOT be dropped
    // as "unknown" — the user's Custom selection is authoritative.
    expect(info.provider).toBe("custom");
    expect(info.isConfigured).toBe(true);
    expect(info.model).toBe("bmforge-mock");
  });

  test("fetchAvailableModels lists the mock's models through GET /models", async ({
    page,
  }) => {
    await configureCustomProvider(page);

    const models = await page.evaluate(async () => {
      const { aiManager } = await import("/src/services/ai/ProviderManager.ts");
      return aiManager.fetchAvailableModels();
    });

    expect(models).toContain("bmforge-mock");
    expect(models).toContain("bmforge-mock-mini");
  });

  test("generateText round-trips the mock through the custom provider", async ({
    page,
  }) => {
    await configureCustomProvider(page);

    const result = await callCustom(page, "unary", "basic");
    expect(result.ok, `expected success, got: ${result.error}`).toBe(true);
    expect(result.text).toContain("[mock] You said:");
    expect(result.providerInfo.provider).toBe("custom");
  });

  test("streamGenerateText streams SSE tokens through readSSEStream", async ({
    page,
  }) => {
    await configureCustomProvider(page);

    const result = await callCustom(page, "stream", "basic");
    expect(result.ok, `expected success, got: ${result.error}`).toBe(true);
    // Streaming reply arrives token-by-token and reassembles to the mock text.
    expect(result.chunks.length).toBeGreaterThanOrEqual(3);
    expect(result.chunks.join("")).toContain("[mock] You said:");
  });

  test("scenario model error-401 surfaces the invalid-key message", async ({
    page,
  }) => {
    // Configure the scenario model the way the UI would: set it as the
    // provider's Model ID, then save the key (rebuilds the provider).
    await configureCustomProvider(page, "error-401");

    const result = await callCustom(page, "unary", "error-401");
    expect(result.ok).toBe(false);
    expect(result.error).toBe(INVALID_KEY_MSG);
  });

  test("scenario model error-429 surfaces the rate-limit message", async ({
    page,
  }) => {
    await configureCustomProvider(page, "error-429");

    const result = await callCustom(page, "unary", "error-429");
    expect(result.ok).toBe(false);
    expect(result.error).toBe(RATE_LIMIT_MSG);
  });

  test("scenario model error-500 surfaces a friendly server-error message", async ({
    page,
  }) => {
    await configureCustomProvider(page, "error-500");

    const result = await callCustom(page, "unary", "error-500");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("server error");
    expect(result.error).toContain("500");
  });

  test("scenario model error-503 surfaces a friendly server-error message", async ({
    page,
  }) => {
    await configureCustomProvider(page, "error-503");

    const result = await callCustom(page, "unary", "error-503");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("server error");
    expect(result.error).toContain("503");
  });
});
