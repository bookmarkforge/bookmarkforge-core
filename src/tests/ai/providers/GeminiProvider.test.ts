import { describe, test, expect, vi, beforeEach } from "vitest";
import { fetchWithTimeout, readSSEStream } from "../../../services/ai/utils";

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

  describe("generateText", () => {
    test("should call Gemini API endpoint with the API key", async () => {
      provider = new GeminiProvider({ apiKey: "AIzaSyTest123456789" });
      const mockResponse = {
        ok: true,
        json: async () => ({ text: "Reply" }),
      };
      mockFetchWithTimeout.mockResolvedValue(mockResponse as never);

      const result = await provider.generateText("Hello", "System");

      expect(mockFetchWithTimeout).toHaveBeenCalledWith(
        expect.stringContaining("generateContent"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "x-goog-api-key": "AIzaSyTest123456789" }),
        }),
      );
      expect(result).toEqual({ text: "Reply", provider: "gemini" });
    });

    test("should wrap prompt with buildSafeUserContent", async () => {
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

    test("should pass model to Gemini API", async () => {
      provider = new GeminiProvider({ apiKey: "AIzaSyTest123456789" });
      mockFetchWithTimeout.mockResolvedValue({
        ok: true,
        json: async () => ({ text: "ok" }),
      } as never);

      await provider.generateText("Hello", undefined, { model: "gemini-2.0-flash" });

      expect(mockFetchWithTimeout).toHaveBeenCalledWith(
        expect.stringContaining("gemini-2.0-flash"),
        expect.anything(),
      );
    });

    test("should pass responseMimeType and responseSchema", async () => {
      provider = new GeminiProvider({ apiKey: "AIzaSyTest123456789" });
      mockFetchWithTimeout.mockResolvedValue({
        ok: true,
        json: async () => ({ text: "ok" }),
      } as never);

      const schema = { type: "object", properties: { name: { type: "string" } } };
      await provider.generateText("Hello", undefined, { responseMimeType: "application/json", responseSchema: schema });

      const callBody = JSON.parse(
        (mockFetchWithTimeout.mock.calls[0]?.[1] as Record<string, unknown>)?.body as string,
      );
      expect(callBody.responseMimeType).toBe("application/json");
      expect(callBody.responseSchema).toEqual(schema);
    });

    test("should pass tools to Gemini API", async () => {
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

    test("should throw on backend HTTP error", async () => {
      provider = new GeminiProvider({ apiKey: null });
      const mockResponse = {
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      };
      mockFetchWithTimeout.mockResolvedValue(mockResponse as never);

      await expect(provider.generateText("Hello")).rejects.toThrow(
        "Gemini API error 500: Internal Server Error",
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

  describe("streamGenerateText", () => {
    test("should stream from Gemini API", async () => {
      provider = new GeminiProvider({ apiKey: "AIzaSyTest123456789" });
      const mockResponse = { ok: true };
      mockFetchWithTimeout.mockResolvedValue(mockResponse as never);
      mockReadSSEStream.mockResolvedValue("Streamed text");

      const result = await provider.streamGenerateText("Hello");
      expect(mockFetchWithTimeout).toHaveBeenCalledWith(
        expect.stringContaining("streamGenerateContent"),
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
        "Gemini API error 503: Service Unavailable",
      );
    });
  });
});