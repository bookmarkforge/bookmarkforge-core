import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFirewalledFetch = vi.hoisted(() => vi.fn());

vi.mock("../../utils/networkFirewall", () => ({
  firewalledFetch: mockFirewalledFetch,
  setFirewallDisabled: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn() },
}));

vi.mock("../../services/ai/aiSession", () => ({
  fetchWithAiSession: async (
    request: (options: RequestInit) => Promise<Response>,
    options: RequestInit,
  ) => request(options),
}));

vi.mock("../../services/ai/utils", () => ({
  sanitizeErrorMessage: (msg: string) => msg,
  cancelResponseBody: vi.fn(),
  readBoundedResponseText: async (response: Response) => response.text(),
  readBoundedResponseJson: async <T>(response: Response) =>
    (await response.json()) as T,
}));

const { generateImage } = await import("../../services/imageService");

function mockResponse(status: number, data: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(
      typeof data === "string" ? data : JSON.stringify(data),
    ),
    json: vi.fn().mockResolvedValue(data),
  };
}

describe("imageService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty prompts before making network calls", async () => {
    await expect(generateImage("   ")).rejects.toThrow("cannot be empty");
    expect(mockFirewalledFetch).not.toHaveBeenCalled();
  });

  it("rejects excessively large prompts before hitting the network", async () => {
    await expect(generateImage("x".repeat(20_001))).rejects.toThrow(
      "too long",
    );
    expect(mockFirewalledFetch).not.toHaveBeenCalled();
  });

  it("throws if the backend returns an HTTP error", async () => {
    mockFirewalledFetch.mockResolvedValue(
      mockResponse(500, "Internal Server Error"),
    );
    await expect(generateImage("test")).rejects.toThrow(
      "Image generation failed",
    );
  });

  it("throws if the backend returns an error in JSON", async () => {
    mockFirewalledFetch.mockResolvedValue(
      mockResponse(200, { error: "Model unavailable" }),
    );
    await expect(generateImage("test")).rejects.toThrow("Model unavailable");
  });

  it("lanza error si no hay imageBase64 en respuesta", async () => {
    mockFirewalledFetch.mockResolvedValue(mockResponse(200, {}));
    await expect(generateImage("test")).rejects.toThrow("No image generated");
  });

  it("throws if imageBase64 is null", async () => {
    mockFirewalledFetch.mockResolvedValue(
      mockResponse(200, { imageBase64: null }),
    );
    await expect(generateImage("test")).rejects.toThrow("No image generated");
  });

  it("throws if the backend is not ok and the text is empty", async () => {
    mockFirewalledFetch.mockResolvedValue(mockResponse(400, ""));
    await expect(generateImage("test")).rejects.toThrow(
      "Image generation failed",
    );
  });

  it("returns data:image/png;base64 when the backend responds OK", async () => {
    mockFirewalledFetch.mockResolvedValue(
      mockResponse(200, {
        imageBase64: "data:image/png;base64,abc123",
      }),
    );
    const result = await generateImage("test");
    expect(result).toBe("data:image/png;base64,abc123");
  });
});
