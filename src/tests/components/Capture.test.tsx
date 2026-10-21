import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { ProUnavailableError } from "../../services/pro-access";

const { mockBookmarksInsert, initDBMock, mockToastSuccess, mockToastError } =
  vi.hoisted(() => {
    const insert = vi.fn();
    let shouldFail = false;
    let failWith: Error | null = null;
    const fn = vi.fn().mockImplementation((pw) => {
      if (failWith) return Promise.reject(failWith);
      if (shouldFail) return Promise.reject(new Error("DB fail"));
      return Promise.resolve({ bookmarks: { insert } });
    });
    (fn as any).setFail = (v: boolean) => {
      shouldFail = v;
    };
    (fn as any).setError = (e: Error | null) => {
      failWith = e;
    };
    return {
      mockBookmarksInsert: insert,
      initDBMock: fn,
      mockToastSuccess: vi.fn(),
      mockToastError: vi.fn(),
    };
  });

const { mockValidateUrl } = vi.hoisted(() => ({
  mockValidateUrl: vi.fn(),
}));
vi.mock("../../db/database", () => ({ initDB: initDBMock }));
vi.mock("sonner", () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}));
vi.mock("../../utils/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../../services/SanitizationService", () => ({
  validateAndSanitizeUrl: mockValidateUrl,
  sanitizeUserInput: vi.fn((input: string, _max?: number) => input),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// Capture now imports isFreeLimitError from LicenseService; mocking the
// service keeps src/i18n.ts out of this suite's module graph (its bootstrap
// fights the react-i18next mock) and lets tests control wall errors.
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
vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Bookmark: mock("Bookmark"),
    Globe: mock("Globe"),
    X: mock("X"),
    Check: mock("Check"),
    Loader2: mock("Loader2"),
  };
});

import { Capture } from "../../components/Capture";

describe("Capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.close = vi.fn();
    mockValidateUrl.mockImplementation((u: string) => u);
    (initDBMock as any).setError(null);
    mockIsFreeLimitError.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.location.hash = "";
  });

  it("renders form with URL, title and notes fields", () => {
    render(<Capture />);
    expect(screen.getByText("quickCapture")).toBeTruthy();
    expect(screen.getByLabelText("URL")).toBeTruthy();
    expect(screen.getByLabelText("titleLabel")).toBeTruthy();
    expect(screen.getByLabelText("notesLabel")).toBeTruthy();
    expect(screen.getByText("saveToForge")).toBeTruthy();
  });

  it("save button disabled if there is no URL", () => {
    render(<Capture />);
    const btn = screen.getByText("saveToForge").closest("button");
    expect(btn?.disabled).toBe(true);
  });

  it("allows typing URL, title and notes", async () => {
    render(<Capture />);
    const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
    await userEvent.type(urlInput, "https://example.com");
    expect(urlInput.value).toBe("https://example.com");
    const titleInput = screen.getByLabelText("titleLabel") as HTMLInputElement;
    await userEvent.type(titleInput, "Example");
    expect(titleInput.value).toBe("Example");
    const notesInput = screen.getByLabelText(
      "notesLabel",
    ) as HTMLTextAreaElement;
    await userEvent.type(notesInput, "Some notes");
    expect(notesInput.value).toBe("Some notes");
  });

  it("reads URL and title parameters from the hash fragment", () => {
    window.location.hash =
      "#url=https://hash-example.com&title=Hash%20Title&noAutoSave=true";
    render(<Capture />);
    const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
    const titleInput = screen.getByLabelText("titleLabel") as HTMLInputElement;
    expect(urlInput.value).toBe("https://hash-example.com");
    expect(titleInput.value).toBe("Hash Title");
  });

  it("calls initDB and inserts the bookmark when saving", async () => {
    render(<Capture />);
    const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
    await userEvent.type(urlInput, "https://example.com");
    const titleInput = screen.getByLabelText("titleLabel") as HTMLInputElement;
    await userEvent.type(titleInput, "Example");
    const btn = screen.getByText("saveToForge").closest("button")!;
    await userEvent.click(btn);
    await waitFor(() => {
      expect(initDBMock).toHaveBeenCalled();
    });
    expect(mockBookmarksInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringMatching(/^https:\/\/example\.com/),
        title: "Example",
        tags: ["clipped"],
      }),
    );
  });

  it("shows saved state after saving successfully", async () => {
    render(<Capture />);
    const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
    await userEvent.type(urlInput, "https://example.com");
    const btn = screen.getByText("saveToForge").closest("button")!;
    await userEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByText("savedTitle")).toBeTruthy();
    });
    expect(screen.getByText("savedDesc")).toBeTruthy();
  });

  it("pasa masterPassword a initDB", async () => {
    render(<Capture masterPassword="mypass" />);
    const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
    await userEvent.type(urlInput, "https://example.com");
    const btn = screen.getByText("saveToForge").closest("button")!;
    await userEvent.click(btn);
    await waitFor(() => {
      expect(initDBMock).toHaveBeenCalledWith("mypass");
    });
  });

  it("does not render the form if already saved", async () => {
    render(<Capture />);
    const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
    await userEvent.type(urlInput, "https://example.com");
    const btn = screen.getByText("saveToForge").closest("button")!;
    await userEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByText("savedTitle")).toBeTruthy();
    });
    expect(screen.queryByText("quickCapture")).toBeNull();
  });

  it("shows error toast if initDB fails", async () => {
    (initDBMock as any).setFail(true);
    render(<Capture />);
    const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
    await userEvent.type(urlInput, "https://example.com");
    const btn = screen.getByText("saveToForge").closest("button")!;
    await userEvent.click(btn);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    (initDBMock as any).setFail(false);
  });

  it("announces a Pro rejection instead of the generic save error", async () => {
    (initDBMock as any).setError(new ProUnavailableError("BackupService", "no-license"));
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
    render(<Capture />);
    await userEvent.type(
      screen.getByLabelText("URL") as HTMLInputElement,
      "https://pro.example",
    );
    await userEvent.click(screen.getByText("saveToForge").closest("button")!);
    await vi.waitFor(() => expect(dispatched.length).toBe(1));
    expect(dispatched[0]!.detail).toEqual({
      feature: "BackupService",
      reason: "no-license",
    });
    expect(mockToastError).not.toHaveBeenCalled();
    spy.mockRestore();
    (initDBMock as any).setError(null);
  });

  it("pre-fills notes from the text param if it differs from the url", () => {
    window.location.hash =
      "#url=https://hash-example.com&text=Mi%20resumen&noAutoSave=true";
    render(<Capture />);
    expect(
      (screen.getByLabelText("notesLabel") as HTMLTextAreaElement).value,
    ).toBe("Mi resumen");
  });

  it("uses the text param as URL when it starts with http", () => {
    window.location.hash = "#text=https://text-url.com&noAutoSave=true";
    render(<Capture />);
    expect((screen.getByLabelText("URL") as HTMLInputElement).value).toBe(
      "https://text-url.com",
    );
  });

  it("auto-saves when urlParam exists and noAutoSave is not present", async () => {
    vi.useFakeTimers();
    try {
      window.location.hash = "#url=https://auto.com&title=Auto%20Title";
      render(<Capture />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(initDBMock).toHaveBeenCalled();
      expect(mockBookmarksInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringMatching(/^https:\/\/auto\.com/),
          title: "Auto Title",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

it("does not duplicate the bookmark if the user saves manually before the auto-save", async () => {
    window.location.hash = "#url=https://auto.com&title=Auto%20Title";
    render(<Capture />);
    const btn = screen.getByText("saveToForge").closest("button")!;
    await userEvent.click(btn);
    await waitFor(() => expect(mockBookmarksInsert).toHaveBeenCalledTimes(1));
    expect(screen.getByText("savedTitle")).toBeTruthy();
  });

  it("closes the window after auto-saving with autoClose=true", async () => {
    vi.useFakeTimers();
    try {
      window.location.hash =
        "#url=https://auto.com&title=Auto%20Title&autoClose=true";
      render(<Capture />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(screen.getByText("savedTitle")).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(window.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows invalid URL toast if sanitization fails", async () => {
    mockValidateUrl.mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Capture />);
    const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
    await userEvent.type(urlInput, "javascript:alert(1)");
    const btn = screen.getByText("saveToForge").closest("button")!;
    await userEvent.click(btn);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "Invalid or disallowed URL",
      );
    });
    expect(initDBMock).not.toHaveBeenCalled();
  });

  it("shows quota toast if initDB fails with QuotaExceededError", async () => {
    (initDBMock as any).setError(
      Object.assign(new Error("storage full"), {
        name: "QuotaExceededError",
      }),
    );
    render(<Capture />);
    const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
    await userEvent.type(urlInput, "https://example.com");
    const btn = screen.getByText("saveToForge").closest("button")!;
    await userEvent.click(btn);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "No space left on this device. Free up storage to save.",
      );
    });
    (initDBMock as any).setError(null);
  });

  it("shows the free-limit wall toast (not the generic save error) when the save hits the 1,000 limit", async () => {
    // The preInsert wall rejects the insert with LicenseError;
    // isFreeLimitError is suite-mocked, so flip it for this test.
    mockIsFreeLimitError.mockReturnValue(true);
    (initDBMock as any).setError(new Error("Free plan is limited"));
    render(<Capture />);
    const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
    await userEvent.type(urlInput, "https://example.com");
    const btn = screen.getByText("saveToForge").closest("button")!;
    await userEvent.click(btn);
    await waitFor(() => {
      // Suite's t(key, fallback) returns the fallback copy uninterpolated;
      // asserting on it validates the English fallback string too.
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining("Free holds"),
        expect.objectContaining({ id: "free-limit", duration: 4000 }),
      );
    });
    mockIsFreeLimitError.mockReturnValue(false);
    (initDBMock as any).setError(null);
  });

  it("discards the resolved save after unmount", async () => {
    let resolveInit: (value: unknown) => void;
    (initDBMock as any).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInit = resolve;
        }),
    );
    const { unmount } = render(<Capture />);
    const urlInput = screen.getByLabelText("URL") as HTMLInputElement;
    await userEvent.type(urlInput, "https://example.com");
    const btn = screen.getByText("saveToForge").closest("button")!;
    await userEvent.click(btn);
    unmount();

    await act(async () => {
      resolveInit!({ bookmarks: { insert: mockBookmarksInsert } });
    });

    expect(mockBookmarksInsert).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
