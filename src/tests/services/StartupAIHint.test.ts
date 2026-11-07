import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Move mocks to top-level so they are hoisted and consistently applied.
vi.mock("../../services/SupportDiagnostics", () => ({
  checkNetwork: vi.fn().mockResolvedValue({ online: false }),
  checkOllama: vi.fn().mockResolvedValue({ available: false }),
  checkWebLLM: vi.fn().mockResolvedValue({ canRun: false }),
}));

vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: {
    getProviderInfo: vi.fn().mockReturnValue({ isConfigured: false }),
  },
}));

vi.mock("../../i18n", () => ({
  default: {
    t: (key: string, fallback: string) => fallback,
  },
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  redactSecrets: (input: string) => input,
}));

vi.mock("sonner", () => ({
  toast: {
    warning: vi.fn(),
  },
}));

// Reset module state between tests so shownThisSession does not leak.
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("StartupAIHint", () => {
  it("does nothing when shownThisSession is true", async () => {
    const { maybeShowStartupAIHint } = await import(
      "../../services/StartupAIHint"
    );
    // First call should execute; second call should be guarded.
    await maybeShowStartupAIHint();
    await maybeShowStartupAIHint();
    // The toast should have been called only once due to the guard.
    const { toast } = await import("sonner");
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("does nothing in non-browser environments", async () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error test harness
    delete globalThis.window;

    const { maybeShowStartupAIHint } = await import(
      "../../services/StartupAIHint"
    );
    await maybeShowStartupAIHint();
    globalThis.window = originalWindow;
  });

  it("shows offline toast when offline and no provider configured", async () => {
    const { checkNetwork } = await import("../../services/SupportDiagnostics");
    (checkNetwork as any).mockResolvedValue({ online: false });

    const { maybeShowStartupAIHint } = await import(
      "../../services/StartupAIHint"
    );

    // @ts-expect-error test harness
    globalThis.window = { dispatchEvent: vi.fn() };
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: false },
      configurable: true,
    });

    await maybeShowStartupAIHint();

    const { toast } = await import("sonner");
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const call = (toast.warning as any).mock.calls[0][0];
    expect(call).toContain("offline");
    expect(call).toContain(
      "Set up an API key in Settings or configure local AI to use the AI assistant.",
    );
  });

  it("shows ollama hint when online, no provider, but ollama available", async () => {
    const { checkNetwork, checkOllama, checkWebLLM } = await import(
      "../../services/SupportDiagnostics"
    );
    (checkNetwork as any).mockResolvedValue({ online: true });
    (checkOllama as any).mockResolvedValue({ available: true });
    (checkWebLLM as any).mockResolvedValue({ canRun: false });

    const { maybeShowStartupAIHint } = await import(
      "../../services/StartupAIHint"
    );

    // @ts-expect-error test harness
    globalThis.window = { dispatchEvent: vi.fn() };
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: true },
      configurable: true,
    });

    await maybeShowStartupAIHint();

    const { toast } = await import("sonner");
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const call = (toast.warning as any).mock.calls[0][0];
    expect(call).toContain("Local AI (Ollama) is running and ready to use.");
  });

  it("shows webllm hint when online, no provider, ollama unavailable but webllm can run", async () => {
    const { checkNetwork, checkOllama, checkWebLLM } = await import(
      "../../services/SupportDiagnostics"
    );
    (checkNetwork as any).mockResolvedValue({ online: true });
    (checkOllama as any).mockResolvedValue({ available: false });
    (checkWebLLM as any).mockResolvedValue({ canRun: true });

    const { maybeShowStartupAIHint } = await import(
      "../../services/StartupAIHint"
    );

    // @ts-expect-error test harness
    globalThis.window = { dispatchEvent: vi.fn() };
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: true },
      configurable: true,
    });

    await maybeShowStartupAIHint();

    const { toast } = await import("sonner");
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const call = (toast.warning as any).mock.calls[0][0];
    expect(call).toContain("Local AI (WebLLM) can run right in your browser.");
  });

  it("shows setup hint when online, no provider, and no local AI available", async () => {
    const { checkNetwork, checkOllama, checkWebLLM } = await import(
      "../../services/SupportDiagnostics"
    );
    (checkNetwork as any).mockResolvedValue({ online: true });
    (checkOllama as any).mockResolvedValue({ available: false });
    (checkWebLLM as any).mockResolvedValue({ canRun: false });

    const { maybeShowStartupAIHint } = await import(
      "../../services/StartupAIHint"
    );

    // @ts-expect-error test harness
    globalThis.window = { dispatchEvent: vi.fn() };
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: true },
      configurable: true,
    });

    await maybeShowStartupAIHint();

    const { toast } = await import("sonner");
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const call = (toast.warning as any).mock.calls[0][0];
    expect(call).toContain(
      "Set up an API key in Settings or configure local AI to use the AI assistant.",
    );
  });

  it("does not show hint when online and provider configured", async () => {
    const { checkNetwork } = await import("../../services/SupportDiagnostics");
    (checkNetwork as any).mockResolvedValue({ online: true });

    const { aiManager } = await import("../../services/ai/ProviderManager");
    (aiManager.getProviderInfo as any).mockReturnValue({ isConfigured: true });

    const { maybeShowStartupAIHint } = await import(
      "../../services/StartupAIHint"
    );

    // @ts-expect-error test harness
    globalThis.window = { dispatchEvent: vi.fn() };
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: true },
      configurable: true,
    });

    await maybeShowStartupAIHint();

    const { toast } = await import("sonner");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("logs warning when provider info import fails", async () => {
    const { maybeShowStartupAIHint } = await import(
      "../../services/StartupAIHint"
    );

    // @ts-expect-error test harness
    globalThis.window = { dispatchEvent: vi.fn() };
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: true },
      configurable: true,
    });

    await maybeShowStartupAIHint();
  });
});
