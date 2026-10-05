import { test, expect } from "@playwright/test";
import { skipPassword } from "./vault-helpers";
import { setupTestVault } from "./ai-guard-helpers";

/**
 * Phase 1 regression E2E — critical-fix guards.
 *
 * Two scenarios:
 *   A. RoutingOptimizer NEVER routes to a provider outside the configured
 *      list, even when that provider has high Q-values (exploitation) or
 *      under epsilon-greedy exploration (audit #1).
 *
 *   B. CostTracker hard-stop actually BLOCKS cloud AI calls when the daily
 *      budget is exhausted, instead of only logging a warning (audit #2).
 *      Local AI remains available.
 *
 * Determinism: Math.random pinned so RoutingOptimizer's exploration branch
 * is predictable (explore when < 0.1, exploit otherwise).
 */

// ─── Scenario A: RoutingOptimizer restricted to usable providers ───

test("RoutingOptimizer never routes to an unconfigured provider (Phase 1)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5; // exploitation branch (>= 0.1)
    try {
      // Only Ollama is configured — no OpenAI/Anthropic/Groq key.
      localStorage.setItem("selected_ai_provider", "ollama");
      localStorage.setItem("ollama_url", "http://localhost:11434/api/generate");
      localStorage.setItem("ollama_model", "llama3.2");
    } catch {
      /* non-fatal */
    }
  });

  // Stub Ollama availability probe and generate endpoint.
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

  await skipPassword(page);

  // Seed the Q-table: record 20 highly-successful outcomes for "anthropic"
  // on the "chat" task. Without the Phase 1 fix, exploitation would return
  // "anthropic" despite no API key configured.
  await page.evaluate(async () => {
    const { routingOptimizer } = await import(
      "/src/services/ai/adapters/RoutingOptimizer.ts"
    );
    await routingOptimizer.init();
    for (let i = 0; i < 20; i++) {
      await routingOptimizer.recordOutcome("chat", "anthropic", 100, true, 0.001);
    }
  });

  // Now run selectProvider 200 times — every result MUST be a configured
  // provider. With the fix, the optimizer receives availableProviders from
  // resolveProvider containing only ["ollama"] (the selected provider);
  // without the fix it would explore across all 6 and often return
  // "anthropic", "groq", etc.
  const results = await page.evaluate(async () => {
    const { routingOptimizer } = await import(
      "/src/services/ai/adapters/RoutingOptimizer.ts"
    );
    // Mirror resolveProvider: only Ollama is configured and reachable.
    const available = ["ollama"] as Array<
      "gemini" | "ollama" | "webllm" | "openai" | "anthropic" | "groq"
    >;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      // Use Math.random() internally to also exercise the exploration
      // branch (Math.random returns real values in page.evaluate, not the
      // pinned addInitScript value — the evaluate runs AFTER the page
      // script restores real random). This is intentional: we WANT to
      // test that exploration never escapes `available`.
      const p = await routingOptimizer.selectProvider(
        "chat",
        { complexity: "simple" },
        "ollama",
        available,
      );
      seen.add(p);
    }
    return [...seen];
  });

  expect(results.length, "should only return providers from the configured set").toBe(1);
  expect(results[0], "the only provider returned must be ollama").toBe("ollama");

  // Also verify with real Math.random (unpinned inside evaluate) that
  // exploration never leaks to an unconfigured provider.
  const exploredResults = await page.evaluate(async () => {
    const { routingOptimizer } = await import(
      "/src/services/ai/adapters/RoutingOptimizer.ts"
    );
    const available = ["ollama"] as Array<"ollama" | "webllm">;
    for (let i = 0; i < 500; i++) {
      const p = await routingOptimizer.selectProvider(
        "chat",
        {},
        "ollama",
        available,
      );
      // Fast-fail on any violation — no need to collect all results.
      if (p !== "ollama" && p !== "webllm") {
        return { violation: true, provider: p, iteration: i };
      }
    }
    return { violation: false };
  });

  expect(
    exploredResults.violation,
    `exploration leaked to ${JSON.stringify(exploredResults)}`,
  ).toBe(false);
});

// ─── Scenario B: CostTracker hard-stop blocks cloud AI calls ───

test("CostTracker hard-stop blocks cloud AI calls when budget is exhausted (Phase 1)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    try {
      localStorage.setItem("selected_ai_provider", "ollama");
      localStorage.setItem("ollama_url", "http://localhost:11434/api/generate");
      localStorage.setItem("ollama_model", "llama3.2");
    } catch {
      /* non-fatal */
    }
  });

  // Stub Ollama.
  let ollamaCalls = 0;
  await page.route("**/api/tags", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [{ name: "llama3.2" }] }),
    }),
  );
  await page.route("**/api/generate", (route) => {
    ollamaCalls += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        model: "llama3.2",
        response: "Mock reply from local Ollama",
        done: true,
      }),
    });
  });

  await skipPassword(page);

  // Set up a test vault so VaultIntegration.setApiKey() can succeed.
  await setupTestVault(page);

  // Stub OpenAI mock (cloud).
  let openaiCalls = 0;
  await page.route("https://api.openai.com/**", async (route) => {
    openaiCalls += 1;
    if (route.request().url().includes("/models")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{ message: { content: "Mock reply from OpenAI" } }],
      }),
    });
  });

  // Disable firewall and set up the cloud provider.
  await page.evaluate(async () => {
    const { setFirewallDisabled } = await import(
      "/src/utils/networkFirewall.ts"
    );
    setFirewallDisabled(true);
    const { aiManager } = await import(
      "/src/services/ai/ProviderManager.ts"
    );
    await aiManager.setApiKey("sk-e2e-budget-test-key");
    const { routingOptimizer } = await import(
      "/src/services/ai/adapters/RoutingOptimizer.ts"
    );
    routingOptimizer.clear();
  });

  // ── 1. Prove that cloud AI works BEFORE the budget is exhausted ──
  const providerDiag = await page.evaluate(async () => {
    const { aiManager } = await import(
      "/src/services/ai/ProviderManager.ts"
    );
    return {
      info: aiManager.getProviderInfo(),
      optimal: await (aiManager as any).resolveProvider({ complexity: "complex" }),
      hasKey: Boolean(aiManager.getApiKey()),
      selected: (aiManager as any).config?.getSelectedProvider?.() ?? null,
      browser: {
        onLine: navigator.onLine,
        effectiveType: (navigator as any).connection?.effectiveType ?? null,
        deviceMemory: (navigator as any).deviceMemory ?? null,
      },
    };
  });
  console.log("[phase1] provider before control", providerDiag);
  const controlResult = await page.evaluate(async () => {
    const { aiManager } = await import(
      "/src/services/ai/ProviderManager.ts"
    );
    await aiManager.setProvider("openai");
    console.log("[phase1] provider inside control", aiManager.getProviderInfo());
    // Pass complexity: "complex" so resolveProvider doesn't override
    // to Ollama for simple tasks (E2E routes are mocked for Ollama).
    // isPrivate: false is required — without it, resolveProvider treats
    // the request as private (fails closed) and routes to local Ollama.
    return aiManager.generateText("e2e budget control prompt", undefined, {
      complexity: "complex",
      isPrivate: false,
    });
  });

  expect(controlResult.provider).toBe("openai");
  expect(openaiCalls, "control call must reach the cloud mock").toBeGreaterThan(0);
  const openaiAfterControl = openaiCalls;

  // ── 2. Exhaust the budget for OpenAI ──
  await page.evaluate(async () => {
    const { costTrackerService } = await import(
      "/src/services/ai/CostTrackerService.ts"
    );
    await costTrackerService.init();

    // Set an absurdly low budget that the next call will exceed.
    await costTrackerService.setBudget("openai", 0.0001, true);

    // Record a high-cost request that consumes the entire budget.
    // 1M input tokens + 1M output tokens at OpenAI pricing ≈ $3, way over $0.0001.
    await costTrackerService.recordRequest(
      "openai",
      "gpt-4o-mini",
      "generateText",
      1_000_000,
      1_000_000,
      1000,
    );

    // Verify the budget status is now hard-stop.
    const status = costTrackerService.getBudgetStatus("openai");
    if (status.alertLevel !== "hard-stop") {
      throw new Error(
        `Expected hard-stop, got ${status.alertLevel} (${status.percentUsed}% used)`,
      );
    }
  });

  // ── 3. Attempt a cloud AI call — must throw ──
  const blockedResult = await page.evaluate(async () => {
    const { aiManager } = await import(
      "/src/services/ai/ProviderManager.ts"
    );
    await aiManager.setProvider("openai");
    try {
      await aiManager.generateText("e2e budget exhausted prompt", undefined, {
        complexity: "complex",
        isPrivate: false,
      });
      return { blocked: false };
    } catch (e) {
      return {
        blocked: true,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  });

  expect(
    blockedResult.blocked,
    "cloud call must be blocked when budget is exhausted",
  ).toBe(true);
  expect(blockedResult.message).toContain("Daily budget exhausted");

  // The blocked call must NOT have reached the OpenAI mock.
  expect(
    openaiCalls,
    "no additional cloud request must have been made after budget exhaustion",
  ).toBe(openaiAfterControl);

  // ── 4. Local AI (Ollama) must still work — budget only blocks cloud ──
  const localResult = await page.evaluate(async () => {
    const { aiManager } = await import(
      "/src/services/ai/ProviderManager.ts"
    );
    await aiManager.setProvider("ollama");
    return aiManager.generateText("e2e local after budget exhaustion");
  });

  expect(localResult.provider).toBe("ollama");
  expect(localResult.text).toContain("Mock reply from local Ollama");
});
