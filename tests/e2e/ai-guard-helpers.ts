import { type Page, type Request } from "@playwright/test";

/**
 * Shared helpers for the S9 AI-guard e2e specs (vault-lock-ai-guard,
 * vault-lock-no-key-exfil, vault-auto-lock-s9-guard, vault-nuclear-forget-s9-guard).
 *
 * Each spec runs against the dedicated Vite `--mode test` server with
 * VITE_FORCE_DEXIE_STORAGE=true (see playwright.config.ts), so security
 * flows use the same durable backend as production.
 */

export const OPENAI_REPLY = "Mock reply from OpenAI";

/**
 * Pin the environment before any app code executes so provider routing is
 * deterministic:
 *  - Math.random → RoutingOptimizer's 10% exploration never fires.
 *  - navigator.connection="4g" + full battery → resolveProvider's
 *    "low battery / slow network -> gemini" branch never fires.
 *  - deviceMemory=2 + 2 cores → resourceManager.isHighEndDevice() is false,
 *    so "simple task -> local" routes to Ollama, never WebLLM.
 */
export async function pinDeterministicEnv(page: Page): Promise<void> {
  // Playwright 1.6x types addInitScript as Promise<Disposable>; awaiting
  // keeps this helper's Promise<void> contract.
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: {
        effectiveType: "4g",
        saveData: false,
        downlink: 10,
        rtt: 50,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    Object.defineProperty(navigator, "getBattery", {
      configurable: true,
      value: async () => ({
        level: 1,
        charging: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    Object.defineProperty(navigator, "deviceMemory", {
      configurable: true,
      value: 2,
    });
    Object.defineProperty(navigator, "hardwareConcurrency", {
      configurable: true,
      value: 2,
    });
  });
}

/**
 * Set up a test master password so API keys can be saved through
 * VaultIntegration.setApiKey() (which requires !securityVault.isLocked()).
 *
 * Must be called AFTER skipPassword() — the vault is unlocked in the UI
 * but securityVault has no masterPasswordBytes (no password was set).
 * This helper sets a dummy password so the vault is considered "configured"
 * and unlocked, allowing setApiKey() to succeed.
 */
export async function setupTestVault(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { securityVault } = await import(
      "/src/services/SecurityVault.ts"
    );
    // First unlock: verifyPassword returns true because no master password
    // was ever configured (hasMasterPassword() → false → accept any pw).
    const ok = await securityVault.unlock("test-e2e-password");
    if (!ok) throw new Error("setupTestVault: unlock failed");
    // Persist the flag so subsequent hasMasterPassword() calls return true.
    await securityVault.setMasterPasswordFlag();
  });
}

/**
 * Configure the OpenAI API key + cloud provider through the app's own
 * production path (the exact calls the Settings UI makes). Returns the
 * number of key-carrying requests the detector observed during setup
 * (setApiKey() fetches /models with the key).
 */
export async function configureOpenAICloud(
  page: Page,
  apiKey: string,
): Promise<void> {
  await page.evaluate(
    async ({ apiKey: key }) => {
      const { setFirewallDisabled } = await import(
        "/src/utils/networkFirewall.ts"
      );
      setFirewallDisabled(true);
      const { aiManager } = await import(
        "/src/services/ai/ProviderManager.ts"
      );
      const { routingOptimizer } = await import(
        "/src/services/ai/adapters/RoutingOptimizer.ts"
      );
      routingOptimizer.clear();
      await aiManager.setApiKey(key);
      await aiManager.setProvider("openai");
    },
    { apiKey },
  );
}

export interface AiCallDiag {
  apiKey: string | null;
  selectedProvider: string | null;
  providerInfo: {
    provider: string;
    model: string;
    isConfigured: boolean;
    [k: string]: unknown;
  };
  vaultLocked: boolean;
  /** Real vault state (securityVault.isLocked()), independent of whether an
   * API key is stored. aiManager.isVaultLocked() returns false when NO key is
   * stored ("nothing to protect"), so after a nuclear forget — which wipes the
   * key — only this flag proves the vault itself is locked. */
  securityVaultLocked: boolean;
}

/** Call aiManager.generateText inside the app; returns a serializable result. */
export async function aiCall(
  page: Page,
  options: { complexity: "simple" | "complex"; prompt?: string },
): Promise<
  | { ok: true; text: string; provider: string; diag: AiCallDiag }
  | { ok: false; error: string | null; diag: AiCallDiag }
> {
  const prompt = options.prompt ?? "e2e AI guard prompt";
  return page.evaluate(
    async ({ prompt, complexity }) => {
      const { aiManager } = await import("/src/services/ai/ProviderManager.ts");
      const diag: AiCallDiag = {
        apiKey: aiManager.getApiKey(),
        selectedProvider: (aiManager as any).config?.getSelectedProvider?.(),
        // Spread so the fresh literal satisfies the [k: string]: unknown
        // index signature on AiCallDiag.providerInfo (ProviderInfo itself
        // has no index signature).
        providerInfo: { ...aiManager.getProviderInfo() },
        vaultLocked: await aiManager.isVaultLocked(),
        securityVaultLocked: (await import("/src/services/SecurityVault.ts"))
          .securityVault.isLocked(),
      };
      try {
        // S9 control calls intentionally exercise the configured cloud
        // provider. The production router fails closed unless the caller
        // explicitly opts into cloud processing with `isPrivate: false`.
        const res = await aiManager.generateText(prompt, undefined, {
          complexity,
          isPrivate: false,
        });
        return { ok: true, text: res.text ?? "", provider: res.provider, diag };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          diag,
        };
      }
    },
    { prompt, complexity: options.complexity },
  );
}

/** Call aiManager.streamGenerateText (SSE chunked path) inside the app. */
export async function streamAiCall(
  page: Page,
  options: { complexity: "simple" | "complex"; prompt?: string },
): Promise<
  | { ok: true; text: string; provider: string; diag: AiCallDiag }
  | { ok: false; error: string | null; diag: AiCallDiag }
> {
  const prompt = options.prompt ?? "e2e AI guard stream prompt";
  return page.evaluate(
    async ({ prompt, complexity }) => {
      const { aiManager } = await import("/src/services/ai/ProviderManager.ts");
      const diag: AiCallDiag = {
        apiKey: aiManager.getApiKey(),
        selectedProvider: (aiManager as any).config?.getSelectedProvider?.(),
        // Spread so the fresh literal satisfies the [k: string]: unknown
        // index signature on AiCallDiag.providerInfo (ProviderInfo itself
        // has no index signature).
        providerInfo: { ...aiManager.getProviderInfo() },
        vaultLocked: await aiManager.isVaultLocked(),
        securityVaultLocked: (await import("/src/services/SecurityVault.ts"))
          .securityVault.isLocked(),
      };
      try {
        const chunks: string[] = [];
        const res = await aiManager.streamGenerateText(
          prompt,
          undefined,
          { complexity, isPrivate: false },
          (chunk: string) => chunks.push(chunk),
        );
        return {
          ok: true,
          text: res.text ?? chunks.join(""),
          provider: res.provider,
          diag,
        };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          diag,
        };
      }
    },
    { prompt, complexity: options.complexity },
  );
}

/** Mock the OpenAI /models + /chat/completions endpoints (SSE-aware). */
export async function mockOpenAI(page: Page): Promise<void> {
  await page.route("https://api.openai.com/**", async (route) => {
    const req = route.request();
    if (req.url().includes("/models")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }),
      });
      return;
    }
    const wantsStream = (() => {
      try {
        return (
          JSON.parse(req.postData() ?? "{}") as { stream?: boolean }
        ).stream;
      } catch {
        return false;
      }
    })();
    if (wantsStream) {
      const chunks = [
        { choices: [{ delta: { content: "Mock " } }] },
        { choices: [{ delta: { content: "reply " } }] },
        { choices: [{ delta: { content: "from " } }] },
        { choices: [{ delta: { content: "OpenAI" } }] },
      ];
      const body =
        chunks.map((c) => `data: ${JSON.stringify(c)}\n`).join("") +
        "data: [DONE]\n\n";
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{ message: { content: OPENAI_REPLY } }],
      }),
    });
  });
}

/** Mock the Ollama availability probe + generate endpoint (loopback is firewall-allowed). */
export async function mockOllama(page: Page): Promise<void> {
  await page.route("**/api/tags", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [{ name: "llama3.2" }] }),
    }),
  );
  await page.route("**/api/generate", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        model: "llama3.2",
        response: "Mock reply from local Ollama",
        done: true,
      }),
    }),
  );
}

/**
 * Network detector: counts every outbound request that carries the API key
 * (Authorization header, x-api-key header, POST body or URL query). Returns
 * a handle with `count()` (current count) and `details()` (last leak lines).
 * Register it BEFORE the first AI call so nothing can slip through.
 */
export function createKeyLeakDetector(
  page: Page,
  apiKey: string,
): { count: () => number; details: () => string[] } {
  let requestsWithKey = 0;
  const details: string[] = [];
  const handler = (req: Request): void => {
    const url = req.url();
    const headers = req.headers();
    const auth = headers["authorization"] ?? "";
    const xApiKey = headers["x-api-key"] ?? "";
    const body = (() => {
      try {
        return req.postData() ?? "";
      } catch {
        return "";
      }
    })();
    const leaked =
      auth.includes(apiKey) ||
      xApiKey.includes(apiKey) ||
      body.includes(apiKey) ||
      url.includes(apiKey);
    if (leaked) {
      requestsWithKey += 1;
      if (details.length < 5) {
        details.push(
          `${req.method()} ${url} auth=${auth.slice(0, 20)}… x-api-key=${xApiKey.slice(0, 20)}… body=${body.slice(0, 80)}…`,
        );
      }
    }
  };
  page.on("request", handler);
  return {
    count: () => requestsWithKey,
    details: () => details,
  };
}
