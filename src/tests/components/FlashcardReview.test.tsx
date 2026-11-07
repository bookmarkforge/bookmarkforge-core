import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) => options?.defaultValue || key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

const mockInitDB = vi.fn();
vi.mock("../../db/database", () => ({ initDB: mockInitDB }));

const mockLoggerError = vi.fn();
vi.mock("../../utils/logger", () => ({
  logger: { error: mockLoggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// FlashcardService is Pro, but review uses the extracted Core SM-2 math
// (spaced-repetition) directly — no loader mock needed for scheduling.
vi.mock("../../services/ai/spaced-repetition", () => ({
  calculateNextReview: vi.fn((quality: number) => ({
    nextReview: new Date().toISOString(),
    interval: 1,
    easeFactor: 2.5,
    repetition: 1,
  })),
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Brain: mock("Brain"),
    X: mock("X"),
    Check: mock("Check"),
    ArrowRight: mock("ArrowRight"),
    Sparkles: mock("Sparkles"),
    Loader2: mock("Loader2"),
    AlertCircle: mock("AlertCircle"),
    RotateCcw: mock("RotateCcw"),
  };
});

const makeCard = (overrides = {}) => ({
  id: "card-1",
  question: "What is the capital of France?",
  answer: "Paris",
  nextReview: new Date().toISOString(),
  interval: 0,
  easeFactor: 2.5,
  repetition: 0,
  deckId: "deck-1",
  toJSON: function () {
    const { toJSON, ...rest } = this;
    return rest;
  },
  ...overrides,
});

describe("FlashcardReview", () => {
  let FlashcardReview: React.FC<{ onClose: () => void }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
    const mod = await import("../../components/FlashcardReview");
    FlashcardReview = mod.default;
  });

  it("shows initial loading", () => {
    const { unmount } = render(<FlashcardReview onClose={vi.fn()} />);
    expect(screen.getByTestId("icon-Loader2")).toBeTruthy();
    unmount();
  });

  it("ignores a load error that arrives after unmount", async () => {
    let rejectInitDB!: (error: Error) => void;
    mockInitDB.mockReturnValue(
      new Promise((_, reject) => {
        rejectInitDB = reject;
      }),
    );
    const { unmount } = render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(() => expect(mockInitDB).toHaveBeenCalled());

    unmount();
    rejectInitDB!(new Error("late database failure"));
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("shows empty screen when there are no cards", async () => {
    render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("app_noFlashcardsYet")).toBeTruthy();
    });
  });

  it("shows card in review mode", async () => {
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([makeCard()]),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
    render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("What is the capital of France?")).toBeTruthy();
    });
  });

  it("shows showAnswer button initially", async () => {
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([makeCard()]),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
    render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("showAnswer")).toBeTruthy();
    });
  });

  it("shows the answer after clicking showAnswer", async () => {
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([makeCard()]),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
    render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(async () => {
      await userEvent.click(screen.getByText("showAnswer"));
    });
    expect(screen.getByText("Paris")).toBeTruthy();
  });

  it("calls onClose when clicking the close button in review mode", async () => {
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([makeCard()]),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
    const onClose = vi.fn();
    render(<FlashcardReview onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByTestId("icon-X")).toBeTruthy();
    });
    await userEvent.click(screen.getByTestId("icon-X"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows completed session after reviewing all cards", async () => {
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([makeCard({ id: "card-1" })]),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
    render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("showAnswer")).toBeTruthy();
    });
    await userEvent.click(screen.getByText("showAnswer"));
    await waitFor(() => {
      expect(screen.getByText("Paris")).toBeTruthy();
    });
    await userEvent.click(screen.getByText("good"));
    await waitFor(() => {
      expect(screen.getByText("sessionCompleted")).toBeTruthy();
    });
  });

  it("handles DB error gracefully", async () => {
    mockInitDB.mockRejectedValue(new Error("DB connection failed"));
    render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("app_noFlashcardsYet")).toBeTruthy();
    });
  });

  // ── Branch coverage: multiple cards, review errors, completed onClose ──

  it("advances to the next card after reviewing the first", async () => {
    const card1 = makeCard({ id: "card-1", question: "Q1", answer: "A1" });
    const card2 = makeCard({ id: "card-2", question: "Q2", answer: "A2" });
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([card1, card2]),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
    render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Q1")).toBeTruthy());
    // Show answer
    await userEvent.click(screen.getByText("showAnswer"));
    await waitFor(() => expect(screen.getByText("A1")).toBeTruthy());
    // Rate as "good"
    await userEvent.click(screen.getByText("good"));
    // Should advance to card 2
    await waitFor(() => expect(screen.getByText("Q2")).toBeTruthy());
  });

  it("handles review error and advances to the next card", async () => {
    const card1 = makeCard({ id: "c1", question: "Q1", answer: "A1" });
    const card2 = makeCard({ id: "c2", question: "Q2", answer: "A2" });
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([card1, card2]),
        upsert: vi.fn().mockRejectedValue(new Error("Upsert failed")),
      },
    });
    render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Q1")).toBeTruthy());
    await userEvent.click(screen.getByText("showAnswer"));
    await waitFor(() => expect(screen.getByText("A1")).toBeTruthy());
    // Rate as good — upsert fails but should advance anyway
    await userEvent.click(screen.getByText("good"));
    await waitFor(() => expect(screen.getByText("Q2")).toBeTruthy());
  });

  it("error on last card leads to completed session", async () => {
    const card = makeCard({ id: "c1", question: "LastQ", answer: "LastA" });
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([card]),
        upsert: vi.fn().mockRejectedValue(new Error("Upsert crash")),
      },
    });
    render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("LastQ")).toBeTruthy());
    await userEvent.click(screen.getByText("showAnswer"));
    await waitFor(() => expect(screen.getByText("LastA")).toBeTruthy());
    await userEvent.click(screen.getByText("good"));
    // Last card + error → isFinishing
    await waitFor(() =>
      expect(screen.getByText("sessionCompleted")).toBeTruthy(),
    );
  });

  it("calls onClose from the completed session screen", async () => {
    const onClose = vi.fn();
    render(<FlashcardReview onClose={onClose} />);
    await waitFor(() =>
      expect(screen.getByText("app_noFlashcardsYet")).toBeTruthy(),
    );
    await userEvent.click(screen.getByText("app_goToEditor"));
    expect(onClose).toHaveBeenCalled();
  });

  it("serializes ratings of the same card across two review surfaces", async () => {
    let resolveFirstUpsert!: () => void;
    const upsert = vi.fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => { resolveFirstUpsert = resolve; }),
      )
      .mockResolvedValue({});
    const findOne = vi.fn().mockImplementation((id: string) => ({
      exec: vi.fn().mockResolvedValue(makeCard({ id })),
    }));
    const db = {
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([makeCard()]),
        findOne,
        upsert,
      },
    };
    mockInitDB.mockResolvedValue(db);

    const { unmount } = render(
      <>
        <FlashcardReview onClose={vi.fn()} />
        <FlashcardReview onClose={vi.fn()} />
      </>,
    );
    await waitFor(() =>
      expect(screen.getAllByText("showAnswer")).toHaveLength(2),
    );
    for (const button of screen.getAllByText("showAnswer")) {
      await userEvent.click(button);
    }
    for (const button of screen.getAllByText("good")) {
      await userEvent.click(button);
    }

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(findOne).toHaveBeenCalledTimes(1);
    resolveFirstUpsert!();
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
    expect(findOne).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("ignores a save error that arrives after unmount", async () => {
    let rejectUpsert!: (error: Error) => void;
    const upsert = vi.fn().mockReturnValue(
      new Promise((_, reject) => {
        rejectUpsert = reject;
      }),
    );
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([makeCard()]),
        upsert,
      },
    });

    const { unmount } = render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("showAnswer")).toBeTruthy());
    await userEvent.click(screen.getByText("showAnswer"));
    await userEvent.click(screen.getByText("good"));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));

    unmount();
    rejectUpsert!(new Error("late update failure"));
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("clears the save timeout on unmount during a pending persistence", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    let resolveUpsert!: () => void;
    const upsert = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolveUpsert = resolve;
      }),
    );
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([makeCard()]),
        upsert,
      },
    });

    const { unmount } = render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("showAnswer")).toBeTruthy());
    await userEvent.click(screen.getByText("showAnswer"));
    await userEvent.click(screen.getByText("good"));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));

    const timerCallIndex = setTimeoutSpy.mock.calls.findIndex(
      ([, delay]) => delay === 15000,
    );
    expect(timerCallIndex).toBeGreaterThan(-1);
    const timerId = setTimeoutSpy.mock.results[timerCallIndex]!.value;
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);

    resolveUpsert();
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it("ignores a second rating while the first is still saving", async () => {
    let resolveUpsert: (() => void) | undefined;
    const upsert = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveUpsert = resolve;
      }),
    );
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          makeCard({ id: "card-1", question: "Q1" }),
          makeCard({ id: "card-2", question: "Q2" }),
        ]),
        upsert,
      },
    });

    render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Q1")).toBeTruthy());
    await userEvent.click(screen.getByText("showAnswer"));
    await waitFor(() => expect(screen.getByText("Paris")).toBeTruthy());

    const goodButton = screen.getByText("good");
    await userEvent.click(goodButton);
    await userEvent.click(goodButton);

    expect(upsert).toHaveBeenCalledTimes(1);
    resolveUpsert?.();
    await waitFor(() => expect(screen.getByText("Q2")).toBeTruthy());
  });

  // ── P89: the 15s race timer must be cleared after the upsert settles ──

  it("P89: clears the timeout timer after saving (does not filter timers per review)", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    mockInitDB.mockResolvedValue({
      flashcards: {
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([makeCard()]),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
    render(<FlashcardReview onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("showAnswer")).toBeTruthy());
    await userEvent.click(screen.getByText("showAnswer"));
    await waitFor(() => expect(screen.getByText("Paris")).toBeTruthy());
    await userEvent.click(screen.getByText("good"));
    await waitFor(() =>
      expect(screen.getByText("sessionCompleted")).toBeTruthy(),
    );

    // The only 15000ms timer in this component is the race timeout. Its id
    // must have been cleared by the finally block once the upsert settled.
    const timerCallIndex = setTimeoutSpy.mock.calls.findIndex(
      ([, delay]) => delay === 15000,
    );
    expect(timerCallIndex).toBeGreaterThan(-1);
    const timerId = setTimeoutSpy.mock.results[timerCallIndex]!.value;
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });
});
