import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import React from "react";
import { DevilAdvocateReader } from "../../components/bookmarks/DevilAdvocateReader";

const agent = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: agent,
}));

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

const content =
  "First substantial paragraph about topic one.\n\nSecond substantial paragraph about topic two.";

describe("DevilAdvocateReader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agent.generateText.mockResolvedValue({ text: "Counter text here" });
  });

  const openPanel = () => {
    fireEvent.click(screen.getByTitle("Enable Devil's Advocate"));
  };

  const paragraphContainer = (text: string) => {
    const p = screen.getByText(text);
    return p.closest("div")!.parentElement as HTMLElement;
  };

  it("toggles the panel open and shows paragraphs", async () => {
    render(<DevilAdvocateReader content={content} title="Doc" />);
    expect(screen.queryByText("Devil's Advocate")).not.toBeInTheDocument();
    openPanel();
    expect(await screen.findByText("Devil's Advocate")).toBeInTheDocument();
    expect(
      screen.getByText("First substantial paragraph about topic one."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Second substantial paragraph about topic two."),
    ).toBeInTheDocument();
  });

  it("generates a counter-argument for a single paragraph", async () => {
    render(<DevilAdvocateReader content={content} title="Doc" />);
    openPanel();
    fireEvent.click(
      within(
        paragraphContainer("First substantial paragraph about topic one."),
      ).getByText("Challenge"),
    );
    expect(await screen.findByText("Counter text here")).toBeInTheDocument();
    expect(agent.generateText).toHaveBeenCalled();
  });

  it("aborts a counter-argument when the panel closes", async () => {
    let resolveCounter!: (result: { text: string }) => void;
    agent.generateText.mockReturnValue(
      new Promise((resolve) => {
        resolveCounter = resolve;
      }),
    );
    render(<DevilAdvocateReader content={content} title="Doc" />);
    openPanel();
    fireEvent.click(
      within(
        paragraphContainer("First substantial paragraph about topic one."),
      ).getByText("Challenge"),
    );
    await waitFor(() => expect(agent.generateText).toHaveBeenCalled());
    const signal = agent.generateText.mock.calls[0]?.[2]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    fireEvent.click(screen.getByLabelText("Close Devil's Advocate panel"));
    expect(signal?.aborted).toBe(true);
    resolveCounter({ text: "Stale counter" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Stale counter")).toBeNull();
  });

  it("propagates cancellation to the counter-argument provider", async () => {
    let rejectGeneration!: (error: unknown) => void;
    agent.generateText.mockImplementation((_prompt: string, _system: unknown, options: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        rejectGeneration = reject;
        options.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }),
    );
    render(<DevilAdvocateReader content={content} title="Doc" />);
    openPanel();
    fireEvent.click(
      within(
        paragraphContainer("First substantial paragraph about topic one."),
      ).getByText("Challenge"),
    );
    await waitFor(() => expect(agent.generateText).toHaveBeenCalled());
    const signal = agent.generateText.mock.calls[0]?.[2]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    fireEvent.click(screen.getByLabelText("Close Devil's Advocate panel"));
    expect(signal?.aborted).toBe(true);
    rejectGeneration(new DOMException("aborted", "AbortError"));
  });

  it("challenges all paragraphs", async () => {
    render(<DevilAdvocateReader content={content} title="Doc" />);
    openPanel();
    fireEvent.click(screen.getByText("Challenge All"));
    expect(await screen.findByText("Counter text here")).toBeInTheDocument();
    expect(agent.generateText).toHaveBeenCalledTimes(2);
  });

  it("dismisses a counter-argument via Agree", async () => {
    render(<DevilAdvocateReader content={content} title="Doc" />);
    openPanel();
    fireEvent.click(
      within(
        paragraphContainer("First substantial paragraph about topic one."),
      ).getByText("Challenge"),
    );
    const counter = await screen.findByText("Counter text here");
    expect(counter).toBeInTheDocument();
    fireEvent.click(
      within(
        paragraphContainer("First substantial paragraph about topic one."),
      ).getByText("Agree"),
    );
    await waitFor(() =>
      expect(screen.queryByText("Counter text here")).not.toBeInTheDocument(),
    );
  });

  it("handles generation failure gracefully", async () => {
    agent.generateText.mockRejectedValue(new Error("ai down"));
    render(<DevilAdvocateReader content={content} title="Doc" />);
    openPanel();
    fireEvent.click(
      within(
        paragraphContainer("First substantial paragraph about topic one."),
      ).getByText("Challenge"),
    );
    await waitFor(() => expect(agent.generateText).toHaveBeenCalled());
    expect(screen.queryByText("Counter text here")).not.toBeInTheDocument();
  });
});
