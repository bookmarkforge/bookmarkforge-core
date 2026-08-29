import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock @google/genai — should NEVER be called since SDK was removed.
const mockGoogleGenAI = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: mockGoogleGenAI.mockImplementation(() => ({
    models: { generateContent: vi.fn(), generateContentStream: vi.fn() },
  })),
}));

vi.mock("../../../services/ai/aiSession", () => ({
  fetchWithAiSession: async (
    request: (options: RequestInit) => Promise<Response>,
    options: RequestInit,
  ) => request(options),
}));

vi.mock("../../../services/ai/utils", () => ({
  fetchWithTimeout: vi.fn(),
  readSSEStream: vi.fn(),
  readBoundedResponseJson: async (response: Response) => response.json(),
  readBoundedResponseText: async (response: Response) => response.text(),
  sanitizeErrorMessage: (msg: string) => msg,
  buildSafeUserContent: (content: string) =>
    `<<<USER_DATA_START>>>${content}<<<USER_DATA_END>>>`,
}));

const mockFetchWithTimeout = vi.mocked(
  (await import("../../../services/ai/utils")).fetchWithTimeout,
);
const mockReadSSEStream = vi.mocked(
  (await import("../../../services/ai/utils")).readSSEStream,
);

import { GeminiProvider } from "../../../services/ai/providers/GeminiProvider";

describe("GeminiProvider", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    test("should create instance with API key", () => {
      provider = new GeminiProvider({ apiKey: "AIzaSyTest123456789" });
      expect(provider).toBeInstanceOf(GeminiProvider);
    });

    test("should create instance with null API key", () => {
      provider = new GeminiProvider({ apiKey: null });
      expect(provider).toBeInstanceOf(GeminiProvider);
    });
  });

  describe("generateText — always routes through backend (SDK removed)", () => {
    // Security: the SDK was removed in audit fix #10. All requests MUST go
    // through callBackend which uses firewalledFetch with SSRF protection.
    // Even with a valid API key, the backend proxies the request.

    test("should call backend endpoint even with valid API key", async () => {
      provider = new GeminiProvider({ apiKey: "AIzaSyTest123456789" });
      const mockResponse = {
        ok: true,
        json: async () => ({ text: "Backend reply" }),
      };
      mockFetchWithTimeout.mockResolvedValue(mockResponse as never);

      const result = await provider.generateText("Hello", "System");

      expect(mockFetchWithTimeout).toHaveBeenCalledWith(
        "/api/services/ai/generate",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Hello"),
        }),
      );
      expect(mockGoogleGenAI).not.toHaveBeenCalled();
      expect(result).toEqual({ text: "Backend reply", provider: "gemini" });
    });

    test("should wrap prompt with buildSafeUserContent in non-streaming body", async () => {
      provider = new GeminiProvider({ apiKey: "AIzaSyTest123456789" });
      mockFetchWithTimeout.mockResolvedValue({
        ok: true,
        json: async () => ({ text: "ok" }),
      } as never);

      await provider.generateText("Hello");

      const callBody = JSON.parse(
        (mockFetchWithTimeout.mock.calls[0]?.[1] as Record<string, unknown>)?.body as string,
      );
      expect(callBody.prompt).toBe(
        "<<<USER_DATA_START>>>Hello<<<USER_DATA_END>>>",
      );
    });

    test("should never call GoogleGenAI SDK", async () => {
      provider = new GeminiProvider({ apiKey: "AIzaSyTest123456789" });
      mockFetchWithTimeout.mockResolvedValue({
        ok: true,
        json: async () => ({ text: "ok" }),
      } as never);

      await provider.generateText("Hello");
      expect(mockGoogleGenAI).not.toHaveBeenCalled();
    });

    test("should call backend when no API key", async () => {
      provider = new GeminiProvider({ apiKey: null });
      const mockResponse = {
        ok: true,
        json: async () => ({ text: "Backend reply" }),
      };
      mockFetchWithTimeout.mockResolvedValue(mockResponse as never);

      const result = await provider.generateText("Hello", "System");

      expect(mockFetchWithTimeout).toHaveBeenCalledWith(
        "/api/services/ai/generate",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Hello"),
        }),
      );
      expect(result).toEqual({ text: "Backend reply", provider: "gemini" });
    });

    test("should pass model from options to backend", async () => {
      provider = new GeminiProvider({ apiKey: "AIzaSyTest123456789" });
      mockFetchWithTimeout.mockResolvedValue({
        ok: true,
        json: async () => ({ text: "ok" }),
      } as never);

      await provider.generateText("Hello", undefined, {
        model: "gemini-2.0-flash",
      });

      expect(mockFetchWithTimeout).toHaveBeenCalledWith(
        "/api/services/ai/generate",
        expect.objectContaining({
          body: expect.stringContaining("gemini-2.0-flash"),
        }),
      );
    });

    test("should pass responseMimeType and responseSchema to backend", async () => {
      provider = new GeminiProvider({ apiKey: "AIzaSyTest123456789" });
      mockFetchWithTimeout.mockResolvedValue({
        ok: true,
        json: async () => ({ text: "ok" }),
      } as never);

      const schema = { type: "object", properties: { name: { type: "string" } } };
      await provider.generateText("Hello", undefined, {
        responseMimeType: "application/json",
        responseSchema: schema,
      });

      const callBody = JSON.parse(
        (mockFetchWithTimeout.mock.calls[0]?.[1] as Record<string, unknown>)?.body as string,
      );
      expect(callBody.responseMimeType).toBe("application/json");
      expect(callBody.responseSchema).toEqual(schema);
    });

    test("should pass tools to backend", async () => {
      provider = new GeminiProvider({ apiKey: "AIzaSyTest123456789" });
      mockFetchWithTimeout.mockResolvedValue({
        ok: true,
        json: async () => ({ text: "ok" }),
      } as never);

      const tools = [{ functionDeclarations: [{ name: "test" }] }];
      await provider.generateText("Hello", undefined, { tools });

      const callBody = JSON.parse(
        (mockFetchWithTimeout.mock.calls[0]?.[1] as Record<string, unknown>)?.body as string,
      );
      expect(callBody.tools).toEqual(tools);
    });

    test("should return grounding metadata from backend response", async () => {
      provider = new GeminiProvider({ apiKey: null });
      mockFetchWithTimeout.mockResolvedValue({
        ok: true,
        json: async () => ({
          text: "Cited result",
          groundingMetadata: {
            sources: [{ uri: "https://example.com", title: "Example" }],
          },
        }),
      } as never);

      const result = await provider.generateText("Query");
      expect(result.groundingMetadata).toEqual({
        sources: [{ uri: "https://example.com", title: "Example" }],
      });
    });

    test("should throw on backend HTTP error", async () => {
      provider = new GeminiProvider({ apiKey: null });
      const mockResponse = {
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      };
      mockFetchWithTimeout.mockResolvedValue(mockResponse as never);

      await expect(provider.generateText("Hello")).rejects.toThrow(
        "Backend AI error 500: Internal Server Error",
      );
    });

    test("should throw on backend data.error", async () => {
      provider = new GeminiProvider({ apiKey: null });
      const mockResponse = {
        ok: true,
        json: async () => ({ error: "Rate limit exceeded" }),
      };
      mockFetchWithTimeout.mockResolvedValue(mockResponse as never);

      await expect(provider.generateText("Hello")).rejects.toThrow(
        "Rate limit exceeded",
      );
    });
  });

  describe("streamGenerateText — always routes through backend", () => {
    test("should stream from backend even with valid API key", async () => {
      provider = new GeminiProvider({ apiKey: "AIzaSyTest123456789" });
      const mockResponse = { ok: true };
      mockFetchWithTimeout.mockResolvedValue(mockResponse as never);
      mockReadSSEStream.mockResolvedValue("Streamed text");

      const result = await provider.streamGenerateText("Hello");
      expect(mockFetchWithTimeout).toHaveBeenCalledWith(
        "/api/services/ai/generate",
        expect.objectContaining({
          body: expect.stringContaining('"stream":true'),
        }),
      );
      expect(mockGoogleGenAI).not.toHaveBeenCalled();
      expect(result).toEqual({ text: "Streamed text", provider: "gemini" });
    });

    test("should never call SDK for streaming", async () => {
      provider = new GeminiProvider({ apiKey: "AIzaSyTest123456789" });
      mockFetchWithTimeout.mockResolvedValue({
        ok: true,
        json: async () => ({ text: "ok" }),
      } as never);

      await provider.streamGenerateText("Hello");
      expect(mockGoogleGenAI).not.toHaveBeenCalled();
    });

    test("should stream from backend when no API key", async () => {
      provider = new GeminiProvider({ apiKey: null });
      const mockResponse = { ok: true };
      mockFetchWithTimeout.mockResolvedValue(mockResponse as never);
      mockReadSSEStream.mockResolvedValue("Streamed text");

      const result = await provider.streamGenerateText("Hello");
      expect(mockFetchWithTimeout).toHaveBeenCalledWith(
        "/api/services/ai/generate",
        expect.objectContaining({
          body: expect.stringContaining('"stream":true'),
        }),
      );
      expect(result).toEqual({ text: "Streamed text", provider: "gemini" });
    });

    test("should throw on backend error during stream", async () => {
      provider = new GeminiProvider({ apiKey: null });
      const mockResponse = {
        ok: false,
        status: 503,
        text: async () => "Service Unavailable",
      };
      mockFetchWithTimeout.mockResolvedValue(mockResponse as never);

      await expect(provider.streamGenerateText("Hello")).rejects.toThrow(
        "Backend AI error 503: Service Unavailable",
      );
    });
  });
});
