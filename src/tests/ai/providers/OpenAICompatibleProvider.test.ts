import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("../../../services/ai/utils", () => ({
  fetchWithRetry: vi.fn(),
  fetchWithTimeout: vi.fn(),
  readSSEStream: vi.fn(),
  readBoundedResponseJson: async (response: Response) => response.json(),
  cancelResponseBody: vi.fn(),
  buildSafeUserContent: (content: string) => content,
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../utils/networkFirewall", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    firewalledFetch: vi.fn(),
  };
});

const mockFetchWithRetry = vi.mocked(
  (await import("../../../services/ai/utils")).fetchWithRetry,
);
const mockFetchWithTimeout = vi.mocked(
  (await import("../../../services/ai/utils")).fetchWithTimeout,
);
const mockReadSSEStream = vi.mocked(
  (await import("../../../services/ai/utils")).readSSEStream,
);
const mockFirewalledFetch = vi.mocked(
  (await import("../../../utils/networkFirewall")).firewalledFetch,
);

import { OpenAICompatibleProvider } from "../../../services/ai/providers/OpenAICompatibleProvider";

function createMockResponse(overrides: Partial<Response> = {}): Response {
  const body =
    overrides.body ??
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            'data: {"delta":{"text":"Hello "}}\n\ndata: {"delta":{"text":"world"}}\n\ndata: [DONE]\n\n',
          ),
        );
        controller.close();
      },
    });
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
    body,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    ...overrides,
  } as Response;
}

describe("OpenAICompatibleProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    test("should create instance with base config", () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-test123",
        provider: "openai",
        model: "gpt-4",
      });
      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    });

    test("should create instance with custom base URL", () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-test123",
        provider: "custom",
        model: "my-model",
        baseUrl: "https://my-custom-api.com/v1",
      });
      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    });
  });

  describe("generateText - OpenAI compatible", () => {
    test("should call OpenAI-compatible endpoint", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-test123",
        provider: "openai",
        model: "gpt-4o-mini",
      });
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Hello from OpenAI" } }],
        }),
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      const result = await provider.generateText("Hello", "System message");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        "https://api.openai.com/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer sk-test123",
          },
          body: expect.stringContaining("gpt-4o-mini"),
        }),
      );
      expect(result).toEqual({ text: "Hello from OpenAI", provider: "openai" });
    });

    test("should include system prompt in messages", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-test123",
        provider: "openai",
        model: "gpt-4o-mini",
      });
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "OK" } }] }),
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      await provider.generateText("Hello", "Be concise");

      const body = JSON.parse(
        (mockFetchWithRetry.mock.calls[0]![1]! as RequestInit).body as string,
      );
      expect(body.messages).toEqual([
        { role: "system", content: "Be concise" },
        { role: "user", content: "Hello" },
      ]);
    });

    test("should use Groq endpoint for Groq provider", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "gsk_test123",
        provider: "groq",
        model: "llama-3.3-70b-versatile",
      });
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "OK" } }] }),
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      await provider.generateText("Hello");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        "https://api.groq.com/openai/v1/chat/completions",
        expect.anything(),
      );
    });

    test("should use OpenRouter endpoint when key starts with sk-or-", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-or-v1-test123",
        provider: "openai",
        model: "openrouter/auto",
      });
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "OK" } }] }),
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      await provider.generateText("Hello");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/chat/completions",
        expect.anything(),
      );
    });

    test("should use custom base URL for custom provider", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "custom-key",
        provider: "custom",
        model: "my-model",
        baseUrl: "https://my-api.example.com/v1",
      });
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "OK" } }] }),
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      await provider.generateText("Hello");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        "https://my-api.example.com/v1/chat/completions",
        expect.anything(),
      );
    });

    test("should throw on API error", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-test123",
        provider: "openai",
        model: "gpt-4o-mini",
      });
      const mockResponse = createMockResponse({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      await expect(provider.generateText("Hello")).rejects.toThrow(
        "openai API error 401",
      );
    });

    test("should handle empty response content", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-test123",
        provider: "openai",
        model: "gpt-4o-mini",
      });
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({ choices: [{ message: { content: null } }] }),
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      const result = await provider.generateText("Hello");
      expect(result.text).toBe("");
    });
  });

  describe("generateText - Anthropic", () => {
    test("should call Anthropic endpoint for anthropic provider", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-ant-test123",
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
      });
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({
          content: [{ text: "Hello from Claude" }],
        }),
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      const result = await provider.generateText("Hello", "System");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/messages",
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-key": "sk-ant-test123",
            "anthropic-version": "2023-06-01",
          }),
        }),
      );
      expect(result).toEqual({
        text: "Hello from Claude",
        provider: "anthropic",
      });
    });

    test("should include system for Anthropic", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-ant-test123",
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
      });
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({ content: [{ text: "OK" }] }),
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      await provider.generateText("Hello", "Be concise");

      const body = JSON.parse(
        (mockFetchWithRetry.mock.calls[0]![1]! as RequestInit).body as string,
      );
      expect(body.system).toBe("Be concise");
    });

    test("should throw on Anthropic API error", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-ant-test123",
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
      });
      const mockResponse = createMockResponse({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      await expect(provider.generateText("Hello")).rejects.toThrow(
        "Anthropic API error 403",
      );
    });
  });

  describe("streamGenerateText - OpenAI compatible", () => {
    test("should use firewalledFetch for streaming", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-test123",
        provider: "openai",
        model: "gpt-4o-mini",
      });
      const mockResponse = createMockResponse({ ok: true });
      mockFirewalledFetch.mockResolvedValue(mockResponse);
      mockReadSSEStream.mockResolvedValue("streamed content");

      const result = await provider.streamGenerateText("Hello");

      expect(mockFirewalledFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/chat/completions",
        expect.objectContaining({
          body: expect.stringContaining('"stream":true'),
        }),
        "ai-provider",
      );
      expect(result).toEqual({
        text: "streamed content",
        provider: "openai",
      });
    });

    test("should call onChunk for each chunk", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-test123",
        provider: "openai",
        model: "gpt-4o-mini",
      });
      const mockResponse = createMockResponse({ ok: true });
      mockFirewalledFetch.mockResolvedValue(mockResponse);
      mockReadSSEStream.mockImplementation(
        async (_response: Response, onChunk?: (chunk: string) => void) => {
          onChunk?.("Hello ");
          onChunk?.("world");
          return "Hello world";
        },
      );

      const onChunk = vi.fn();
      const result = await provider.streamGenerateText(
        "Hello",
        undefined,
        onChunk,
      );

      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, "Hello ");
      expect(onChunk).toHaveBeenNthCalledWith(2, "world");
      expect(result.text).toBe("Hello world");
    });

    test("should throw on stream API error", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-test123",
        provider: "openai",
        model: "gpt-4o-mini",
      });
      const mockResponse = createMockResponse({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });
      mockFirewalledFetch.mockResolvedValue(mockResponse);

      await expect(provider.streamGenerateText("Hello")).rejects.toThrow(
        "openai API error 429",
      );
    });
  });

  describe("streamGenerateText - Anthropic", () => {
    test("should stream from Anthropic with SSE parsing", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-ant-test123",
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
      });
      const mockResponse = createMockResponse({ ok: true });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      const result = await provider.streamGenerateText("Hello");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/messages",
        expect.objectContaining({
          body: expect.stringContaining('"stream":true'),
        }),
      );
      expect(result.provider).toBe("anthropic");
    });
  });

  describe("fetchAvailableModels", () => {
    test("should return hardcoded list for Anthropic", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-ant-test123",
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
      });

      const models = await provider.fetchAvailableModels();
      expect(models).toContain("claude-3-5-sonnet-latest");
      expect(models).toContain("claude-3-haiku-20240307");
    });

    test("should fetch models for OpenAI provider", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-test123",
        provider: "openai",
        model: "gpt-4o-mini",
      });
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({
          data: [
            { id: "gpt-4" },
            { id: "gpt-4o-mini" },
            { id: "gpt-3.5-turbo" },
          ],
        }),
      });
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      const models = await provider.fetchAvailableModels();
      expect(models).toEqual(["gpt-3.5-turbo", "gpt-4", "gpt-4o-mini"]);
    });

    test("should fetch models via OpenRouter for sk-or- key", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-or-v1-test123",
        provider: "openai",
        model: "openrouter/auto",
      });
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({
          data: [{ id: "openai/gpt-4" }, { id: "anthropic/claude-3" }],
        }),
      });
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      const models = await provider.fetchAvailableModels();
      expect(models).toEqual(["anthropic/claude-3", "openai/gpt-4"]);
    });

    test("should use custom base URL for models endpoint", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "custom-key",
        provider: "custom",
        model: "my-model",
        baseUrl: "https://my-api.example.com/v1",
      });
      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({ data: [] }),
      });
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      await provider.fetchAvailableModels();
      expect(mockFetchWithTimeout).toHaveBeenCalledWith(
        "https://my-api.example.com/v1/models",
        expect.anything(),
        5000,
      );
    });

    test("should return empty array on fetch error", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-test123",
        provider: "openai",
        model: "gpt-4o-mini",
      });
      mockFetchWithTimeout.mockRejectedValue(new Error("Network error"));

      const models = await provider.fetchAvailableModels();
      expect(models).toEqual([]);
    });
  });

  describe("updateModel", () => {
    test("should update the model", () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-test123",
        provider: "openai",
        model: "gpt-4o-mini",
      });
      provider.updateModel("gpt-4");
      const privateProvider = provider as unknown as { model: string };
      expect(privateProvider.model).toBe("gpt-4");
    });
  });

  describe("setApiKey / clearApiKey (S9 - higiene de memoria)", () => {
    test("clearApiKey() descarta la key y las llamadas cloud fallan cerrado", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-test123",
        provider: "openai",
        model: "gpt-4o-mini",
      });
      provider.clearApiKey();

      await expect(provider.generateText("Hello")).rejects.toThrow(
        "API key unavailable",
      );
      await expect(provider.streamGenerateText("Hello")).rejects.toThrow(
        "API key unavailable",
      );
      // No request is sent with an empty key.
      expect(mockFetchWithRetry).not.toHaveBeenCalled();
      expect(mockFirewalledFetch).not.toHaveBeenCalled();

      // fetchAvailableModels also omits an empty Authorization header.
      const models = await provider.fetchAvailableModels();
      expect(models).toEqual([]);
      expect(mockFetchWithTimeout).not.toHaveBeenCalled();
    });

    test("setApiKey() rehidrata la key en la instancia existente", async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: "sk-old-key",
        provider: "openai",
        model: "gpt-4o-mini",
      });
      provider.setApiKey("sk-new-key");

      const mockResponse = createMockResponse({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "OK" } }] }),
      });
      mockFetchWithRetry.mockResolvedValue(mockResponse);

      await provider.generateText("Hello");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        "https://api.openai.com/v1/chat/completions",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer sk-new-key",
          }),
        }),
      );
    });
  });
});
