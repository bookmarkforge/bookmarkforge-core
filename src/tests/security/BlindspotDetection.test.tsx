import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { BlindspotDetection } from "../../components/knowledge/BlindspotDetection";

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
  useTranslation: () => {
    const t = (k: string, d?: unknown) => {
      const def =
        d && typeof d === "object"
          ? (d as Record<string, unknown>).defaultValue
          : (d as string | undefined);
      return def ?? k;
    };
    return { t, i18n: { language: "en" } };
  },
}));

describe("BlindspotDetection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeStorage.safeGet.mockReturnValue(undefined);
  });

  it("renders the empty state and scan button", async () => {
    render(
      <BlindspotDetection bookmarkTitles={["A", "B"]} cardVariants={{}} />,
    );
    expect(await screen.findByText("Blindspot Detection")).toBeInTheDocument();
    expect(
      screen.getByText("Press scan to discover knowledge blindspots"),
    ).toBeInTheDocument();
    expect(screen.getByText("Scan for Blindspots")).toBeInTheDocument();
  });

  it("detects blindspots via AI and persists them", async () => {
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify([
        {
          topic: "Missing Topic",
          reason: "Because gap.",
          suggestion: "Read more.",
        },
      ]),
    });
    render(
      <BlindspotDetection bookmarkTitles={["A", "B"]} cardVariants={{}} />,
    );
    fireEvent.click(await screen.findByText("Scan for Blindspots"));
    expect(await screen.findByText("Missing Topic")).toBeInTheDocument();
    expect(screen.getByText("Because gap.")).toBeInTheDocument();
    expect(screen.getByText("Read more.")).toBeInTheDocument();
    expect(agent.globalChat).toHaveBeenCalled();
    expect(safeStorage.safeSet).toHaveBeenCalledWith(
      "bookmarkforge_blindspots",
      expect.any(String),
    );
  });

  it("streams tokens live via onChunk and clears the preview when finished", async () => {
    agent.globalChat.mockImplementation(
      (_p: string, _l?: string, _pr?: boolean, _s?: string, onChunk?: (c: string) => void) => {
        onChunk?.('{"topic"');
        onChunk?.(':"En vivo"');
        return Promise.resolve({
          text: JSON.stringify([
            { topic: "En vivo", reason: "R", suggestion: "S" },
          ]),
        });
      },
    );
    render(<BlindspotDetection bookmarkTitles={["A"]} cardVariants={{}} />);
    fireEvent.click(await screen.findByText("Scan for Blindspots"));
    // The final result replaces the live preview
    expect(await screen.findByText("En vivo")).toBeInTheDocument();
    expect(agent.globalChat).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      false,
      undefined,
      expect.any(Function),
      undefined,
      undefined,
      expect.any(AbortSignal),
    );
  });

  it("uses cached blindspots from storage without calling the agent", async () => {
    safeStorage.safeGet.mockReturnValue(
      JSON.stringify([{ topic: "Cached Gap", reason: "R", suggestion: "S" }]),
    );
    render(<BlindspotDetection bookmarkTitles={["A"]} cardVariants={{}} />);
    expect(await screen.findByText("Cached Gap")).toBeInTheDocument();
    expect(agent.globalChat).not.toHaveBeenCalled();
  });

  it("aborts and ignores a scan that finishes after unmount", async () => {
    let resolveScan!: (value: { text: string }) => void;
    let requestSignal: AbortSignal | undefined;
    agent.globalChat.mockImplementation(
      (
        _prompt: string,
        _lang?: string,
        _private?: boolean,
        _sessionId?: string,
        _onChunk?: (chunk: string) => void,
        _documentContext?: unknown,
        _onProvider?: unknown,
        signal?: AbortSignal,
      ) => {
        requestSignal = signal;
        return new Promise<{ text: string }>((resolve) => {
          resolveScan = resolve;
        });
      },
    );
    const { unmount } = render(
      <BlindspotDetection bookmarkTitles={["A"]} cardVariants={{}} />,
    );
    fireEvent.click(await screen.findByText("Scan for Blindspots"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalled());
    expect(requestSignal).toBeDefined();
    unmount();
    expect(requestSignal?.aborted).toBe(true);

    resolveScan({
      text: JSON.stringify([
        { topic: "Stale", reason: "R", suggestion: "S" },
      ]),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(safeStorage.safeSet).not.toHaveBeenCalled();
  });

  it("handles AI failure gracefully", async () => {
    agent.globalChat.mockRejectedValue(new Error("ai down"));
    render(<BlindspotDetection bookmarkTitles={["A"]} cardVariants={{}} />);
    fireEvent.click(await screen.findByText("Scan for Blindspots"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalled());
    expect(
      screen.getByText("Press scan to discover knowledge blindspots"),
    ).toBeInTheDocument();
  });
});
