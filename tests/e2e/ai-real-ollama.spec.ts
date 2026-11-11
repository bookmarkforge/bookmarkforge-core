/**
 * tests/e2e/ai-real-ollama.spec.ts — REAL-provider coverage, opt-in.
 *
 * Every other AI spec stubs the provider endpoint (mock-openai-server or
 * route interception). This spec is the only one that exercises the real
 * Ollama HTTP path end-to-end — provider class, fetch stack, NDJSON/JSON
 * parsing and the ProviderManager routing layer — against a locally
 * running Ollama instance. It is the $0 way to cover "real AI provider"
 * behaviour without committing any credential: Ollama needs no API key.
 *
 * SELF-SKIPPING: when no Ollama server answers /api/tags the whole spec
 * skips after one localhost probe (~ms), so it is safe in every profile —
 * CI runners without Ollama simply skip it.
 *
 * To run it for real:
 *   1. Install Ollama and pull a model: `ollama pull llama3.2`
 *   2. `npm run e2e -- tests/e2e/ai-real-ollama.spec.ts`
 *
 * Overrides: E2E_OLLAMA_URL (default http://127.0.0.1:11434),
 *            E2E_OLLAMA_MODEL (default: first model /api/tags reports).
 */
import { test, expect, type Page } from "@playwright/test";
import { skipPassword, dismissOverlays } from "./vault-helpers";
import { setupTestVault } from "./ai-guard-helpers";

const OLLAMA_BASE =
  process.env.E2E_OLLAMA_URL ?? "http://127.0.0.1:11434";
const OLLAMA_GENERATE_URL = `${OLLAMA_BASE}/api/generate`;

interface OllamaTags {
  models?: Array<{ name?: string; model?: string }>;
}

let ollamaUp = false;
let ollamaModel = process.env.E2E_OLLAMA_MODEL ?? "";

test.describe("real Ollama provider (opt-in, self-skipping)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000); // first-token latency on CPU-only Ollama is real

  test.beforeAll(async () => {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return;
      const data = (await res.json()) as OllamaTags;
      ollamaUp = true;
      if (!ollamaModel) {
        ollamaModel =
          data.models?.find((m) => m.name)?.name ??
          data.models?.find((m) => m.model)?.model ??
          "";
      }
    } catch {
      // INTENTIONAL SILENCE: unreachable Ollama is the expected skip path.
    }
  });

  async function openVault(page: Page): Promise<void> {
    await page.goto("/app");
    await skipPassword(page);
    await dismissOverlays(page);
    await setupTestVault(page);
  }

  test("OllamaProvider answers isAvailable and generateText over real HTTP", async ({
    page,
  }) => {
    test.skip(!ollamaUp || !ollamaModel, "no Ollama server / no model pulled");
    await openVault(page);

    const result = await page.evaluate(
      async ({ url, model }) => {
        const { OllamaProvider } = await import(
          "/src/services/ai/providers/OllamaProvider.ts"
        );
        const provider = new OllamaProvider({ url, model });
        const available = await provider.isAvailable();
        if (!available) return { available, text: "" };
        const res = await provider.generateText(
          "Reply with exactly one word: OK",
        );
        return { available, text: res.text, provider: res.provider };
      },
      { url: OLLAMA_GENERATE_URL, model: ollamaModel },
    );

    expect(result.available).toBe(true);
    expect(result.text.trim().length).toBeGreaterThan(0);
  });

  test("ProviderManager routes a private request to real Ollama", async ({
    page,
  }) => {
    test.skip(!ollamaUp || !ollamaModel, "no Ollama server / no model pulled");
    await openVault(page);

    const result = await page.evaluate(
      async ({ url, model }) => {
        const { aiManager } = await import(
          "/src/services/ai/ProviderManager.ts"
        );
        await aiManager.setProvider("ollama");
        await aiManager.setOllamaSettings(url, model);
        const res = await aiManager.generateText(
          "Reply with exactly one word: OK",
          undefined,
          { isPrivate: true },
        );
        return { text: res.text, provider: res.provider };
      },
      { url: OLLAMA_GENERATE_URL, model: ollamaModel },
    );

    expect(result.provider).toBe("ollama");
    expect(result.text.trim().length).toBeGreaterThan(0);
  });
});
