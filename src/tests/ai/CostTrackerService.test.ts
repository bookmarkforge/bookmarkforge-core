import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../observability/ObservabilityHub", () => ({
  observabilityHub: {
    recordAICall: vi.fn(),
  },
}));

describe("CostTrackerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // Cost to use in budget ladder tests: 1+1 tokens on google ≈ 3.75e-7 USD.
  async function seedGoogleRequests(costTrackerService: any, count: number) {
    for (let i = 0; i < count; i++) {
      await costTrackerService.recordRequest(
        "google",
        "gemini-pro",
        "chat",
        1,
        1,
        1,
      );
    }
  }

  it("records an AI request with cost calculation", async () => {
    const { costTrackerService, PROVIDER_PRICING } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "chat",
      1000,
      200,
      1500,
    );

    const history = costTrackerService.getUsageHistory("google", 1);
    expect(history.length).toBe(1);
    expect(history[0]!.tokensIn).toBe(1000);
    expect(history[0]!.tokensOut).toBe(200);
    expect(history[0]!.durationMs).toBe(1500);
    expect(history[0]!.provider).toBe("google");

    // Cost: (1000 * 0.000075 + 200 * 0.0003) / 1000 = (0.075 + 0.06) / 1000 = 0.000135
    const pricing = PROVIDER_PRICING["google"];
    const expectedCost =
      (1000 * pricing!.inputPer1K + 200 * pricing!.outputPer1K) / 1000;
    expect(history[0]!.cost).toBeCloseTo(expectedCost, 8);
  });

  it("aggregates cost by provider", async () => {
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "chat",
      100,
      20,
      100,
    );
    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "chat",
      200,
      40,
      200,
    );
    await costTrackerService.recordRequest(
      "openai",
      "gpt-4",
      "chat",
      50,
      10,
      300,
    );

    const byProvider = costTrackerService.getCostByProvider(1);
    expect(Object.keys(byProvider)).toContain("google");
    expect(Object.keys(byProvider)).toContain("openai");
    expect(byProvider["google"]).toBeGreaterThan(0);
    expect(byProvider["openai"]).toBeGreaterThan(0);
  });

  it("tracks zero-cost local providers correctly", async () => {
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    await costTrackerService.recordRequest(
      "ollama",
      "llama3",
      "chat",
      500,
      100,
      500,
    );

    const history = costTrackerService.getUsageHistory("ollama", 1);
    expect(history[0]!.cost).toBe(0);
  });

  it("budget alert ladder works correctly", async () => {
    const { costTrackerService, PROVIDER_PRICING } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    // Use a small budget so a single request exceeds it
    const pricing = PROVIDER_PRICING["google"];
    const costPerRequest =
      (1 * pricing!.inputPer1K + 1 * pricing!.outputPer1K) / 1000;
    const microBudget = costPerRequest * 3; // 3 requests worth = ~300%
    costTrackerService.setBudget("google", microBudget, true);

    // No usage yet
    let status = costTrackerService.getBudgetStatus("google");
    expect(status.alertLevel).toBe("none");

    // Make 3 requests to blow past 100% (hard-stop territory)
    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "chat",
      1,
      1,
      1,
    );
    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "chat",
      1,
      1,
      1,
    );
    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "chat",
      1,
      1,
      1,
    );

    status = costTrackerService.getBudgetStatus("google");
    expect(["info", "warning", "critical", "hard-stop"]).toContain(
      status.alertLevel,
    );
    expect(status.percentUsed).toBeGreaterThan(0);
    expect(status.remaining).toBeGreaterThanOrEqual(0);
  });

  it("returns total cost for a period", async () => {
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "chat",
      1000,
      200,
      100,
    );
    await costTrackerService.recordRequest(
      "openai",
      "gpt-4",
      "chat",
      500,
      100,
      200,
    );

    const total = costTrackerService.getTotalCost(1);
    expect(total).toBeGreaterThan(0);
    // Default window is 30 days.
    expect(costTrackerService.getTotalCost()).toBe(total);
  });

  it("prices Gemini using its canonical provider id", async () => {
    const { costTrackerService, PROVIDER_PRICING } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    await costTrackerService.recordRequest(
      "gemini",
      "gemini-2.5-flash",
      "chat",
      1000,
      1000,
      50,
    );
    const history = costTrackerService.getUsageHistory("gemini", 1);
    const expected =
      (PROVIDER_PRICING.gemini!.inputPer1K +
        PROVIDER_PRICING.gemini!.outputPer1K) /
      1;
    expect(history[0]!.cost).toBeCloseTo(expected, 10);
    expect(history[0]!.cost).toBeGreaterThan(0);
  });

  it("rejects an unknown provider instead of treating it as free", async () => {
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    await expect(
      costTrackerService.recordRequest(
        "totally-unknown-provider",
        "model-x",
        "chat",
        1000,
        1000,
        50,
      ),
    ).rejects.toThrow("No pricing configured");
  });


  it("clamps negative token counts to zero", async () => {
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    await costTrackerService.recordRequest(
      "openai",
      "gpt-4",
      "chat",
      -5,
      -3,
      10,
    );
    const history = costTrackerService.getUsageHistory("openai", 1);
    expect(history[0]!.cost).toBe(0);
  });

  it("init early-returns when already initialized (no duplicate load)", async () => {
    const { secureStorage } = await import("../../services/SecureStorage");
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();
    await costTrackerService.init();
    // Each init() reads TWO keys (records + budget), so one effective init
    // is exactly 2 gets — a second init must not add more.
    const getCalls = (secureStorage.get as ReturnType<typeof vi.fn>).mock.calls;
    expect(getCalls.length).toBe(2);
  });

  it("warns and resets state when loading stored records fails", async () => {
    // Import the logger in the SAME module-registry generation as the
    // service (beforeEach calls vi.resetModules(), which re-creates the
    // logger module for the dynamic import below).
    const { logger } = await import("../../utils/logger");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { secureStorage } = await import("../../services/SecureStorage");
    (secureStorage.get as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("storage down"))
      .mockRejectedValueOnce(new Error("storage down"));
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    expect(warnSpy).toHaveBeenCalledWith(
      "[CostTracker] Failed to load stored records",
      expect.anything(),
    );
    expect(costTrackerService.getUsageHistory(undefined, 1)).toEqual([]);
    warnSpy.mockRestore();
  });

  it("warns when persisting budget fails", async () => {
    const { logger } = await import("../../utils/logger");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { secureStorage } = await import("../../services/SecureStorage");
    (secureStorage.set as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("write denied"));
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    await costTrackerService.setBudget("google", 10, true);
    expect(warnSpy).toHaveBeenCalledWith(
      "[CostTracker] Failed to persist budget",
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("warns when persisting records fails", async () => {
    const { logger } = await import("../../utils/logger");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { secureStorage } = await import("../../services/SecureStorage");
    (secureStorage.set as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("quota"));
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "chat",
      10,
      10,
      5,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[CostTracker] Failed to persist records",
    );
    warnSpy.mockRestore();
  });

  it("returns default disabled budget when none is set", async () => {
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    expect(costTrackerService.getBudget("nonexistent")).toEqual({
      maxDailyUSD: 5,
      enabled: false,
    });
    const status = costTrackerService.getBudgetStatus("nonexistent");
    expect(status.alertLevel).toBe("none");
    expect(status.percentUsed).toBe(0);
  });

  it("reports info alert between 50-75% of budget", async () => {
    const { costTrackerService, PROVIDER_PRICING } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();
    const unit = (PROVIDER_PRICING["google"]!.inputPer1K +
      PROVIDER_PRICING["google"]!.outputPer1K) /
      1000;
    // 2 units ≈ 2x the unit cost; budget of 3 units → ~66% → info.
    await costTrackerService.setBudget("google", unit * 3, true);
    await seedGoogleRequests(costTrackerService, 2);
    expect(costTrackerService.getBudgetStatus("google").alertLevel).toBe(
      "info",
    );
  });

  it("reports warning alert between 75-90% of budget", async () => {
    const { costTrackerService, PROVIDER_PRICING } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();
    const unit = (PROVIDER_PRICING["google"]!.inputPer1K +
      PROVIDER_PRICING["google"]!.outputPer1K) /
      1000;
    // Comfortably interior (80%), never on a float-rounding boundary.
    await costTrackerService.setBudget("google", unit * 5, true);
    await seedGoogleRequests(costTrackerService, 4); // 4/5 = 80% → warning
    expect(costTrackerService.getBudgetStatus("google").alertLevel).toBe(
      "warning",
    );
  });

  it("reports critical alert between 90-100% of budget", async () => {
    const { costTrackerService, PROVIDER_PRICING } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();
    const unit = (PROVIDER_PRICING["google"]!.inputPer1K +
      PROVIDER_PRICING["google"]!.outputPer1K) /
      1000;
    // 4/4.2 ≈ 95.2% → firmly critical (not straddling the 90% cliff).
    await costTrackerService.setBudget("google", unit * 4.2, true);
    await seedGoogleRequests(costTrackerService, 4);
    expect(costTrackerService.getBudgetStatus("google").alertLevel).toBe(
      "critical",
    );
  });

  it("aggregates cost by operation", async () => {
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "summarize",
      100,
      50,
      10,
    );
    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "summarize",
      50,
      25,
      10,
    );
    await costTrackerService.recordRequest(
      "openai",
      "gpt-4",
      "chat",
      10,
      5,
      10,
    );

    const byOperation = costTrackerService.getCostByOperation(1);
    expect(Object.keys(byOperation).sort()).toEqual(["chat", "summarize"]);
    // Both providers are costed; aggregate sums the two summarize requests.
    expect(byOperation["summarize"]).toBeGreaterThan(0);
    expect(byOperation["chat"]).toBeGreaterThan(0);
  });

  it("aggregates total tokens by provider", async () => {
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "chat",
      100,
      20,
      5,
    );
    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "chat",
      50,
      10,
      5,
    );
    const totals = costTrackerService.getTotalTokensByProvider(1);
    expect(totals["google"]).toEqual({ in: 150, out: 30 });
  });

  it("clears all records", async () => {
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "chat",
      10,
      10,
      5,
    );
    expect(costTrackerService.getUsageHistory(undefined, 1).length).toBe(1);
    costTrackerService.clearRecords();
    expect(costTrackerService.getUsageHistory(undefined, 1).length).toBe(0);
  });

  it("logs a warning when a hard-stop budget is exceeded", async () => {
    const { logger } = await import("../../utils/logger");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { costTrackerService, PROVIDER_PRICING } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();
    const unit = (PROVIDER_PRICING["google"]!.inputPer1K +
      PROVIDER_PRICING["google"]!.outputPer1K) /
      1000;
    await costTrackerService.setBudget("google", unit * 2, true);
    await seedGoogleRequests(costTrackerService, 3); // 3/2 = 150% → hard-stop
    expect(warnSpy).toHaveBeenCalledWith(
      "[CostTracker] Hard stop reached for google — blocking request",
    );
    warnSpy.mockRestore();
  });

  it("assertUnderBudget throws when the budget is in hard-stop (audit #2)", async () => {
    const { costTrackerService, PROVIDER_PRICING } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();
    const unit = (PROVIDER_PRICING["google"]!.inputPer1K +
      PROVIDER_PRICING["google"]!.outputPer1K) /
      1000;
    await costTrackerService.setBudget("google", unit * 2, true);
    await seedGoogleRequests(costTrackerService, 3); // 3/2 = 150% → hard-stop
    await expect(costTrackerService.assertUnderBudget("google")).rejects.toThrow(
      /budget exhausted/i,
    );
  });

  it("assertUnderBudget no lanza con presupuesto deshabilitado", async () => {
    const { costTrackerService } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();
    await expect(
      costTrackerService.assertUnderBudget("google"),
    ).resolves.toBeUndefined();
  });

  it("assertUnderBudget does not throw when spending is under the cap", async () => {
    const { costTrackerService, PROVIDER_PRICING } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();
    const unit = (PROVIDER_PRICING["google"]!.inputPer1K +
      PROVIDER_PRICING["google"]!.outputPer1K) /
      1000;
    await costTrackerService.setBudget("google", unit * 10, true);
    await seedGoogleRequests(costTrackerService, 1); // 10% del tope
    await expect(
      costTrackerService.assertUnderBudget("google"),
    ).resolves.toBeUndefined();
  });

  it("reserves an in-flight spend so concurrent requests cannot overshoot", async () => {
    const { costTrackerService, PROVIDER_PRICING } =
      await import("../../services/ai/CostTrackerService");
    await costTrackerService.init();

    const pricing = PROVIDER_PRICING["google"];
    const unit = (1 * pricing!.inputPer1K + 1 * pricing!.outputPer1K) / 1000;
    // Budget = 100 request units: after 99 recorded, percentUsed = 99.
    await costTrackerService.setBudget("google", unit * 100, true);
    await seedGoogleRequests(costTrackerService, 99);

    // First admission is allowed (99% < 100%, no in-flight yet).
    await expect(
      costTrackerService.assertUnderBudget("google"),
    ).resolves.toBeUndefined();

    // A SECOND concurrent admission while the first spend is still in
    // flight must be rejected: percentUsed 99% + 1 in-flight => would
    // overshoot if both requests actually spent.
    await expect(
      costTrackerService.assertUnderBudget("google"),
    ).rejects.toThrow(/Daily budget exhausted/);

    // Releasing the reservation (recording the reserved request) pushes the
    // recorded total to exactly 100% — a real hard-stop, so the next
    // admission is correctly rejected.
    await costTrackerService.recordRequest(
      "google",
      "gemini-pro",
      "chat",
      1,
      1,
      1,
    );
    await expect(
      costTrackerService.assertUnderBudget("google"),
    ).rejects.toThrow(/Daily budget exhausted/);
  });
});
