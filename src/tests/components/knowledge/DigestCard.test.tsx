import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  getPersistedInsights: vi.fn(),
  generateWeeklyCuration: vi.fn(),
  markInsightAsRead: vi.fn(),
}));

vi.mock("../../../services/ai/CrossPollinationService", () => ({
  crossPollinationService: {
    getPersistedInsights: mocks.getPersistedInsights,
    generateWeeklyCuration: mocks.generateWeeklyCuration,
    markInsightAsRead: mocks.markInsightAsRead,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: "en" },
  }),
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("lucide-react", () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    Sparkles: Icon,
    Calendar: Icon,
    CheckCircle2: Icon,
    RefreshCw: Icon,
  };
});

import { DigestCard } from "../../../components/knowledge/DigestCard";

const persistedDigest = {
  id: "digest-1",
  type: "suggestion" as const,
  title: "Weekly themes",
  content: "Content",
  relatedIds: [],
  createdAt: "2026-08-13T00:00:00.000Z",
  isRead: false,
};

describe("DigestCard lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPersistedInsights.mockResolvedValue([persistedDigest]);
    mocks.generateWeeklyCuration.mockResolvedValue(null);
    mocks.markInsightAsRead.mockResolvedValue(undefined);
  });

  it("ignores the initial load that finishes after unmount", async () => {
    let resolveLoad!: (insights: typeof persistedDigest[]) => void;
    mocks.getPersistedInsights.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const { unmount } = render(<DigestCard />);
    unmount();

    await act(async () => {
      resolveLoad([persistedDigest]);
      await Promise.resolve();
    });

    expect(mocks.generateWeeklyCuration).not.toHaveBeenCalled();
  });

  it("propagates signal and aborts a regeneration on unmount", async () => {
    let resolveGeneration!: (insight: typeof persistedDigest) => void;
    mocks.generateWeeklyCuration.mockReturnValue(
      new Promise((resolve) => {
        resolveGeneration = resolve;
      }),
    );

    const { unmount } = render(<DigestCard />);
    await waitFor(() => {
      expect(screen.getByTitle("Regenerate")).toBeTruthy();
    });

    await act(async () => {
      screen.getByTitle("Regenerate").click();
    });
    await waitFor(() => {
      expect(mocks.generateWeeklyCuration).toHaveBeenCalled();
    });

    const signal = mocks.generateWeeklyCuration.mock.calls[0]?.[1];
    expect(signal).toBeInstanceOf(AbortSignal);
    unmount();
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      resolveGeneration({ ...persistedDigest, id: "stale-digest" });
      await Promise.resolve();
    });
  });

  it("propagates signal and cancels marking as read on unmount", async () => {
    let resolveRead!: () => void;
    mocks.markInsightAsRead.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRead = resolve;
      }),
    );

    const { unmount } = render(<DigestCard />);
    await waitFor(() => {
      expect(screen.getByTitle("Mark as read")).toBeTruthy();
    });

    await act(async () => {
      screen.getByTitle("Mark as read").click();
    });
    await waitFor(() => {
      expect(mocks.markInsightAsRead).toHaveBeenCalled();
    });

    const signal = mocks.markInsightAsRead.mock.calls[0]?.[1];
    expect(signal).toBeInstanceOf(AbortSignal);
    unmount();
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      resolveRead();
      await Promise.resolve();
    });
  });
});
