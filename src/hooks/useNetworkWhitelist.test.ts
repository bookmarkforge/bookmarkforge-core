import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useNetworkWhitelist } from "./useNetworkWhitelist";

// Mock the networkFirewall module
const mockGetWhitelistedOrigins = vi.fn();
const mockAddToWhitelist = vi.fn();
const mockRemoveFromWhitelist = vi.fn();
const mockInvalidateWhitelistCache = vi.fn();
const mockLoggerError = vi.fn();

vi.mock("../utils/logger", () => ({
  logger: { error: (...args: unknown[]) => mockLoggerError(...args) },
}));

vi.mock("../utils/networkFirewall", () => ({
  getWhitelistedOrigins: (...args: unknown[]) =>
    mockGetWhitelistedOrigins(...args),
  addToWhitelist: (...args: unknown[]) => mockAddToWhitelist(...args),
  removeFromWhitelist: (...args: unknown[]) => mockRemoveFromWhitelist(...args),
  invalidateWhitelistCache: (...args: unknown[]) =>
    mockInvalidateWhitelistCache(...args),
  // Exports required by src/tests/setup.ts
  setFirewallDisabled: vi.fn(),
  isFirewallEnabled: vi.fn().mockReturnValue(true),
  checkNetworkRequest: vi.fn(),
  firewalledFetch: vi.fn(),
  firewalledWebSocket: vi.fn(),
  firewalledEventSource: vi.fn(),
  validateIceServers: vi.fn(),
  NetworkFirewallError: class NetworkFirewallError extends Error {},
}));

describe("useNetworkWhitelist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWhitelistedOrigins.mockResolvedValue([
      "http://localhost:11434",
      "https://api.openai.com",
    ]);
    mockAddToWhitelist.mockResolvedValue(undefined);
    mockRemoveFromWhitelist.mockResolvedValue(undefined);
  });

  it("loads origins on mount", async () => {
    const { result } = renderHook(() => useNetworkWhitelist());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.origins).toEqual([
      "http://localhost:11434",
      "https://api.openai.com",
    ]);
    expect(mockGetWhitelistedOrigins).toHaveBeenCalledTimes(1);
    expect(mockInvalidateWhitelistCache).toHaveBeenCalledTimes(1);
  });

  it("adds an origin and refreshes", async () => {
    mockGetWhitelistedOrigins
      .mockResolvedValueOnce(["http://localhost:11434"])
      .mockResolvedValueOnce(["http://localhost:11434", "https://example.com"]);

    const { result } = renderHook(() => useNetworkWhitelist());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.add("https://example.com");
    });

    expect(mockAddToWhitelist).toHaveBeenCalledWith("https://example.com");
    expect(result.current.origins).toContain("https://example.com");
  });

  it("removes an origin and refreshes", async () => {
    mockGetWhitelistedOrigins
      .mockResolvedValueOnce([
        "http://localhost:11434",
        "https://api.openai.com",
      ])
      .mockResolvedValueOnce(["http://localhost:11434"]);

    const { result } = renderHook(() => useNetworkWhitelist());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove("https://api.openai.com");
    });

    expect(mockRemoveFromWhitelist).toHaveBeenCalledWith(
      "https://api.openai.com",
    );
    expect(result.current.origins).not.toContain("https://api.openai.com");
  });

  it("refresh invalidates cache and reloads", async () => {
    const { result } = renderHook(() => useNetworkWhitelist());

    await waitFor(() => expect(result.current.loading).toBe(false));

    mockGetWhitelistedOrigins.mockResolvedValueOnce(["https://new-origin.com"]);

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockInvalidateWhitelistCache).toHaveBeenCalledTimes(2); // once on mount, once on refresh
    expect(result.current.origins).toEqual(["https://new-origin.com"]);
  });

  it("starts with empty origins and loading true", () => {
    const { result } = renderHook(() => useNetworkWhitelist());
    expect(result.current.origins).toEqual([]);
    expect(result.current.loading).toBe(true);
  });

  it("resets loading and keeps empty origins when getWhitelistedOrigins rejects", async () => {
    const error = new Error("db down");
    mockGetWhitelistedOrigins.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useNetworkWhitelist());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.origins).toEqual([]);
    expect(mockGetWhitelistedOrigins).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith(
      "[useNetworkWhitelist] refresh failed",
      { error },
    );
  });

  it("does not refresh after add fails", async () => {
    mockAddToWhitelist.mockRejectedValueOnce(new Error("add failed"));
    mockGetWhitelistedOrigins.mockResolvedValueOnce(["http://localhost:11434"]);

    const { result } = renderHook(() => useNetworkWhitelist());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.add("https://example.com")).rejects.toThrow("add failed");

    expect(mockAddToWhitelist).toHaveBeenCalledWith("https://example.com");
    expect(result.current.origins).toEqual(["http://localhost:11434"]);
  });

  it("does not refresh after remove fails", async () => {
    mockRemoveFromWhitelist.mockRejectedValueOnce(new Error("remove failed"));
    mockGetWhitelistedOrigins.mockResolvedValueOnce([
      "http://localhost:11434",
      "https://api.openai.com",
    ]);

    const { result } = renderHook(() => useNetworkWhitelist());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.remove("https://api.openai.com")).rejects.toThrow("remove failed");

    expect(mockRemoveFromWhitelist).toHaveBeenCalledWith("https://api.openai.com");
    expect(result.current.origins).toEqual([
      "http://localhost:11434",
      "https://api.openai.com",
    ]);
  });
});
