import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React, { act } from "react";
import { BookmarkPersonality } from "../../components/knowledge/BookmarkPersonality";

const safeStorage = vi.hoisted(() => ({ safeGet: vi.fn(), safeSet: vi.fn() }));
vi.mock("../../store/safeStorage", () => ({
  safeGet: safeStorage.safeGet,
  safeSet: safeStorage.safeSet,
}));

const agent = vi.hoisted(() => ({ globalChat: vi.fn() }));
vi.mock("../../services/ai/AgentService", () => ({ agentService: agent }));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, d?: unknown) =>
      d && typeof d === "object"
        ? ((d as Record<string, unknown>).defaultValue ?? k)
        : ((d as unknown) ?? k),
  }),
}));

const profile = {
  type: "The Explorer",
  description: "Curious and wide-ranging.",
  topInterests: ["AI", "Art"],
  bias: "Novelty bias",
  gap: "Deep fundamentals",
};

describe("BookmarkPersonality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeStorage.safeGet.mockReturnValue(null);
    agent.globalChat.mockResolvedValue({ text: JSON.stringify(profile) });
  });

  it("renders the empty state with an Analyze button when nothing is cached", () => {
    render(
      <BookmarkPersonality bookmarkTitles={["AI", "Art"]} cardVariants={{}} />,
    );
    expect(screen.getByText("Bookmark Personality")).toBeInTheDocument();
    expect(screen.getByText("Analyze My Library")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Analyze your library to discover your intellectual personality",
      ),
    ).toBeInTheDocument();
  });

  it("renders a cached personality from safeGet", () => {
    safeStorage.safeGet.mockReturnValue(JSON.stringify(profile));
    render(<BookmarkPersonality bookmarkTitles={["AI"]} cardVariants={{}} />);
    expect(screen.getByText("The Explorer")).toBeInTheDocument();
    expect(screen.getByText("Curious and wide-ranging.")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("Novelty bias")).toBeInTheDocument();
    expect(screen.getByText("Deep fundamentals")).toBeInTheDocument();
  });

  it("analyzes the library, caches the result and shows the type", async () => {
    render(
      <BookmarkPersonality bookmarkTitles={["AI", "Art"]} cardVariants={{}} />,
    );
    fireEvent.click(screen.getByText("Analyze My Library"));
    expect(await screen.findByText("The Explorer")).toBeInTheDocument();
    expect(agent.globalChat).toHaveBeenCalled();
    expect(safeStorage.safeSet).toHaveBeenCalledWith(
      "bookmarkforge_personality",
      JSON.stringify(profile),
    );
  });

  it("keeps the empty state when analysis fails", async () => {
    agent.globalChat.mockRejectedValue(new Error("ai down"));
    render(<BookmarkPersonality bookmarkTitles={["AI"]} cardVariants={{}} />);
    fireEvent.click(screen.getByText("Analyze My Library"));
    expect(
      await screen.findByText(
        "Analyze your library to discover your intellectual personality",
      ),
    ).toBeInTheDocument();
  });

  it("propagates signal and discards the profile if the library changes", async () => {
    let resolveAnalysis!: (result: { text: string }) => void;
    agent.globalChat.mockReturnValue(
      new Promise((resolve) => {
        resolveAnalysis = resolve;
      }),
    );
    const { rerender } = render(
      <BookmarkPersonality bookmarkTitles={["AI"]} cardVariants={{}} />,
    );
    fireEvent.click(screen.getByText("Analyze My Library"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalled());

    const signal = agent.globalChat.mock.calls[0]?.[7];
    expect(signal).toBeInstanceOf(AbortSignal);
    rerender(
      <BookmarkPersonality bookmarkTitles={["Art"]} cardVariants={{}} />,
    );
    expect(signal?.aborted).toBe(true);

    resolveAnalysis({ text: JSON.stringify(profile) });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("The Explorer")).toBeNull();
    expect(safeStorage.safeSet).not.toHaveBeenCalled();
  });

  it("renders the Specialist emoji for a Specialist personality", () => {
    safeStorage.safeGet.mockReturnValue(
      JSON.stringify({ ...profile, type: "The Specialist" }),
    );
    render(<BookmarkPersonality bookmarkTitles={["AI"]} cardVariants={{}} />);
    expect(screen.getByText("The Specialist")).toBeInTheDocument();
    expect(screen.getByText("🔍")).toBeInTheDocument();
  });
});
