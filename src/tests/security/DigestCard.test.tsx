import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const cps = vi.hoisted(() => ({
  getPersistedInsights: vi.fn(),
  generateWeeklyCuration: vi.fn(),
  markInsightAsRead: vi.fn(),
}));
vi.mock("../../services/ai/CrossPollinationService", () => ({
  crossPollinationService: cps,
}));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

const t = (k: string, d?: unknown) => {
  const def =
    d && typeof d === "object"
      ? (d as Record<string, unknown>).defaultValue
      : (d as string | undefined);
  return def ?? k;
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t, i18n: { language: "en" } }),
}));

import React from "react";
import { DigestCard } from "../../components/knowledge/DigestCard";

const suggestion = {
  id: "1",
  type: "suggestion" as const,
  title: "T",
  content: "C",
  relatedIds: [],
  createdAt: new Date().toISOString(),
  isRead: false,
};

describe("DigestCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cps.generateWeeklyCuration.mockResolvedValue(null);
  });

  it("renders the latest suggestion digest", async () => {
    cps.getPersistedInsights.mockResolvedValue([suggestion]);
    render(<DigestCard />);
    expect(await screen.findByText("Weekly Digest")).toBeInTheDocument();
    expect(screen.getByText("T")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByTitle("Mark as read")).toBeInTheDocument();
  });

  it("shows empty state when there is no suggestion", async () => {
    cps.getPersistedInsights.mockResolvedValue([]);
    render(<DigestCard />);
    expect(
      await screen.findByText(/No weekly digest yet/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Generate My Digest")).toBeInTheDocument();
  });

  it("generates a new digest on demand", async () => {
    cps.getPersistedInsights.mockResolvedValue([]);
    cps.generateWeeklyCuration.mockResolvedValue({
      ...suggestion,
      id: "2",
      title: "G",
      content: "CG",
    });
    render(<DigestCard />);
    fireEvent.click(await screen.findByText("Generate My Digest"));
    expect(await screen.findByText("G")).toBeInTheDocument();
    expect(screen.getByText("CG")).toBeInTheDocument();
    expect(cps.generateWeeklyCuration).toHaveBeenCalledWith(
      "en",
      expect.any(AbortSignal),
    );
  });

  it("marks a digest as read", async () => {
    cps.getPersistedInsights.mockResolvedValue([suggestion]);
    render(<DigestCard />);
    await screen.findByText("New");
    fireEvent.click(screen.getByTitle("Mark as read"));
    await waitFor(() =>
      expect(cps.markInsightAsRead).toHaveBeenCalledWith(
        "1",
        expect.any(AbortSignal),
      ),
    );
    expect(screen.queryByText("New")).toBeNull();
  });
});
