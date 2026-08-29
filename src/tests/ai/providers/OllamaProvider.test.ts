import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../services/ai/utils", () => ({
  fetchWithTimeout: vi.fn(),
  fetchWithRetry: vi.fn(),
  readSSEStream: vi.fn(),
  readBoundedResponseJson: async (response: Response) => response.json(),
  cancelResponseBody: vi.fn(),
  buildSafeUserContent: (content: string) => content,
}));

const mockFetchWithTimeout = vi.mocked(
  (await import("../../../services/ai/utils")).fetchWithTimeout,
);
const mockFetchWithRetry = vi.mocked(
  (await import("../../../services/ai/utils")).fetchWithRetry,
);
const mockReadSSEStream = vi.mocked(
  (await import("../../../services/ai/utils")).readSSEStream,
);

import { OllamaProvider } from "../../../services/ai/providers/OllamaProvider";

function createMockResponse(overrides: Partial<Response> = {}): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "",
    headers: new Headers(),
    redirected: false,
    statusText: "OK",
    type: "basic" as ResponseType,
    url: "",
    clone: () => createMockResponse(overrides),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    ...overrides,
  } as Response;
}

describe("OllamaProvider", () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OllamaProvider({
      url: "http://localhost:11434/api/generate",
      model: "llama3.2",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    test("should create instance with default URL", () => {
      expect(provider).toBeInstanceOf(OllamaProvider);
      const config = provider.getConfig();
      expect(config.url).toBe("http://localhost:11434/api/generate");
      expect(config.model).toBe("llama3.2");
    });
  });

  describe("isAvailable", () => {
    test("should return true when /api/tags responds ok", async () => {
      mockFetchWithTimeout.mockResolvedValue(createMockResponse({ ok: true }));
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });

    test("should return false when /api/tags fails", async () => {
      mockFetchWithTimeout.mockResolvedValue(
        createMockResponse({ ok: false, status: 500 }),
      );
      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });

    test("should return false on network error", async () => {
      mockFetchWithTimeout.mockRejectedValue(new Error("Connection refused"));
      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });

    test("should cache availability result within TTL", async () => {
      mockFetchWithTimeout.mockResolvedValue(createMockResponse({ ok: true }));
      await provider.isAvailable();
      await provider.isAvailable();
      expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
    });

    test("should refetch after cache TTL expires", async () => {
      vi.useFakeTimers();
      const providerWithTimers = new OllamaProvider({
        url: "http://localhost:11434/api/generate",
        model: "llama3.2",
      });

      mockFetchWithTimeout
        .mockResolvedValueOnce(createMockResponse({ ok: true }))
        .mockResolvedValueOnce(createMockResponse({ ok: false }));

      await providerWithTimers.isAvailable();

      vi.advanceTimersByTime(61_000);

      const second = await providerWithTimers.isAvailable();
      expect(second).toBe(false);
      expect(mockFetchWithTimeout).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    test("should derive tags URL from generate URL", async () => {
      const customProvider = new OllamaProvider({
        url: "http://192.168.1.100:11434/api/generate",
        model: "mistral",
      });
      mockFetchWithTimeout.mockResolvedValue(createMockResponse({ ok: true }));

      await customProvider.isAvailable();

      expect(mockFetchWithTimeout).toHaveBeenCalledWith(
        "http://192.168.1.100:11434/api/tags",
        { method: "GET" },
        3000,
      );
    });
  });

  describe("generateText", () => {
    test("should call /api/generate with correct body", async () => {
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({ response: "Hello from Ollama" }),
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      const result = await provider.generateText("Hello");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining("llama3.2"),
        }),
      );
      expect(result).toEqual({ text: "Hello from Ollama", provider: "ollama" });
    });

    test("should prepend system prompt to user prompt", async () => {
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({ response: "OK" }),
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      await provider.generateText("Hello", "Be concise");

      const body = JSON.parse(
        (mockFetchWithRetry.mock.calls[0]![1]! as RequestInit).body as string,
      );
      expect(body.prompt).toBe("Be concise\n\nHello");
      expect(body.stream).toBe(false);
    });

    test("should not include newline when no system prompt", async () => {
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({ response: "OK" }),
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      await provider.generateText("Hello");

      const body = JSON.parse(
        (mockFetchWithRetry.mock.calls[0]![1]! as RequestInit).body as string,
      );
      expect(body.prompt).toBe("Hello");
    });

    test("should throw on API error", async () => {
      const mockResponse = createMockResponse({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      await expect(provider.generateText("Hello")).rejects.toThrow(
        "Ollama error 404",
      );
    });
  });

  describe("streamGenerateText", () => {
    test("should call /api/generate with stream:true", async () => {
      const mockResponse = createMockResponse({ ok: true });
      mockFetchWithRetry.mockResolvedValue(mockResponse);
      mockReadSSEStream.mockResolvedValue("streamed response");

      const result = await provider.streamGenerateText("Hello");

      const body = JSON.parse(
        (mockFetchWithRetry.mock.calls[0]![1]! as RequestInit).body as string,
      );
      expect(body.stream).toBe(true);
      expect(result).toEqual({
        text: "streamed response",
        provider: "ollama",
      });
    });

    test("should call readSSEStream with ndjson parse mode", async () => {
      const mockResponse = createMockResponse({ ok: true });
      mockFetchWithRetry.mockResolvedValue(mockResponse);
      mockReadSSEStream.mockResolvedValue("");

      await provider.streamGenerateText("Hello");

      expect(mockReadSSEStream).toHaveBeenCalledWith(
        mockResponse,
        undefined,
        "ndjson",
        undefined,
      );
    });

    test("should call onChunk for each NDJSON chunk", async () => {
      const mockResponse = createMockResponse({ ok: true });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      mockReadSSEStream.mockImplementation(
        async (_response: Response, onChunk?: (chunk: string) => void) => {
          onChunk?.("Hello ");
          onChunk?.("world");
          return "Hello world";
        },
      );

      const onChunk = vi.fn();
      await provider.streamGenerateText("Hello", undefined, onChunk);

      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, "Hello ");
      expect(onChunk).toHaveBeenNthCalledWith(2, "world");
    });

    test("should throw on stream API error", async () => {
      const mockResponse = createMockResponse({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      await expect(provider.streamGenerateText("Hello")).rejects.toThrow(
        "Ollama error 503",
      );
    });
  });

  describe("updateConfig", () => {
    test("should update URL and model", () => {
      provider.updateConfig({
        url: "http://192.168.1.100:11434/api/generate",
        model: "mistral",
      });
      const config = provider.getConfig();
      expect(config.url).toBe("http://192.168.1.100:11434/api/generate");
      expect(config.model).toBe("mistral");
    });

    test("should reset availability cache on config update", async () => {
      mockFetchWithTimeout.mockResolvedValue(createMockResponse({ ok: true }));
      await provider.isAvailable();
      expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);

      provider.updateConfig({ model: "new-model" });

      mockFetchWithTimeout.mockResolvedValue(createMockResponse({ ok: false }));
      await provider.isAvailable();
      expect(mockFetchWithTimeout).toHaveBeenCalledTimes(2);
    });

    test("should partially update config", () => {
      provider.updateConfig({ model: "codellama" });
      const config = provider.getConfig();
      expect(config.url).toBe("http://localhost:11434/api/generate");
      expect(config.model).toBe("codellama");
    });
  });

  describe("getConfig", () => {
    test("should return a copy of the config", () => {
      const config = provider.getConfig();
      config.url = "changed";
      expect(provider.getConfig().url).toBe(
        "http://localhost:11434/api/generate",
      );
    });
  });
});
