import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../\.\./services/ai/ProviderManager", () => ({
  aiManager: {
    generateText: vi.fn(),
    getProviderInfo: vi.fn().mockReturnValue({ isConfigured: true }),
    isOllamaAvailable: vi.fn().mockResolvedValue(false),
  },
}));

// WebLLMService is Pro: the double is installed at the pro-access loader
// instead of at the Pro module (SemanticSearchService probes through the gate).
// Hoisted so the loader and the assertions share one object — a fresh double
// per `loadWebLLMService()` call would make `vi.mocked(...)` in the tests target
// the real module instead of the double.
const mockWebLLMService = vi.hoisted(() => ({
  canRunLocalLLM: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../services/pro-access", () => ({
  loadWebLLMService: async () => mockWebLLMService,
  ProUnavailableError: class ProUnavailableError extends Error {},
}));

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { semanticSearchService, runWithTimeout } =
  await import("../../\.\./services/ai/SemanticSearchService");
const { aiManager } = await import("../../\.\./services/ai/ProviderManager");

describe("SemanticSearchService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    semanticSearchService.resetAvailability();
  });

  describe("runWithTimeout", () => {
    it("aborts the operation and rejects when the deadline expires", async () => {
      let operationSignal: AbortSignal | undefined;
      const operation = vi.fn(
        (signal: AbortSignal) => {
          operationSignal = signal;
          return new Promise<string>(() => {});
        },
      );

      await expect(runWithTimeout(operation, 10)).rejects.toMatchObject({
        name: "TimeoutError",
      });
      expect(operationSignal?.aborted).toBe(true);
    });

    it("propagates caller cancellation and does not swallow AbortError", async () => {
      const controller = new AbortController();
      const promise = runWithTimeout(
        (signal) => new Promise<string>((_, reject) => {
          signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
        1_000,
        controller.signal,
      );
      controller.abort();
      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    });
  });

  describe("expandQuery", () => {
    it("immediately rejects an aborted query", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        semanticSearchService.expandQuery("abc", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(aiManager.generateText).not.toHaveBeenCalled();
    });

    it("returns the original query if it has fewer than 3 characters", async () => {
      const result = await semanticSearchService.expandQuery("ab");
      expect(result).toBe("ab");
      expect(aiManager.generateText).not.toHaveBeenCalled();
    });

    it("expande query de 3 caracteres con AI", async () => {
      vi.mocked(aiManager.generateText).mockResolvedValue({ text: "expanded" } as any);
      const result = await semanticSearchService.expandQuery("abc");
      expect(aiManager.generateText).toHaveBeenCalled();
    });

    it("returns the original query if it contains an email", async () => {
      const result =
        await semanticSearchService.expandQuery("test@example.com");
      expect(result).toBe("test@example.com");
      expect(aiManager.generateText).not.toHaveBeenCalled();
    });

    it("returns the original query if it contains an API key", async () => {
      const result = await semanticSearchService.expandQuery(
        "sk-123456789012345678901234",
      );
      expect(result).toBe("sk-123456789012345678901234");
      expect(aiManager.generateText).not.toHaveBeenCalled();
    });

    it("returns the original query if it contains an SSN", async () => {
      const result = await semanticSearchService.expandQuery("123-45-6789");
      expect(result).toBe("123-45-6789");
      expect(aiManager.generateText).not.toHaveBeenCalled();
    });

    it("returns the original query if it contains a credit card", async () => {
      const result = await semanticSearchService.expandQuery(
        "4111 1111 1111 1111",
      );
      expect(result).toBe("4111 1111 1111 1111");
      expect(aiManager.generateText).not.toHaveBeenCalled();
    });

    it("returns the original query if it contains a token", async () => {
      const result = await semanticSearchService.expandQuery(
        "token_abcdefghijklmnopqrstuvwxyz",
      );
      expect(result).toBe("token_abcdefghijklmnopqrstuvwxyz");
      expect(aiManager.generateText).not.toHaveBeenCalled();
    });

    it("returns the original query if it contains an auth key", async () => {
      const result = await semanticSearchService.expandQuery(
        "auth-1234567890123456789012",
      );
      expect(result).toBe("auth-1234567890123456789012");
      expect(aiManager.generateText).not.toHaveBeenCalled();
    });

    it("expande query normal con AI", async () => {
      vi.mocked(aiManager.generateText).mockResolvedValue({
        text: "machine learning AI neural networks",
      } as any);
      const result =
        await semanticSearchService.expandQuery("machine learning");
      expect(result).toContain("machine learning");
      expect(result).toContain("machine learning AI neural networks");
      expect(aiManager.generateText).toHaveBeenCalledWith(
        expect.stringContaining("machine learning"),
        expect.any(String),
        expect.objectContaining({ complexity: "simple", isPrivate: true }),
      );
    });

    it("keeps query expansion local by default", async () => {
      vi.mocked(aiManager.generateText).mockResolvedValue({ text: "expanded" } as any);
      await semanticSearchService.expandQuery("private project");
      expect(aiManager.generateText).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ isPrivate: true }),
      );
    });

    it("returns the original query if AI fails", async () => {
      vi.mocked(aiManager.generateText).mockRejectedValue(
        new Error("API error"),
      );
      const result = await semanticSearchService.expandQuery("data science");
      expect(result).toBe("data science");
    });

    it("projects expansion failures through the bounded shape (safeErrorForLog)", async () => {
      // Regression: the existing comment in the source code is explicit
      // about NOT putting the original query in logs. The safeErrorForLog
      // projection meta is `{ name, message }`, length-bounded, no stack.
      const { logger } = await import("../../../utils/logger");
      vi.mocked(aiManager.generateText).mockRejectedValueOnce(
        new Error(`provider lost dataset: ${"x".repeat(300)} payload`),
      );
      const result = await semanticSearchService.expandQuery(
        "data science",
      );
      // The original query is preserved (privacy guard).
      expect(result).toBe("data science");
      const calls = (logger.error as any).mock.calls as unknown[][];
      const failureEntry = calls.find(
        ([label]: unknown[]) =>
          typeof label === "string" &&
          (label as string).includes("Query expansion failed"),
      );
      expect(failureEntry).toBeDefined();
      const meta = failureEntry![1] as {
        error?: { name?: unknown; message?: unknown };
      };
      expect(typeof meta.error?.name).toBe("string");
      expect(typeof meta.error?.message).toBe("string");
      expect((meta.error?.message as string).length).toBeLessThanOrEqual(220);
      expect(meta.error?.message as string).toMatch(/\u2026\[\+\d+\]/);
      expect(meta.error).not.toHaveProperty("stack");
    });
  });

  describe("checkLLMAvailability — offline", () => {
    beforeEach(() => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: false,
      });
    });

    it("returns false if offline and there are no local LLMs", async () => {
      semanticSearchService.resetAvailability();
      const result = await semanticSearchService.expandQuery("machine learning");
      expect(result).toBe("machine learning");
    });

    it("expande query si offline pero webLLM disponible", async () => {
            mockWebLLMService.canRunLocalLLM.mockResolvedValue(true);
      vi.mocked(aiManager.generateText).mockResolvedValue({ text: "webllm expansion" } as any);
      semanticSearchService.resetAvailability();
      const result = await semanticSearchService.expandQuery("computer vision");
      expect(result).toContain("webllm expansion");
    });

    it("expande query si offline y Ollama disponible", async () => {
      vi.mocked(aiManager.isOllamaAvailable).mockResolvedValue(true);
      vi.mocked(aiManager.generateText).mockResolvedValue({ text: "ollama expansion" } as any);
      semanticSearchService.resetAvailability();
      const result = await semanticSearchService.expandQuery("data mining");
      expect(result).toContain("ollama expansion");
    });
  });

  describe("checkLLMAvailability — proveedor no configurado", () => {
    it("NO expande si isConfigured false y no hay proveedores locales", async () => {
      // Ensure no local providers pollute the check
            mockWebLLMService.canRunLocalLLM.mockResolvedValue(false);
      vi.mocked(aiManager.isOllamaAvailable).mockResolvedValue(false);
      vi.mocked(aiManager.getProviderInfo).mockReturnValue({ isConfigured: false } as any);
      vi.mocked(aiManager.generateText).mockResolvedValue({ text: "expanded" } as any);
      semanticSearchService.resetAvailability();
      const result = await semanticSearchService.expandQuery("climate change");
      // isConfigured=false + no local providers → no expansion
      expect(result).toBe("climate change");
      expect(aiManager.generateText).not.toHaveBeenCalled();
    });
  });

  describe("checkLLMAvailability — edge cases", () => {
    it("uses cache after the first call", async () => {
      vi.mocked(aiManager.generateText).mockResolvedValue({ text: "second" } as any);
      const first = await semanticSearchService.expandQuery("first call");
      expect(first).toContain("first call");
      const second = await semanticSearchService.expandQuery("second call");
      expect(second).toContain("second call");
    });

    it("offline sin WEBLLM ni Ollama no expande", async () => {
            mockWebLLMService.canRunLocalLLM.mockResolvedValue(false);
      vi.mocked(aiManager.isOllamaAvailable).mockResolvedValue(false);
      vi.mocked(aiManager.generateText).mockReset();
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: false,
      });
      semanticSearchService.resetAvailability();
      const result = await semanticSearchService.expandQuery("edge case");
      expect(result).toBe("edge case");
      expect(aiManager.generateText).not.toHaveBeenCalled();
    });

    it("online without getProviderInfo as a function does not expand (no provider)", async () => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: true,
      });
      (aiManager as { getProviderInfo?: () => unknown }).getProviderInfo = undefined;
      vi.mocked(aiManager.generateText).mockResolvedValue({ text: "should not be called" } as any);
      semanticSearchService.resetAvailability();
      const result = await semanticSearchService.expandQuery("fallback test");
      // No getProviderInfo + no local providers → returns raw query
      expect(result).toBe("fallback test");
      expect(aiManager.generateText).not.toHaveBeenCalled();
    });
  });
});
