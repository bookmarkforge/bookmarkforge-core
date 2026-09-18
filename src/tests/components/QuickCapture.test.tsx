import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { ProUnavailableError } from "../../services/pro-access";

vi.mock("../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue({
    bookmarks: { insert: vi.fn() },
    documents: { insert: vi.fn() },
  }),
}));

vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: { generateText: vi.fn() },
}));
vi.mock("../../services/MetadataService", () => ({
  metadataService: { fetchMetadata: vi.fn() },
}));
vi.mock("../../services/ai/RAGEngine", () => ({
  ragEngine: { generateEmbedding: vi.fn() },
}));
vi.mock("../../services/ai/TaggingService", () => ({
  taggingService: { suggestHierarchy: vi.fn() },
}));

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: mockToast }));

// QuickCapture now imports isFreeLimitError from LicenseService; mocking
// the service keeps src/i18n.ts out of this suite's module graph (its
// bootstrap fights this suite's react-i18next mock).
const { mockIsFreeLimitError } = vi.hoisted(() => ({
  mockIsFreeLimitError: vi.fn(() => false),
}));
vi.mock("../../services/LicenseService", () => ({
  isFreeLimitError: mockIsFreeLimitError,
  // pro-access (real, imported for announceProUnavailable) binds this at
  // module level; the double just has to exist and answer the gate.
  licenseService: { hasProAccess: () => false },
}));
vi.mock("../../components/FreeTierSaveHint", () => ({
  FreeTierSaveHint: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
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
    Zap: mock("Zap"),
    Link: mock("Link"),
    FileText: mock("FileText"),
    Send: mock("Send"),
    Loader2: mock("Loader2"),
    X: mock("X"),
  };
});

vi.mock("i18next", () => ({ default: { language: "en" } }));

import { QuickCapture, generateEmbeddingWithTimeout } from "../../components/QuickCapture";

describe("QuickCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders floating button", () => {
    render(<QuickCapture />);
    expect(screen.getByTestId("icon-Zap")).toBeTruthy();
  });

  it("does not overlap the mobile nav (regression: bottom-20 on mobile, bottom-4 on desktop)", () => {
    // BottomNav (md:hidden, fixed bottom-0, z-50) renders AFTER
    // QuickCapture in MainApp; with the same z-index it covers the FAB and swallows
    // the clicks. The FAB must stay above the nav on mobile.
    render(<QuickCapture />);
    const fab = screen.getByTestId("add-bookmark-button");
    const container = fab.parentElement!;
    expect(container.className).toContain("bottom-20");
    expect(container.className).toContain("md:bottom-4");
    expect(container.className).toContain("z-50");
  });

  it("opens panel when clicking the button", async () => {
    render(<QuickCapture />);
    const btn = screen.getByTestId("icon-Zap").closest("button")!;
    await userEvent.click(btn);
    expect(screen.getByText("app_quickCapture")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter URL...")).toBeTruthy();
  });

  it("closes panel when clicking X", async () => {
    render(<QuickCapture />);
    const openBtn = screen.getByTestId("icon-Zap").closest("button")!;
    await userEvent.click(openBtn);
    expect(screen.getByText("app_quickCapture")).toBeTruthy();
    const closeBtns = screen.getAllByLabelText("Close quick capture");
    await userEvent.click(closeBtns[0]!);
    await waitFor(() => {
      expect(screen.queryByText("app_quickCapture")).toBeNull();
    });
  });

  it("send button disabled if input is empty", async () => {
    render(<QuickCapture />);
    const openBtn = screen.getByTestId("icon-Zap").closest("button")!;
    await userEvent.click(openBtn);
    const sendBtn = screen.getByTestId("icon-Send").closest("button")!;
    expect(sendBtn.disabled).toBe(true);
  });

  it("send button enabled if there is text", async () => {
    render(<QuickCapture />);
    const openBtn = screen.getByTestId("icon-Zap").closest("button")!;
    await userEvent.click(openBtn);
    const input = screen.getByPlaceholderText(
      "Enter URL...",
    ) as HTMLInputElement;
    await userEvent.type(input, "https://example.com");
    const sendBtn = screen.getByTestId("icon-Send").closest("button")!;
    expect(sendBtn.disabled).toBe(false);
  });

  it("switches icon to Link when a URL is entered", async () => {
    render(<QuickCapture />);
    const openBtn = screen.getByTestId("icon-Zap").closest("button")!;
    await userEvent.click(openBtn);
    const input = screen.getByPlaceholderText(
      "Enter URL...",
    ) as HTMLInputElement;
    expect(screen.getByTestId("icon-FileText")).toBeTruthy();
    await userEvent.type(input, "https://example.com");
    expect(screen.getByTestId("icon-Link")).toBeTruthy();
  });

  it("captures a URL: inserts bookmark and clears the input", async () => {
    const { initDB } = await import("../../db/database");
    const insert = vi.fn().mockResolvedValue(undefined);
    (initDB as ReturnType<typeof vi.fn>).mockResolvedValue({
      bookmarks: { insert },
      documents: { insert: vi.fn() },
    });
    const { metadataService } = await import("../../services/MetadataService");
    (metadataService.fetchMetadata as ReturnType<typeof vi.fn>).mockResolvedValue(
      { title: "Example Title", description: "Example description" },
    );
    const { aiManager } = await import("../../services/ai/ProviderManager");
    (aiManager.generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify({ summary: "AI summary", tags: ["ai", "test"] }),
    });
    const { taggingService } = await import("../../services/ai/TaggingService");
    (taggingService.suggestHierarchy as ReturnType<typeof vi.fn>).mockResolvedValue(
      "test/folder",
    );
    const { ragEngine } = await import("../../services/ai/RAGEngine");
    (ragEngine.generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([
      0.1, 0.2, 0.3,
    ]);

    render(<QuickCapture />);
    const openBtn = screen.getByTestId("icon-Zap").closest("button")!;
    await userEvent.click(openBtn);
    const input = screen.getByPlaceholderText(
      "Enter URL...",
    ) as HTMLInputElement;
    await userEvent.type(input, "https://example.com");
    const sendBtn = screen.getByTestId("icon-Send").closest("button")!;
    await userEvent.click(sendBtn);

    await waitFor(() => {
      expect(insert).toHaveBeenCalled();
    });
    const inserted = insert.mock.calls[0]![0];
    expect(inserted.url).toBe("https://example.com");
    expect(inserted.title).toBe("Example Title");
    expect(inserted.summary).toBe("AI summary");
    expect(inserted.tags).toEqual(["ai", "test"]);
    expect(inserted.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(inserted.processed).toBe(true);
    expect(mockToast.success).toHaveBeenCalledWith("app_bookmarkCaptured");
    await waitFor(() => {
      expect(screen.queryByText("app_quickCapture")).toBeNull();
    });
  });

  it("captures a note: inserts document into hierarchy folder", async () => {
    const { initDB } = await import("../../db/database");
    const insert = vi.fn().mockResolvedValue(undefined);
    (initDB as ReturnType<typeof vi.fn>).mockResolvedValue({
      bookmarks: { insert: vi.fn() },
      documents: { insert },
    });
    const { aiManager } = await import("../../services/ai/ProviderManager");
    (aiManager.generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify({ title: "Note Title", tags: ["note", "idea"] }),
    });
    const { taggingService } = await import("../../services/ai/TaggingService");
    (taggingService.suggestHierarchy as ReturnType<typeof vi.fn>).mockResolvedValue(
      "notes/work",
    );
    const { ragEngine } = await import("../../services/ai/RAGEngine");
    (ragEngine.generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<QuickCapture />);
    const openBtn = screen.getByTestId("icon-Zap").closest("button")!;
    await userEvent.click(openBtn);
    const input = screen.getByPlaceholderText(
      "Enter URL...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Mi idea genial");
    const sendBtn = screen.getByTestId("icon-Send").closest("button")!;
    await userEvent.click(sendBtn);

    await waitFor(() => {
      expect(insert).toHaveBeenCalled();
    });
    const inserted = insert.mock.calls[0]![0];
    expect(inserted.folderId).toBe("notes/work");
    expect(inserted.title).toBe("Note Title");
    expect(inserted.textContent).toBe("Mi idea genial");
    expect(inserted.tags).toEqual(["note", "idea"]);
    expect(mockToast.success).toHaveBeenCalledWith("app_noteCaptured");
  });

  it("degrades gracefully when AI services fail", async () => {
    const { initDB } = await import("../../db/database");
    const insert = vi.fn().mockResolvedValue(undefined);
    (initDB as ReturnType<typeof vi.fn>).mockResolvedValue({
      bookmarks: { insert },
      documents: { insert: vi.fn() },
    });
    const { metadataService } = await import("../../services/MetadataService");
    (metadataService.fetchMetadata as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("offline"),
    );
    const { aiManager } = await import("../../services/ai/ProviderManager");
    (aiManager.generateText as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("no key"),
    );
    const { taggingService } = await import("../../services/ai/TaggingService");
    (taggingService.suggestHierarchy as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("no model"),
    );
    const { ragEngine } = await import("../../services/ai/RAGEngine");
    (ragEngine.generateEmbedding as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("no embedding"),
    );

    render(<QuickCapture />);
    const openBtn = screen.getByTestId("icon-Zap").closest("button")!;
    await userEvent.click(openBtn);
    const input = screen.getByPlaceholderText(
      "Enter URL...",
    ) as HTMLInputElement;
    await userEvent.type(input, "https://fallback.com");
    const sendBtn = screen.getByTestId("icon-Send").closest("button")!;
    await userEvent.click(sendBtn);

    await waitFor(() => {
      expect(insert).toHaveBeenCalled();
    });
    const inserted = insert.mock.calls[0]![0];
    // Fallbacks: raw URL as title, default tag, empty embedding
    expect(inserted.title).toBe("https://fallback.com");
    expect(inserted.tags).toEqual(["captured"]);
    expect(inserted.embedding).toEqual([]);
    expect(mockToast.success).toHaveBeenCalledWith("app_bookmarkCaptured");
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("sanitizes malformed AI metadata while preserving the capture", async () => {
    const { initDB } = await import("../../db/database");
    const insert = vi.fn().mockResolvedValue(undefined);
    (initDB as ReturnType<typeof vi.fn>).mockResolvedValue({
      bookmarks: { insert },
      documents: { insert: vi.fn() },
    });
    const { metadataService } = await import("../../services/MetadataService");
    (metadataService.fetchMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Source title",
      description: "Source summary",
    });
    const { aiManager } = await import("../../services/ai/ProviderManager");
    (aiManager.generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "ollama",
      text: JSON.stringify({
        summary: "  "+"x".repeat(5000),
        tags: ["One", "one", 42, "  Two  ", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"],
      }),
    });
    const { taggingService } = await import("../../services/ai/TaggingService");
    (taggingService.suggestHierarchy as ReturnType<typeof vi.fn>).mockResolvedValue("");
    const { ragEngine } = await import("../../services/ai/RAGEngine");
    (ragEngine.generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<QuickCapture />);
    await userEvent.click(screen.getByTestId("add-bookmark-button"));
    await userEvent.type(screen.getByPlaceholderText("Enter URL..."), "https://safe.example");
    await userEvent.click(screen.getByTestId("save-bookmark-button"));

    await waitFor(() => expect(insert).toHaveBeenCalled());
    const inserted = insert.mock.calls[0]![0];
    expect(inserted.summary).toHaveLength(4_000);
    expect(inserted.tags).toEqual(["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"]);
  });

  it("shows error if the insert fails", async () => {
    const { initDB } = await import("../../db/database");
    const insert = vi.fn().mockRejectedValue(new Error("quota exceeded"));
    (initDB as ReturnType<typeof vi.fn>).mockResolvedValue({
      bookmarks: { insert },
      documents: { insert: vi.fn() },
    });

    render(<QuickCapture />);
    const openBtn = screen.getByTestId("icon-Zap").closest("button")!;
    await userEvent.click(openBtn);
    const input = screen.getByPlaceholderText(
      "Enter URL...",
    ) as HTMLInputElement;
    await userEvent.type(input, "https://error.com");
    const sendBtn = screen.getByTestId("icon-Send").closest("button")!;
    await userEvent.click(sendBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("app_captureError");
    });
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("shows the free-limit upgrade CTA instead of the generic capture error", async () => {
    const { initDB } = await import("../../db/database");
    const insert = vi.fn().mockRejectedValue(new Error("free wall"));
    (initDB as ReturnType<typeof vi.fn>).mockResolvedValue({
      bookmarks: { insert },
      documents: { insert: vi.fn() },
    });
    mockIsFreeLimitError.mockReturnValue(true);

    render(<QuickCapture />);
    await userEvent.click(screen.getByTestId("add-bookmark-button"));
    await userEvent.type(
      screen.getByPlaceholderText("Enter URL..."),
      "https://limit.example",
    );
    await userEvent.click(screen.getByTestId("save-bookmark-button"));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringContaining("Free holds"),
        expect.objectContaining({ duration: 4000, action: expect.any(Object) }),
      );
    });
    expect(mockToast.error).not.toHaveBeenCalledWith("app_captureError");
    mockIsFreeLimitError.mockReturnValue(false);
  });

  it("announces a Pro rejection instead of the generic capture error", async () => {
    const { initDB } = await import("../../db/database");
    const insert = vi.fn().mockRejectedValue(
      new ProUnavailableError("SpecializedAgentsService", "no-license"),
    );
    (initDB as ReturnType<typeof vi.fn>).mockResolvedValue({
      bookmarks: { insert },
      documents: { insert: vi.fn() },
    });
    const dispatched: CustomEvent[] = [];
    const originalDispatch = window.dispatchEvent.bind(window);
    const spy = vi
      .spyOn(window, "dispatchEvent")
      .mockImplementation((event: Event) => {
        if (event.type === "bmf:pro-unavailable") {
          dispatched.push(event as CustomEvent);
        }
        return originalDispatch(event);
      });
    render(<QuickCapture />);
    await userEvent.click(screen.getByTestId("add-bookmark-button"));
    await userEvent.type(
      screen.getByPlaceholderText("Enter URL..."),
      "https://pro.example",
    );
    await userEvent.click(screen.getByTestId("save-bookmark-button"));
    await vi.waitFor(() => expect(dispatched.length).toBe(1));
    expect(dispatched[0]!.detail).toEqual({
      feature: "SpecializedAgentsService",
      reason: "no-license",
    });
    expect(mockToast.error).not.toHaveBeenCalledWith("app_captureError");
    spy.mockRestore();
  });

  it("shows spinner and disables send while processing", async () => {
    const { initDB } = await import("../../db/database");
    // initDB never resolves: the capture stays in the processing state
    (initDB as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );

    render(<QuickCapture />);
    const openBtn = screen.getByTestId("icon-Zap").closest("button")!;
    await userEvent.click(openBtn);
    const input = screen.getByPlaceholderText(
      "Enter URL...",
    ) as HTMLInputElement;
    await userEvent.type(input, "https://loading.com");
    const sendBtn = screen.getByTestId("icon-Send").closest("button")!;
    await userEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByTestId("icon-Loader2")).toBeTruthy();
    });
    expect(screen.queryByTestId("icon-Send")).toBeNull();
    expect((input as HTMLInputElement).disabled).toBe(true);
  });

  it("sends with Enter and does nothing with empty input", async () => {
    const { initDB } = await import("../../db/database");
    const insert = vi.fn().mockResolvedValue(undefined);
    (initDB as ReturnType<typeof vi.fn>).mockResolvedValue({
      bookmarks: { insert },
      documents: { insert: vi.fn() },
    });

    render(<QuickCapture />);
    const openBtn = screen.getByTestId("icon-Zap").closest("button")!;
    await userEvent.click(openBtn);
    const input = screen.getByPlaceholderText(
      "Enter URL...",
    ) as HTMLInputElement;
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(insert).not.toHaveBeenCalled();
    });
    await userEvent.type(input, "https://enter.com");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(insert).toHaveBeenCalled();
    });
  });

  it("discards the pending capture on unmount", async () => {
    let resolveInit!: (db: unknown) => void;
    const insert = vi.fn().mockResolvedValue(undefined);
    const { initDB } = await import("../../db/database");
    (initDB as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => {
        resolveInit = resolve;
      }),
    );

    const { unmount } = render(<QuickCapture />);
    await userEvent.click(screen.getByTestId("add-bookmark-button"));
    await userEvent.type(
      screen.getByPlaceholderText("Enter URL..."),
      "https://stale.example",
    );
    await userEvent.click(screen.getByTestId("save-bookmark-button"));
    await waitFor(() => {
      expect(screen.getByTestId("icon-Loader2")).toBeTruthy();
    });

    unmount();
    await act(async () => {
      resolveInit({
        bookmarks: { insert },
        documents: { insert: vi.fn() },
      });
    });

    expect(insert).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("aborts the underlying inference when the QuickCapture limit expires", async () => {
    vi.useFakeTimers();
    try {
      let receivedSignal: AbortSignal | undefined;
      const generateEmbedding = vi.fn(
        (_text: string, signal: AbortSignal) => {
          receivedSignal = signal;
          return new Promise<number[]>(() => {});
        },
      );
      const resultPromise = generateEmbeddingWithTimeout(
        generateEmbedding,
        "large capture",
      );
      await vi.advanceTimersByTimeAsync(3000);
      await expect(resultPromise).resolves.toEqual([]);
      expect(receivedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timer after a successful inference", async () => {
    vi.useFakeTimers();
    try {
      let receivedSignal: AbortSignal | undefined;
      const generateEmbedding = vi.fn(
        (_text: string, signal: AbortSignal) => {
          receivedSignal = signal;
          return Promise.resolve([0.1, 0.2]);
        },
      );
      await expect(
        generateEmbeddingWithTimeout(generateEmbedding, "short capture"),
      ).resolves.toEqual([0.1, 0.2]);
      await vi.advanceTimersByTimeAsync(3000);
      expect(receivedSignal?.aborted).toBe(true);
      expect(generateEmbedding).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
