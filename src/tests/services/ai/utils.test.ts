import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  redactSecrets: (input: string) => input,
}));

describe("ai/utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sleep", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("resolves after specified time", async () => {
      const { sleep } = await import("../../../services/ai/utils");
      const promise = sleep(1000);
      vi.advanceTimersByTime(1000);
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe("fetchWithTimeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("aborts if exceeds timeout", async () => {
      const { fetchWithTimeout } = await import("../../../services/ai/utils");
      globalThis.fetch = vi.fn().mockImplementation(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            (options.signal as AbortSignal)?.addEventListener("abort", () =>
              reject(
                new DOMException("The operation was aborted", "AbortError"),
              ),
            );
          }),
      );
      const promise = fetchWithTimeout("http://test.com", {}, 100);
      vi.advanceTimersByTime(200);
      await expect(promise).rejects.toThrow();
    });

    it("throws if response is HTML error page with DOCTYPE", async () => {
      const { fetchWithTimeout } = await import("../../../services/ai/utils");
      const mockResponse = {
        ok: true,
        headers: new Map([["content-type", "text/html"]]),
        text: vi
          .fn()
          .mockResolvedValue("<!DOCTYPE html><html><body>Error</body></html>"),
        clone: vi.fn(() => ({
          text: vi
            .fn()
            .mockResolvedValue("<!DOCTYPE html><html><body>Error</body></html>"),
        })),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      await expect(
        fetchWithTimeout("http://test.com", {}, 5000),
      ).rejects.toThrow("Expected JSON but received HTML");
    });

    it("does not throw for HTML without DOCTYPE", async () => {
      const { fetchWithTimeout } = await import("../../../services/ai/utils");
      const mockResponse = {
        ok: true,
        headers: new Map([["content-type", "text/html"]]),
        text: vi.fn().mockResolvedValue("<html><body>partial</body></html>"),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      const result = await fetchWithTimeout("http://test.com", {}, 5000);
      expect(result).toBe(mockResponse);
    });

    it("returns response if content-type is JSON", async () => {
      const { fetchWithTimeout } = await import("../../../services/ai/utils");
      const mockResponse = {
        ok: true,
        headers: new Map([["content-type", "application/json"]]),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      const result = await fetchWithTimeout("http://test.com", {}, 5000);
      expect(result).toBe(mockResponse);
    });

    it("clears timeout on completion", async () => {
      const { fetchWithTimeout } = await import("../../../services/ai/utils");
      const mockResponse = { ok: true, headers: new Map() };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      await fetchWithTimeout("http://test.com", {}, 5000);
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it("handles response without content-type header", async () => {
      const { fetchWithTimeout } = await import("../../../services/ai/utils");
      const mockResponse = { ok: true, headers: new Map() };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      const result = await fetchWithTimeout("http://test.com", {}, 5000);
      expect(result).toBe(mockResponse);
    });
  });

  describe("fetchWithRetry", () => {
    it("succeeds on first attempt", async () => {
      const { fetchWithRetry } = await import("../../../services/ai/utils");
      const mockResponse = { ok: true, status: 200, headers: new Map() };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
      const result = await fetchWithRetry("http://test.com");
      expect(result.status).toBe(200);
    });

    it("retries on 5xx and eventually succeeds", async () => {
      const { fetchWithRetry } = await import("../../../services/ai/utils");
      const successResponse = { ok: true, status: 200, headers: new Map() };
      const errorResponse = {
        ok: false,
        status: 500,
        statusText: "Server Error",
        headers: new Map(),
      };
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(successResponse);
      const result = await fetchWithRetry("http://test.com", {}, 3);
      expect(result.status).toBe(200);
    });

    it("retries on 429 and eventually succeeds", async () => {
      const { fetchWithRetry } = await import("../../../services/ai/utils");
      const successResponse = { ok: true, status: 200, headers: new Map() };
      const errorResponse = {
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Map(),
      };
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(successResponse);
      const result = await fetchWithRetry("http://test.com", {}, 3);
      expect(result.status).toBe(200);
    });

    it("returns last response when all retries exhausted on 5xx", async () => {
      const { fetchWithRetry } = await import("../../../services/ai/utils");
      const errorResponse = {
        ok: false,
        status: 500,
        statusText: "Server Error",
        headers: new Map(),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(errorResponse);
      const result = await fetchWithRetry("http://test.com", {}, 0);
      expect(result.status).toBe(500);
    });

    it("throws on AbortError without retrying", async () => {
      const { fetchWithRetry } = await import("../../../services/ai/utils");
      globalThis.fetch = vi.fn().mockRejectedValue(
        Object.assign(new Error("The operation was aborted"), {
          name: "AbortError",
        }),
      );
      await expect(fetchWithRetry("http://test.com", {}, 0)).rejects.toThrow(
        "The operation was aborted",
      );
    });

    it("does not retry a POST after an upstream 5xx without idempotency", async () => {
      const { fetchWithRetry } = await import("../../../services/ai/utils");
      const errorResponse = {
        ok: false,
        status: 500,
        statusText: "Server Error",
        headers: new Map(),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(errorResponse);

      const result = await fetchWithRetry(
        "http://test.com",
        { method: "POST", body: "{}" },
        3,
      );

      expect(result.status).toBe(500);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("retries a POST only when an idempotency key is supplied", async () => {
      const { fetchWithRetry } = await import("../../../services/ai/utils");
      const errorResponse = {
        ok: false,
        status: 500,
        statusText: "Server Error",
        headers: new Map(),
      };
      const successResponse = { ok: true, status: 200, headers: new Map() };
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(successResponse);

      const result = await fetchWithRetry(
        "http://test.com",
        {
          method: "POST",
          body: "{}",
          headers: { "Idempotency-Key": "request-1" },
        },
        3,
      );

      expect(result.status).toBe(200);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("retries on generic error then succeeds", async () => {
      const { fetchWithRetry } = await import("../../../services/ai/utils");
      const successResponse = { ok: true, status: 200, headers: new Map() };
      globalThis.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(successResponse);
      const result = await fetchWithRetry("http://test.com", {}, 3);
      expect(result.status).toBe(200);
    });

    it("throws max retries exceeded on persistent generic errors", async () => {
      const { fetchWithRetry } = await import("../../../services/ai/utils");
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("Persistent error"));
      await expect(fetchWithRetry("http://test.com", {}, 0)).rejects.toThrow(
        "Persistent error",
      );
    });
  });

  describe("sanitizeErrorMessage", () => {
    it("redacts OpenAI keys (sk-)", async () => {
      const { sanitizeErrorMessage } =
        await import("../../../services/ai/utils");
      expect(
        sanitizeErrorMessage("Error with key sk-proj-abc123def456"),
      ).toContain("[REDACTED_API_KEY]");
    });

    it("redacts Gemini keys (AIza)", async () => {
      const { sanitizeErrorMessage } =
        await import("../../../services/ai/utils");
      expect(
        sanitizeErrorMessage(
          "Error with key AIzaSyBV_7EbyWgLVFQzY6C4VVty_SCQh7Xj2M",
        ),
      ).toContain("[REDACTED_GEMINI_KEY]");
    });

    it("redacts Anthropic keys via generic sk- pattern", async () => {
      const { sanitizeErrorMessage } =
        await import("../../../services/ai/utils");
      const result = sanitizeErrorMessage(
        "Error with key sk-ant-test123key456",
      );
      expect(result).not.toContain("sk-ant-");
      expect(result).toContain("[REDACTED_API_KEY]");
    });

    it("redacts Groq keys (gsk_)", async () => {
      const { sanitizeErrorMessage } =
        await import("../../../services/ai/utils");
      expect(sanitizeErrorMessage("Error with key gsk_abc123def456")).toContain(
        "[REDACTED_GROQ_KEY]",
      );
    });

    it("redacts OpenRouter keys via generic sk- pattern", async () => {
      const { sanitizeErrorMessage } =
        await import("../../../services/ai/utils");
      const result = sanitizeErrorMessage("Error with key sk-or-v1-abc123");
      expect(result).not.toContain("sk-or-");
      expect(result).toContain("[REDACTED_API_KEY]");
    });

    it("returns original message if no keys", async () => {
      const { sanitizeErrorMessage } =
        await import("../../../services/ai/utils");
      expect(sanitizeErrorMessage("Generic error without keys")).toBe(
        "Generic error without keys",
      );
    });

    it("redacts multiple key types in one message", async () => {
      const { sanitizeErrorMessage } =
        await import("../../../services/ai/utils");
      const result = sanitizeErrorMessage(
        "sk-proj-key1 and AIzaSyKey2 and gsk_key3",
      );
      expect(result).toContain("[REDACTED_API_KEY]");
      expect(result).toContain("[REDACTED_GEMINI_KEY]");
      expect(result).toContain("[REDACTED_GROQ_KEY]");
    });
  });

  describe("detectProvider", () => {
    it("detects Gemini (AIza)", async () => {
      const { detectProvider } = await import("../../../services/ai/utils");
      const result = detectProvider("AIzaSyTest123");
      expect(result.provider).toBe("gemini");
      expect(result.isConfigured).toBe(true);
    });

    it("detects Anthropic (sk-ant-)", async () => {
      const { detectProvider } = await import("../../../services/ai/utils");
      const result = detectProvider("sk-ant-test123");
      expect(result.provider).toBe("anthropic");
      expect(result.isConfigured).toBe(true);
    });

    it("detects Groq (gsk_)", async () => {
      const { detectProvider } = await import("../../../services/ai/utils");
      const result = detectProvider("gsk_test123");
      expect(result.provider).toBe("groq");
      expect(result.isConfigured).toBe(true);
    });

    it("detects OpenAI (sk-proj-)", async () => {
      const { detectProvider } = await import("../../../services/ai/utils");
      const result = detectProvider("sk-proj-abc123");
      expect(result.provider).toBe("openai");
      expect(result.isConfigured).toBe(true);
    });

    it("detects OpenAI (sk- simple)", async () => {
      const { detectProvider } = await import("../../../services/ai/utils");
      const result = detectProvider("sk-abc123def456");
      expect(result.provider).toBe("openai");
    });

    it("detects OpenRouter (sk-or-) before generic OpenAI sk- prefix", async () => {
      const { detectProvider } = await import("../../../services/ai/utils");
      const result = detectProvider("sk-or-v1-test123");
      expect(result.provider).toBe("openai");
      expect(result.name).toBe("OpenRouter");
      expect(result.model).toBe("openrouter/auto");
    });

    it("returns unknown for empty key", async () => {
      const { detectProvider } = await import("../../../services/ai/utils");
      const result = detectProvider("");
      expect(result.provider).toBe("unknown");
      expect(result.isConfigured).toBe(false);
    });

    it("returns unknown for unrecognized prefix", async () => {
      const { detectProvider } = await import("../../../services/ai/utils");
      const result = detectProvider("zzz-unknown-key-12345");
      expect(result.provider).toBe("unknown");
      expect(result.isConfigured).toBe(false);
    });
  });

  describe("readSSEStream", () => {
    function makeSSEResponse(chunks: string[]): Response {
      let i = 0;
      const reader = {
        read: vi.fn().mockImplementation(() => {
          if (i < chunks.length) {
            return Promise.resolve({
              done: false,
              value: new TextEncoder().encode(chunks[i++]),
            });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
      };
      return { body: { getReader: () => reader }, ok: true } as any;
    }

    it("parses SSE data lines", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      const response = makeSSEResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        'data: {"choices":[{"delta":{"content":" World"}}]}\n',
      ]);
      const result = await readSSEStream(response, undefined, "sse");
      expect(result).toBe("Hello World");
    });

    it("calls onChunk callback for each content chunk", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      const response = makeSSEResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      ]);
      const onChunk = vi.fn();
      await readSSEStream(response, onChunk, "sse");
      expect(onChunk).toHaveBeenCalledWith("Hello");
    });

    it("skips [DONE] marker", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      const response = makeSSEResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        "data: [DONE]\n",
      ]);
      const result = await readSSEStream(response, undefined, "sse");
      expect(result).toBe("Hello");
    });

    it("skips unparseable SSE lines", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      const response = makeSSEResponse([
        "data: not-json\n",
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n',
      ]);
      const result = await readSSEStream(response, undefined, "sse");
      expect(result).toBe("ok");
    });

    it("handles NDJSON parse mode", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      const response = makeSSEResponse([
        '{"response":"Hello"}\n',
        '{"response":" World"}\n',
      ]);
      const result = await readSSEStream(response, undefined, "ndjson");
      expect(result).toBe("Hello World");
    });

    it("handles NDJSON with message.content", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      const response = makeSSEResponse(['{"message":{"content":"Hello"}}\n']);
      const result = await readSSEStream(response, undefined, "ndjson");
      expect(result).toBe("Hello");
    });

    it("notifies completion once at the Ollama done frame", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      const onComplete = vi.fn();
      const response = makeSSEResponse([
        '{"response":"ok"}\n',
        '{"done":true}\n',
      ]);
      await expect(
        readSSEStream(response, undefined, "ndjson", onComplete),
      ).resolves.toBe("ok");
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("stops at Ollama done frame without waiting for transport EOF", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      let reads = 0;
      const reader = {
        read: vi.fn().mockImplementation(() => {
          reads += 1;
          if (reads === 1) {
            return Promise.resolve({
              done: false,
              value: new TextEncoder().encode(
                '{"response":"Hello"}\n{"done":true}\n',
              ),
            });
          }
          throw new Error("transport EOF was requested after the done frame");
        }),
      };
      const response = { body: { getReader: () => reader }, ok: true } as any;

      await expect(readSSEStream(response, undefined, "ndjson")).resolves.toBe(
        "Hello",
      );
      expect(reads).toBe(1);
    });

    it("skips empty NDJSON lines", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      const response = makeSSEResponse(["\n", '{"response":"ok"}\n']);
      const result = await readSSEStream(response, undefined, "ndjson");
      expect(result).toBe("ok");
    });

    it("skips unparseable NDJSON lines", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      const response = makeSSEResponse(["not-json\n", '{"response":"ok"}\n']);
      const result = await readSSEStream(response, undefined, "ndjson");
      expect(result).toBe("ok");
    });

    it("processes remaining buffer after stream ends", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      let i = 0;
      const reader = {
        read: vi.fn().mockImplementation(() => {
          if (i === 0) {
            i++;
            return Promise.resolve({
              done: false,
              value: new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"partial"}}]}\n',
              ),
            });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
      };
      const response = { body: { getReader: () => reader }, ok: true } as any;
      const result = await readSSEStream(response, undefined, "sse");
      expect(result).toBe("partial");
    });

    it("handles content via choices[].text fallback", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      const response = makeSSEResponse([
        'data: {"choices":[{"text":"Hello"}]}\n',
      ]);
      const result = await readSSEStream(response, undefined, "sse");
      expect(result).toBe("Hello");
    });

    it("handles NDJSON remaining buffer", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      let i = 0;
      const reader = {
        read: vi.fn().mockImplementation(() => {
          if (i === 0) {
            i++;
            return Promise.resolve({
              done: false,
              value: new TextEncoder().encode('{"response":"tail"}\nremaining'),
            });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
      };
      const response = { body: { getReader: () => reader }, ok: true } as any;
      const result = await readSSEStream(response, undefined, "ndjson");
      expect(result).toBe("tail");
    });

    it("throws if response body is not readable", async () => {
      const { readSSEStream } = await import("../../../services/ai/utils");
      const response = { body: null, ok: true } as any;
      await expect(readSSEStream(response as any, undefined)).rejects.toThrow(
        "Response body is not readable",
      );
    });
  });

  describe("getUserFriendlyErrorMessage", () => {
    it("returns invalid key message for 401", async () => {
      const { getUserFriendlyErrorMessage } =
        await import("../../../services/ai/utils");
      expect(
        getUserFriendlyErrorMessage(
          "HTTP 401 Unauthorized",
          "openai",
          "gpt-4o-mini",
        ),
      ).toContain("Invalid API key");
    });

    it("returns rate limit message for 429", async () => {
      const { getUserFriendlyErrorMessage } =
        await import("../../../services/ai/utils");
      expect(
        getUserFriendlyErrorMessage(
          "HTTP 429 Too Many Requests",
          "openai",
          "gpt-4o-mini",
        ),
      ).toContain("Rate limit exceeded");
    });

    it("returns model not found for 404", async () => {
      const { getUserFriendlyErrorMessage } =
        await import("../../../services/ai/utils");
      expect(
        getUserFriendlyErrorMessage(
          "HTTP 404 Not Found",
          "openai",
          "gpt-4o-mini",
        ),
      ).toContain("not found for provider");
    });

    it("returns bad request for 400", async () => {
      const { getUserFriendlyErrorMessage } =
        await import("../../../services/ai/utils");
      expect(
        getUserFriendlyErrorMessage(
          "HTTP 400 Bad Request",
          "openai",
          "gpt-4o-mini",
        ),
      ).toContain("Request error (400)");
    });

    it("returns network error for fetch", async () => {
      const { getUserFriendlyErrorMessage } =
        await import("../../../services/ai/utils");
      expect(
        getUserFriendlyErrorMessage("fetch failed", "openai", "gpt-4o-mini"),
      ).toContain("Network error");
    });

    it("returns original message for unknown error", async () => {
      const { getUserFriendlyErrorMessage } =
        await import("../../../services/ai/utils");
      expect(
        getUserFriendlyErrorMessage(
          "Unknown error 500",
          "openai",
          "gpt-4o-mini",
        ),
      ).toBe("Unknown error 500");
    });

    it("redacts OpenAI API keys from the original message", async () => {
      const { getUserFriendlyErrorMessage } =
        await import("../../../services/ai/utils");
      const result = getUserFriendlyErrorMessage(
        "Upstream 500 with sk-proj-abc123def456 secret",
        "openai",
        "gpt-4o-mini",
      );
      expect(result).not.toContain("sk-proj-abc123def456");
      expect(result).toContain("[REDACTED_API_KEY]");
    });

    it("redacts Gemini keys from the friendly message", async () => {
      const { getUserFriendlyErrorMessage } =
        await import("../../../services/ai/utils");
      const geminiKey = "AIzaSyBV_7EbyWgLVFQzY6C4VVty_SCQh7Xj2M";
      const result = getUserFriendlyErrorMessage(
        `${geminiKey} failed to respond`,
        "gemini",
        "gemini-3-flash-preview",
      );
      expect(result).not.toContain(geminiKey);
      expect(result).toContain("[REDACTED_GEMINI_KEY]");
    });

    it("redacts Groq keys from the friendly message", async () => {
      const { getUserFriendlyErrorMessage } =
        await import("../../../services/ai/utils");
      // With no mapped codes (401/429/404/400/fetch) → goes through
      // sanitizeErrorMessage and the key must stay redacted.
      const result = getUserFriendlyErrorMessage(
        "gsk_abc123def456 triggered an upstream error",
        "groq",
        "mixtral-8x7b",
      );
      expect(result).not.toContain("gsk_abc123def456");
      expect(result).toContain("[REDACTED_GROQ_KEY]");
    });
  });
});
