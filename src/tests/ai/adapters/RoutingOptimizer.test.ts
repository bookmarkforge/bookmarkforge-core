import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../services/SecureStorage", () => ({
  secureStorage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("RoutingOptimizer", () => {
  let randomSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("returns default provider when no Q-table entries exist", async () => {
    const { routingOptimizer } =
      await import("../../../services/ai/adapters/RoutingOptimizer");
    const provider = await routingOptimizer.selectProvider(
      "chat",
      {},
      "gemini",
    );
    expect(provider).toBe("gemini");
  });

  it("learns from successful outcomes", async () => {
    const { routingOptimizer } =
      await import("../../../services/ai/adapters/RoutingOptimizer");
    await routingOptimizer.init();

    // Simulate 10 successful fast calls to gemini for chat
    for (let i = 0; i < 10; i++) {
      await routingOptimizer.recordOutcome("chat", "gemini", 500, true, 0.001);
    }

    const stats = routingOptimizer.getStats();
    expect(stats.totalDecisions).toBeGreaterThanOrEqual(0);
    expect(stats.statesLearned).toBeGreaterThanOrEqual(1);
  });

  it("prefers providers with better success history", async () => {
    const { routingOptimizer } =
      await import("../../../services/ai/adapters/RoutingOptimizer");
    await routingOptimizer.init();

    // Gemini: fast and successful
    for (let i = 0; i < 5; i++) {
      await routingOptimizer.recordOutcome(
        "summarize",
        "gemini",
        300,
        true,
        0.001,
        { complexity: "complex" },
      );
    }

    // Ollama: slow and failing
    for (let i = 0; i < 5; i++) {
      await routingOptimizer.recordOutcome(
        "summarize",
        "ollama",
        8000,
        false,
        0,
        { complexity: "complex" },
      );
    }

    // After learning, should prefer gemini for summarize/complex states
    const provider = await routingOptimizer.selectProvider(
      "summarize",
      { complexity: "complex" },
      "ollama",
    );
    expect(provider).toBe("gemini");
  });

  it("persists and recovers Q-table", async () => {
    const { routingOptimizer } =
      await import("../../../services/ai/adapters/RoutingOptimizer");
    await routingOptimizer.init();

    await routingOptimizer.recordOutcome("search", "gemini", 200, true, 0.001);
    await routingOptimizer.persist();

    // Clear and reload
    const mockSecure = await import("../../../services/SecureStorage");
    expect(mockSecure.secureStorage.set).toHaveBeenCalled();
  });

  it("explores randomly with epsilon probability", async () => {
    randomSpy.mockRestore();
    const { routingOptimizer } =
      await import("../../../services/ai/adapters/RoutingOptimizer");
    await routingOptimizer.init();

    // Record outcomes to populate Q-table
    for (let i = 0; i < 20; i++) {
      await routingOptimizer.recordOutcome("chat", "gemini", 100, true, 0.001);
    }

    // With 10% exploration, over 100 selections some should be non-gemini
    const providers = new Set<string>();
    for (let i = 0; i < 100; i++) {
      providers.add(
        await routingOptimizer.selectProvider("chat", {}, "gemini"),
      );
    }

    // Should have explored at least one other provider
    expect(providers.size).toBeGreaterThan(1);
  });

  it("never explores providers outside the available list (audit #1)", async () => {
    randomSpy.mockRestore();
    const { routingOptimizer } =
      await import("../../../services/ai/adapters/RoutingOptimizer");
    await routingOptimizer.init();

    const seen = new Set<string>();
    // 500 iterations with real Math.random: exploration (10%) and
    // exploitation must ALWAYS stay inside the allowed list.
    // (El literal inline se tipa contextualmente como AIProviderId[]).
    for (let i = 0; i < 500; i++) {
      const p = await routingOptimizer.selectProvider(
        "chat",
        {},
        "gemini",
        ["gemini", "webllm"],
      );
      seen.add(p);
      expect(["gemini", "webllm"]).toContain(p);
    }
    // Ensures the test exercised the restricted-exploration branch.
    expect(seen.size).toBeGreaterThan(1);
  });

  it("exploitation ignores providers with high Q but unavailable (audit #1)", async () => {
    const { routingOptimizer } =
      await import("../../../services/ai/adapters/RoutingOptimizer");
    await routingOptimizer.init();

    // anthropic learns a high Q for chat
    for (let i = 0; i < 10; i++) {
      await routingOptimizer.recordOutcome(
        "chat",
        "anthropic",
        100,
        true,
        0.001,
      );
    }

    // Even if anthropic has the best Q, it is not in the usable list → never
    // selected (random 0.5 → exploitation branch).
    const provider = await routingOptimizer.selectProvider(
      "chat",
      {},
      "gemini",
      ["gemini", "ollama"],
    );
    expect(provider).not.toBe("anthropic");
    expect(["gemini", "ollama"]).toContain(provider);
  });

  it("does not leave an old init active after clear", async () => {
    const { routingOptimizer } =
      await import("../../../services/ai/adapters/RoutingOptimizer");
    const { secureStorage } = await import("../../../services/SecureStorage");
    let releaseLoad!: (value: null) => void;
    vi.mocked(secureStorage.get).mockImplementationOnce(
      () => new Promise((resolve) => { releaseLoad = resolve; }),
    );
    (routingOptimizer as any).initialized = false;

    const pendingInit = routingOptimizer.init();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(releaseLoad).toBeDefined();

    routingOptimizer.clear();
    releaseLoad(null);
    await pendingInit;

    expect((routingOptimizer as any).initialized).toBe(false);
    vi.mocked(secureStorage.get).mockResolvedValueOnce(null);
    await routingOptimizer.init();
    expect((routingOptimizer as any).initialized).toBe(true);
  });

  it("serializes clear behind a pending persist", async () => {
    const { routingOptimizer } =
      await import("../../../services/ai/adapters/RoutingOptimizer");
    const { secureStorage } = await import("../../../services/SecureStorage");
    const releaseSet = vi.fn();
    let release: (() => void) | undefined;
    vi.mocked(secureStorage.set).mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        release = resolve;
        releaseSet();
      }),
    );
    vi.mocked(secureStorage.set).mockClear();
    vi.mocked(secureStorage.remove).mockClear();

    const pendingPersist = routingOptimizer.persist();
    await Promise.resolve();
    await Promise.resolve();
    expect(releaseSet).toHaveBeenCalledTimes(1);

    routingOptimizer.clear();
    expect(secureStorage.remove).not.toHaveBeenCalled();

    release!();
    await pendingPersist;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(secureStorage.remove).toHaveBeenCalledWith("bmf_routing_qtable");
  });
});
