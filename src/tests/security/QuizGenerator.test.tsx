import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { QuizGenerator } from "../../components/knowledge/QuizGenerator";

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

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

// Components map docs via d.toJSON(), so the mock doc must expose it.
const bm = {
  id: "b1",
  title: "BM One",
  content: "Some content",
  toJSON: () => ({ id: "b1", title: "BM One", content: "Some content" }),
};

const quizJson = JSON.stringify({
  questions: [
    { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 1 },
    { question: "Q2", options: ["W", "X", "Y", "Z"], correctIndex: 3 },
  ],
});

describe("QuizGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.initDB.mockResolvedValue({
      bookmarks: {
        find: () => ({
          sort: () => ({ limit: () => ({ exec: async () => [bm] }) }),
        }),
      },
    });
    agent.generateText.mockResolvedValue({ text: quizJson });
  });

  it("prompts to select a bookmark when no quiz exists", async () => {
    render(<QuizGenerator cardVariants={{}} />);
    expect(await screen.findByText("BM One")).toBeInTheDocument();
    expect(
      screen.getByText("Select a bookmark and generate a quiz"),
    ).toBeInTheDocument();
  });

  it("generates a quiz and displays its questions", async () => {
    render(<QuizGenerator cardVariants={{}} />);
    const select = await screen.findByDisplayValue("Select a bookmark...");
    fireEvent.change(select, { target: { value: "b1" } });
    fireEvent.click(screen.getByText("Generate Quiz"));
    expect(await screen.findByText(/Q1/)).toBeInTheDocument();
    expect(screen.getByText(/Q2/)).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(agent.generateText).toHaveBeenCalled();
  });

  it("scores correct answers on submit", async () => {
    render(<QuizGenerator cardVariants={{}} />);
    const select = await screen.findByDisplayValue("Select a bookmark...");
    fireEvent.change(select, { target: { value: "b1" } });
    fireEvent.click(screen.getByText("Generate Quiz"));
    await screen.findByText(/Q1/);
    fireEvent.click(screen.getByText("B"));
    fireEvent.click(screen.getByText("Z"));
    fireEvent.click(screen.getByText("Submit Answers"));
    expect(await screen.findByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("(100%)")).toBeInTheDocument();
  });

  it("retries and clears the quiz", async () => {
    render(<QuizGenerator cardVariants={{}} />);
    const select = await screen.findByDisplayValue("Select a bookmark...");
    fireEvent.change(select, { target: { value: "b1" } });
    fireEvent.click(screen.getByText("Generate Quiz"));
    await screen.findByText(/Q1/);
    fireEvent.click(screen.getByText("B"));
    fireEvent.click(screen.getByText("Z"));
    fireEvent.click(screen.getByText("Submit Answers"));
    fireEvent.click(screen.getByText("Retry"));
    expect(
      await screen.findByText("Select a bookmark and generate a quiz"),
    ).toBeInTheDocument();
  });

  it("keeps the prompt when generation fails", async () => {
    agent.generateText.mockRejectedValue(new Error("ai down"));
    render(<QuizGenerator cardVariants={{}} />);
    const select = await screen.findByDisplayValue("Select a bookmark...");
    fireEvent.change(select, { target: { value: "b1" } });
    fireEvent.click(screen.getByText("Generate Quiz"));
    await waitFor(() => expect(agent.generateText).toHaveBeenCalled());
    expect(
      screen.getByText("Select a bookmark and generate a quiz"),
    ).toBeInTheDocument();
  });

  it("discards a quiz when the selected bookmark changes during generation", async () => {
    let resolvePending!: (value: { text: string }) => void;
    const pending = new Promise<{ text: string }>((resolve) => {
      resolvePending = resolve;
    });
    agent.generateText.mockReturnValueOnce(pending);

    render(<QuizGenerator cardVariants={{}} />);
    const select = await screen.findByDisplayValue("Select a bookmark...");
    fireEvent.change(select, { target: { value: "b1" } });
    fireEvent.click(screen.getByText("Generate Quiz"));
    await waitFor(() => expect(agent.generateText).toHaveBeenCalled());

    const signal = agent.generateText.mock.calls[0]![2].signal as AbortSignal;
    fireEvent.change(select, { target: { value: "" } });
    expect(signal.aborted).toBe(true);

    resolvePending({ text: quizJson });
    await waitFor(() => {
      expect(screen.queryByText(/Q1/)).not.toBeInTheDocument();
    });
  });
});
