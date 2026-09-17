import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFirewalledFetch = vi.hoisted(() => vi.fn());

vi.mock("../../../utils/networkFirewall", () => ({
  firewalledFetch: mockFirewalledFetch,
  setFirewallDisabled: vi.fn(),
}));

const { fetchWithAiSession } = await import("../../../services/ai/aiSession");

function response(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    body: null,
    json: async () => body,
  } as unknown as Response;
}

describe("AI session client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes requests through without session overhead", async () => {
    mockFirewalledFetch.mockResolvedValue(response(200, { answer: "ok" }));
    const request = vi.fn(async (options: RequestInit) => mockFirewalledFetch(options));
    const result = await fetchWithAiSession(request, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello" }),
    });
    expect(result.status).toBe(200);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("returns the response as-is for successful requests", async () => {
    mockFirewalledFetch.mockResolvedValue(response(200, { answer: "ok" }));
    const request = vi.fn(async (options: RequestInit) => mockFirewalledFetch(options));
    const result = await fetchWithAiSession(request);
    expect(result.status).toBe(200);
    expect(request).toHaveBeenCalledTimes(1);
  });
});