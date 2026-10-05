import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useNetworkWhitelist } from "../../hooks/useNetworkWhitelist";

const mocks = vi.hoisted(() => ({
  getWhitelistedOrigins: vi.fn().mockResolvedValue([]),
  addToWhitelist: vi.fn().mockResolvedValue(undefined),
  removeFromWhitelist: vi.fn().mockResolvedValue(undefined),
  invalidateWhitelistCache: vi.fn(),
}));

vi.mock("../../utils/networkFirewall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/networkFirewall")>();
  return {
    ...actual,
    getWhitelistedOrigins: mocks.getWhitelistedOrigins,
    addToWhitelist: mocks.addToWhitelist,
    removeFromWhitelist: mocks.removeFromWhitelist,
    invalidateWhitelistCache: mocks.invalidateWhitelistCache,
  };
});

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("useNetworkWhitelist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWhitelistedOrigins.mockResolvedValue([]);
  });

  it("a stale refresh does not overwrite a newer result", async () => {
    let resolveFirst!: (value: string[]) => void;
    mocks.getWhitelistedOrigins
      .mockImplementationOnce(
        () =>
          new Promise<string[]>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(["https://new.example.com"]);

    const { result } = renderHook(() => useNetworkWhitelist());
    // First refresh (mount) is pending with the stale list.
    await waitFor(() =>
      expect(mocks.getWhitelistedOrigins).toHaveBeenCalledTimes(1),
    );

    // A second refresh resolves first with the newer list.
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.origins).toEqual(["https://new.example.com"]);

    // The stale first refresh resolves later and must be discarded.
    await act(async () => {
      resolveFirst(["https://stale.example.com"]);
    });
    expect(result.current.origins).toEqual(["https://new.example.com"]);
  });

  it("a failed refresh after a newer one does not touch the state", async () => {
    let rejectFirst!: (reason: Error) => void;
    mocks.getWhitelistedOrigins
      .mockImplementationOnce(
        () =>
          new Promise<string[]>((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce(["https://kept.example.com"]);

    const { result } = renderHook(() => useNetworkWhitelist());
    await waitFor(() =>
      expect(mocks.getWhitelistedOrigins).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.origins).toEqual(["https://kept.example.com"]);

    await act(async () => {
      rejectFirst!(new Error("late failure"));
    });
    // The stale rejection must not clear the newer result nor log.
    expect(result.current.origins).toEqual(["https://kept.example.com"]);
    expect(result.current.loading).toBe(false);
  });
});
