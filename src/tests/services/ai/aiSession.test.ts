import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFirewalledFetch = vi.hoisted(() => vi.fn());
const mockGetAiSessionProof = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("../../../utils/networkFirewall", () => ({
  firewalledFetch: mockFirewalledFetch,
  setFirewallDisabled: vi.fn(),
}));
vi.mock("../../../services/LicenseService", () => ({
  licenseService: { getAiSessionProof: mockGetAiSessionProof },
}));

const {
  ensureAiSession,
  fetchWithAiSession,
  invalidateAiSession,
} = await import("../../../services/ai/aiSession");

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
    invalidateAiSession();
  });

  it("caches one bootstrap token until invalidated", async () => {
    mockFirewalledFetch.mockResolvedValue(response(200, { csrfToken: "a".repeat(32) }));
    await ensureAiSession();
    await ensureAiSession();
    expect(mockFirewalledFetch).toHaveBeenCalledTimes(1);
  });

  it("renews once after an expired-session response", async () => {
    mockFirewalledFetch
      .mockResolvedValueOnce(response(200, { csrfToken: "a".repeat(32) }))
      .mockResolvedValueOnce(response(200, { csrfToken: "b".repeat(32) }));
    const requests: RequestInit[] = [];
    let requestCount = 0;
    const result = await fetchWithAiSession(async (options) => {
      requests.push(options);
      requestCount += 1;
      if (requestCount === 1) return response(401, { error: "expired" });
      return response(200, { answer: "ok" });
    });
    expect(result.status).toBe(200);
    expect(requests).toHaveLength(2);
    expect(new Headers(requests[0]?.headers).get("X-CSRF-Token")).toBe("a".repeat(32));
    expect(new Headers(requests[1]?.headers).get("X-CSRF-Token")).toBe("b".repeat(32));
  });

  it("does not retry when the body is a single-use stream", async () => {
    mockFirewalledFetch.mockResolvedValue(response(200, { csrfToken: "a".repeat(32) }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const request = vi.fn(async () => response(401, { error: "expired" }));
    const result = await fetchWithAiSession(request, {
      method: "POST",
      body: stream,
    });
    // The stream was consumed by the first attempt; the retry would send a
    // closed body, so the 401 must be propagated as-is.
    expect(result.status).toBe(401);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not renew successful responses", async () => {
    mockFirewalledFetch.mockResolvedValue(response(200, { csrfToken: "a".repeat(32) }));
    const request = vi.fn(async () => response(200, { answer: "ok" }));
    await fetchWithAiSession(request);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
