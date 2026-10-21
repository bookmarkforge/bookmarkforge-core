import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";
import { MoodAdaptiveReader } from "../../components/bookmarks/MoodAdaptiveReader";

const safeStorage = vi.hoisted(() => ({ safeGet: vi.fn() }));
vi.mock("../../store/safeStorage", () => ({ safeGet: safeStorage.safeGet }));

const agent = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("../../services/ai/ProviderManager", () => ({ aiManager: agent }));

let rafCalls = 0;
const scrollRef = { current: { scrollTop: 0 } } as any;

describe("MoodAdaptiveReader", () => {
  beforeEach(() => {
    rafCalls = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      if (rafCalls < 1) {
        rafCalls += 1;
        setTimeout(() => cb(0), 0);
      }
      return rafCalls;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    scrollRef.current.scrollTop = 0;
    safeStorage.safeGet.mockReturnValue("morning");
    agent.generateText.mockResolvedValue({ text: "Summary bullet point" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the stored mood label and scroll speed", () => {
    safeStorage.safeGet.mockReturnValue("evening");
    render(
      <MoodAdaptiveReader
        content="some content"
        scrollContainerRef={scrollRef}
      />,
    );
    expect(screen.getByText("Evening")).toBeInTheDocument();
    expect(screen.getByText("0px/s")).toBeInTheDocument();
  });

  it("falls back to a time-based mood when nothing is stored", async () => {
    safeStorage.safeGet.mockReturnValue(null);
    render(
      <MoodAdaptiveReader
        content="some content"
        scrollContainerRef={scrollRef}
      />,
    );
    expect(
      await screen.findByText(/(Night Owl|Morning|Afternoon|Evening)/),
    ).toBeInTheDocument();
  });

  it("shows the Skim button after fast scrolling and generates a summary", async () => {
    render(
      <MoodAdaptiveReader
        content="some long content"
        scrollContainerRef={scrollRef}
      />,
    );
    scrollRef.current.scrollTop = 1000;
    await waitFor(() =>
      expect(screen.getByText("Skim this article")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Skim this article"));
    expect(await screen.findByText("Summary bullet point")).toBeInTheDocument();
    expect(agent.generateText).toHaveBeenCalled();
  });

  it("aborts a summary that resolves after unmount", async () => {
    let resolveSummary!: (result: { text: string }) => void;
    agent.generateText.mockReturnValue(
      new Promise((resolve) => {
        resolveSummary = resolve;
      }),
    );
    const { unmount } = render(
      <MoodAdaptiveReader
        content="some long content"
        scrollContainerRef={scrollRef}
      />,
    );
    scrollRef.current.scrollTop = 1000;
    await waitFor(() =>
      expect(screen.getByText("Skim this article")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Skim this article"));
    await waitFor(() => expect(agent.generateText).toHaveBeenCalled());
    const signal = agent.generateText.mock.calls[0]?.[2]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    unmount();
    expect(signal?.aborted).toBe(true);
    resolveSummary({ text: "Stale summary" });
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("propagates cancellation to the summary provider", async () => {
    let rejectGeneration!: (error: unknown) => void;
    agent.generateText.mockImplementation((_prompt: string, _system: unknown, options: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        rejectGeneration = reject;
        options.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }),
    );
    const { unmount } = render(
      <MoodAdaptiveReader content="some long content" scrollContainerRef={scrollRef} />,
    );
    scrollRef.current.scrollTop = 1000;
    await waitFor(() => expect(screen.getByText("Skim this article")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Skim this article"));
    await waitFor(() => expect(agent.generateText).toHaveBeenCalled());
    const signal = agent.generateText.mock.calls[0]?.[2]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    unmount();
    expect(signal?.aborted).toBe(true);
    rejectGeneration(new DOMException("aborted", "AbortError"));
  });

  it("shows an error summary when generation fails", async () => {
    agent.generateText.mockRejectedValue(new Error("ai down"));
    render(
      <MoodAdaptiveReader
        content="some long content"
        scrollContainerRef={scrollRef}
      />,
    );
    scrollRef.current.scrollTop = 1000;
    await waitFor(() =>
      expect(screen.getByText("Skim this article")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Skim this article"));
    expect(
      await screen.findByText("Unable to generate summary at this time."),
    ).toBeInTheDocument();
  });

  it("dismisses the generated summary", async () => {
    render(
      <MoodAdaptiveReader
        content="some long content"
        scrollContainerRef={scrollRef}
      />,
    );
    scrollRef.current.scrollTop = 1000;
    await waitFor(() =>
      expect(screen.getByText("Skim this article")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Skim this article"));
    const summary = await screen.findByText("Summary bullet point");
    expect(summary).toBeInTheDocument();
    fireEvent.click(screen.getByText("Dismiss"));
    await waitFor(() =>
      expect(
        screen.queryByText("Summary bullet point"),
      ).not.toBeInTheDocument(),
    );
  });
});
