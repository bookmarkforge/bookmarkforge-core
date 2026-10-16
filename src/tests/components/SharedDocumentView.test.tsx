import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) => options?.defaultValue || key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

const mockDecompress = vi.fn();
vi.mock("lz-string", () => ({
  default: { decompressFromEncodedURIComponent: mockDecompress },
  decompressFromEncodedURIComponent: mockDecompress,
}));

vi.mock("@blocknote/mantine", () => ({
  BlockNoteView: ({ editor, editable, theme, ...props }: any) => (
    <div data-testid="blocknote-view" />
  ),
}));

vi.mock("@blocknote/react", () => ({
  useCreateBlockNote: vi.fn(() => ({})),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mockInsert = vi.fn();
const mockInitDB = vi.fn(async () => ({
  documents: { insert: mockInsert },
}));
vi.mock("../../db/database", () => ({ initDB: mockInitDB }));

vi.mock("../../utils/crypto-core", () => ({
  hashString: vi.fn(async (input: string) => {
    const mockHash = "a".repeat(64);
    return mockHash;
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
    FileText: mock("FileText"),
    Download: mock("Download"),
    ArrowLeft: mock("ArrowLeft"),
    Loader2: mock("Loader2"),
  };
});

let originalHash: string;

describe("SharedDocumentView", () => {
  let SharedDocumentView: React.FC<{ onBack: () => void }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockInsert.mockReset();
    mockInitDB.mockClear();
    originalHash = window.location.hash;
    const mod = await import("../../components/SharedDocumentView");
    SharedDocumentView = mod.SharedDocumentView;
  });

  afterEach(() => {
    window.location.hash = originalHash;
  });

  it("shows error when there is no hash", () => {
    window.location.hash = "";
    render(<SharedDocumentView onBack={vi.fn()} />);
    expect(screen.getByText("No shared data found in URL")).toBeTruthy();
  });

  it("shows error when the hash has no valid data", () => {
    window.location.hash = "#/shared?data=invalid";
    mockDecompress.mockReturnValue(null);
    render(<SharedDocumentView onBack={vi.fn()} />);
    expect(screen.getByText("Invalid or corrupted share link")).toBeTruthy();
  });

  it("shows the document when there is valid data", async () => {
    window.location.hash = "#/shared?data=valid";
    mockDecompress.mockReturnValue(
      JSON.stringify({
        title: "My Shared Doc",
        content: [{ type: "paragraph", content: "Hello" }],
        timestamp: Date.now(),
        integrity: "a".repeat(64),
      }),
    );
    render(<SharedDocumentView onBack={vi.fn()} />);
    await expect(screen.findByText("My Shared Doc")).resolves.toBeTruthy();
  });

  it("calls onBack when clicking back", async () => {
    window.location.hash = "#/shared?data=valid";
    mockDecompress.mockReturnValue(
      JSON.stringify({
        title: "Doc",
        content: [],
        timestamp: Date.now(),
        integrity: "a".repeat(64),
      }),
    );
    const onBack = vi.fn();
    render(<SharedDocumentView onBack={onBack} />);
    const backButtons = await screen.findAllByTestId("icon-ArrowLeft");
    await userEvent.click(backButtons[0]!);
    expect(onBack).toHaveBeenCalled();
  });

  it("shows Save to Library button", async () => {
    window.location.hash = "#/shared?data=valid";
    mockDecompress.mockReturnValue(
      JSON.stringify({
        title: "Doc",
        content: [{ type: "paragraph", content: "Hello" }],
        timestamp: Date.now(),
        integrity: "a".repeat(64),
      }),
    );
    render(<SharedDocumentView onBack={vi.fn()} />);
    await expect(screen.findByText("Save to Library")).resolves.toBeTruthy();
  });

  it("shows error if the JSON is corrupted", () => {
    window.location.hash = "#/shared?data=badjson";
    mockDecompress.mockReturnValue("not-json-at-all");
    render(<SharedDocumentView onBack={vi.fn()} />);
    expect(screen.getByText("Error parsing shared document")).toBeTruthy();
  });

  it("shows error if integrity is missing", () => {
    window.location.hash = "#/shared?data=valid";
    mockDecompress.mockReturnValue(JSON.stringify({ foo: "bar" }));
    render(<SharedDocumentView onBack={vi.fn()} />);
    expect(screen.getByText("Invalid or corrupted share link")).toBeTruthy();
  });

  it("persists the shared document and shows success feedback", async () => {
    window.location.hash = "#/shared?data=valid";
    const timestamp = Date.now();
    const content = [{ type: "paragraph", content: "Hello" }];
    mockDecompress.mockReturnValue(
      JSON.stringify({
        title: "Doc",
        content,
        timestamp,
        integrity: "a".repeat(64),
      }),
    );
    render(<SharedDocumentView onBack={vi.fn()} />);

    const button = await screen.findByRole("button", {
      name: "Save to Library",
    });
    await userEvent.click(button);

    expect(mockInitDB).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "a".repeat(64),
        title: "Doc",
        blocks: content,
        folderId: "root",
        tags: ["shared"],
        isDeleted: false,
      }),
    );
    expect(vi.mocked((await import("sonner")).toast.success)).toHaveBeenCalledWith(
      "Saved to your library!",
    );
  });

  it("does not duplicate the document and shows feedback when RxDB responds with a conflict", async () => {
    window.location.hash = "#/shared?data=valid";
    mockDecompress.mockReturnValue(
      JSON.stringify({
        title: "Doc",
        content: [],
        timestamp: Date.now(),
        integrity: "a".repeat(64),
      }),
    );
    mockInsert.mockRejectedValueOnce({ code: "CONFLICT" });
    render(<SharedDocumentView onBack={vi.fn()} />);

    const button = await screen.findByRole("button", {
      name: "Save to Library",
    });
    await userEvent.click(button);
    await expect(
      screen.findByRole("button", { name: "Already in Library" }),
    ).resolves.toBeTruthy();
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(vi.mocked((await import("sonner")).toast.info)).toHaveBeenCalledWith(
      "This document is already in your library.",
    );
  });

  it("shows the real error when persistence fails", async () => {
    window.location.hash = "#/shared?data=valid";
    mockDecompress.mockReturnValue(
      JSON.stringify({
        title: "Doc",
        content: [],
        timestamp: Date.now(),
        integrity: "a".repeat(64),
      }),
    );
    mockInsert.mockRejectedValueOnce(new Error("storage unavailable"));
    render(<SharedDocumentView onBack={vi.fn()} />);

    const button = await screen.findByRole("button", {
      name: "Save to Library",
    });
    await userEvent.click(button);

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(vi.mocked((await import("sonner")).toast.error)).toHaveBeenCalledWith(
      "Failed to save shared document to your library.",
    );
    expect(screen.getByRole("button", { name: "Save to Library" })).toBeEnabled();
  });

  it("ignores repeated clicks after saving", async () => {
    window.location.hash = "#/shared?data=valid";
    mockDecompress.mockReturnValue(
      JSON.stringify({
        title: "Doc",
        content: [],
        timestamp: Date.now(),
        integrity: "a".repeat(64),
      }),
    );
    render(<SharedDocumentView onBack={vi.fn()} />);

    const button = await screen.findByRole("button", {
      name: "Save to Library",
    });
    await userEvent.click(button);
    const savedButton = await screen.findByRole("button", {
      name: "Saved to your library!",
    });
    await userEvent.click(savedButton);

    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it("ignores repeated clicks while the save is still pending", async () => {
    window.location.hash = "#/shared?data=valid";
    mockDecompress.mockReturnValue(
      JSON.stringify({
        title: "Doc",
        content: [],
        timestamp: Date.now(),
        integrity: "a".repeat(64),
      }),
    );
    let resolveInsert!: () => void;
    mockInsert.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveInsert = resolve; }),
    );
    render(<SharedDocumentView onBack={vi.fn()} />);

    const button = await screen.findByRole("button", {
      name: "Save to Library",
    });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(mockInsert).toHaveBeenCalledOnce();

    resolveInsert();
    await screen.findByRole("button", { name: "Saved to your library!" });
  });

  it("discards the resolved save after unmount without toast", async () => {
    window.location.hash = "#/shared?data=valid";
    mockDecompress.mockReturnValue(
      JSON.stringify({
        title: "Doc",
        content: [],
        timestamp: Date.now(),
        integrity: "a".repeat(64),
      }),
    );
    let resolveInsert: () => void;
    mockInsert.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveInsert = resolve;
        }),
    );

    const { unmount } = render(<SharedDocumentView onBack={vi.fn()} />);
    const button = await screen.findByRole("button", {
      name: "Save to Library",
    });
    await userEvent.click(button);
    unmount();
    await act(async () => {
      resolveInsert!();
    });

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(
      vi.mocked((await import("sonner")).toast.success),
    ).not.toHaveBeenCalled();
  });

  it("discards the save error after unmount without toast", async () => {
    window.location.hash = "#/shared?data=valid";
    mockDecompress.mockReturnValue(
      JSON.stringify({
        title: "Doc",
        content: [],
        timestamp: Date.now(),
        integrity: "a".repeat(64),
      }),
    );
    let rejectInsert: (reason: Error) => void;
    mockInsert.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectInsert = reject;
        }),
    );

    const { unmount } = render(<SharedDocumentView onBack={vi.fn()} />);
    const button = await screen.findByRole("button", {
      name: "Save to Library",
    });
    await userEvent.click(button);
    unmount();
    await act(async () => {
      rejectInsert!(new Error("late storage error"));
    });

    expect(
      vi.mocked((await import("sonner")).toast.error),
    ).not.toHaveBeenCalled();
  });

  it("shows download button", async () => {
    window.location.hash = "#/shared?data=valid";
    mockDecompress.mockReturnValue(
      JSON.stringify({
        title: "Doc",
        content: [{ type: "paragraph", content: "Hola" }],
        timestamp: Date.now(),
        integrity: "a".repeat(64),
      }),
    );
    render(<SharedDocumentView onBack={vi.fn()} />);
    const downloadIcons = await screen.findAllByTestId("icon-Download");
    expect(downloadIcons.length).toBeGreaterThan(0);
  });
});
