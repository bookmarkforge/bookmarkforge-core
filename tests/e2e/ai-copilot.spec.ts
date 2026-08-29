import { test, expect, type Page } from "@playwright/test";
import { skipPassword } from "./vault-helpers";

/**
 * AI Copilot E2E — full flow: unlock vault → open Copilot chat → send prompt
 * → verify assistant reply.
 *
 * Strategy: stub `agentService.globalChat` at the JS level inside the page,
 * bypassing Ollama HTTP mocking, RxDB message persistence, RAG search, and
 * memory engine initialization. The stub feeds a mock reply through the
 * `onChunk` callback (simulating streaming) and resolves after a short delay
 * so the streaming bubble is visible to the test assertion.
 *
 * NOTE: navigation is SPA tab-based (setActiveTab) — the vault lock state is
 * an in-memory zustand store, so a hard `page.goto` would wipe it.
 */
test.describe("AI Copilot", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("unlock vault, open copilot, send prompt, receive mocked reply", async ({
    page,
  }) => {
    // Block external model/CDN downloads (the RAG search would otherwise
    // pull a ~25MB ONNX model from HuggingFace — slow/flaky in CI).
    await page.route("**/huggingface.co/**", (route) => route.abort());
    await page.route("**/cdn.jsdelivr.net/**", (route) => route.abort());

    // Pin Math.random so the RoutingOptimizer stays deterministic.
    // Select Ollama so the app boots without trying cloud providers.
    await page.addInitScript(() => {
      Math.random = () => 0.5;
      try {
        localStorage.setItem("selected_ai_provider", "ollama");
      } catch {
        // non-fatal
      }
    });

    await skipPassword(page);
    await openCopilotTab(page);

    // Stub agentService.globalChat — feeds a mock reply through onChunk,
    // resolves after a micro-delay so the streaming bubble is visible.
    await page.evaluate(() => {
      const MOCK_REPLY = "Mock reply from ollama. You asked: Summarize the latest AI papers";
      // We must replace the method on the live singleton.  The Chat component
      // imports { agentService } from "../services/ai/AgentService", so we
      // patch the module namespace via a dynamic import of the same module.
      import("/src/services/ai/AgentService.ts").then((mod) => {
        const orig = mod.agentService.globalChat;
        mod.agentService.globalChat = async (
          question: string,
          _lang?: string,
          _isPrivate?: boolean,
          _sessionId?: string,
          onChunk?: (chunk: string) => void,
        ) => {
          // Simulate streaming: feed chunks with micro-delays.
          const words = MOCK_REPLY.split(" ");
          for (const word of words) {
            onChunk?.(word + " ");
            await new Promise((r) => setTimeout(r, 10));
          }
          return { text: MOCK_REPLY, sources: [] };
        };
      });
    });

    // Send a prompt.
    await page
      .getByPlaceholder(/Ask about your bookmarks/i)
      .fill("Summarize the latest AI papers");
    await page.getByLabel("Send").click();

    // The mocked reply appears in the streaming bubble while the stub feeds
    // chunks, then (if RxDB cooperates) in the message list.  Either way,
    // getByText finds it.
    await expect(
      page.getByText(/Mock reply from ollama/),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("copilot shows an error message when the provider call fails", async ({
    page,
  }) => {
    await page.route("**/huggingface.co/**", (route) => route.abort());
    await page.route("**/cdn.jsdelivr.net/**", (route) => route.abort());

    await page.addInitScript(() => {
      Math.random = () => 0.5;
      try {
        localStorage.setItem("selected_ai_provider", "ollama");
      } catch {
        // non-fatal
      }
    });

    await skipPassword(page);
    await openCopilotTab(page);

    // Reject the provider call so this test exercises Chat's real error path
    // (rather than returning an ordinary assistant response and expecting it
    // to be rendered as an error).
    await page.evaluate(async () => {
      const mod = await import("/src/services/ai/AgentService.ts");
      mod.agentService.globalChat = async () => {
        throw new Error("mock provider failure");
      };
    });

    await page.getByPlaceholder(/Ask about your bookmarks/i).fill("hi");
    await page.getByLabel("Send").click();

    // The production catch path persists and renders the localized error.
    await expect(
      page.getByText(/Sorry, I encountered an error processing your request/i),
    ).toBeVisible({ timeout: 30_000 });
  });
});

/** Switch to the Local RAG Chat tab through the bottom navigation. */
async function openCopilotTab(page: Page): Promise<void> {
  const tab = page.getByRole("button", {
    name: "Local RAG Chat",
    exact: true,
  });
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByLabel("Send")).toBeVisible({ timeout: 30_000 });
}
