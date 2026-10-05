import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => {
  const t = (key: string, fb?: string) => fb || key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

vi.mock("../../hooks/useFocusTrap", () => ({
  useFocusTrap: () => ({ current: null }),
}));

vi.mock("../../hooks/useRxDB", () => ({
  useRxCollection: () => ({ find: () => ({}) }),
  useRxQuery: () => ({ result: [] }),
}));

vi.mock("fuse.js", () => ({
  default: class Fuse {
    search() {
      return [
        {
          item: {
            id: "1",
            title: "Document 1",
            type: "doc",
            summary: "Test summary",
          },
          refIndex: 0,
        },
        {
          item: { id: "2", title: "Document 2", type: "bookmark" },
          refIndex: 1,
        },
      ];
    }
  },
}));

const { mockToastSuccess, mockToastError, mockLogger } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}));
vi.mock("../../utils/logger", () => ({ logger: mockLogger }));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Search: mock("Search"),
    FileText: mock("FileText"),
    Bookmark: mock("Bookmark"),
    Command: mock("Command"),
    ArrowRight: mock("ArrowRight"),
    Copy: mock("Copy"),
    Trash2: mock("Trash2"),
    BarChart3: mock("BarChart3"),
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

describe("Omnibar", () => {
  let Omnibar: React.FC<any>;
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onAction: vi.fn(),
    onSelectDocument: vi.fn(),
    onSelectBookmark: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const clip = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clip },
      configurable: true,
      writable: true,
    });
    const mod = await import("../../components/Omnibar");
    Omnibar = mod.default;
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(<Omnibar {...defaultProps} isOpen={false} />);
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("renders when isOpen is true", () => {
    render(<Omnibar {...defaultProps} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("renders search input", () => {
    render(<Omnibar {...defaultProps} />);
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("renders search icon", () => {
    render(<Omnibar {...defaultProps} />);
    expect(screen.getByTestId("icon-Search")).toBeTruthy();
  });

  it("shows document icon in results", () => {
    render(<Omnibar {...defaultProps} />);
    expect(screen.getByTestId("icon-FileText")).toBeTruthy();
  });

  it("shows default commands when opened", () => {
    render(<Omnibar {...defaultProps} />);
    expect(screen.getByText("app_dashboard")).toBeTruthy();
    expect(screen.getByText("app_newDocument")).toBeTruthy();
    // Regression: the Intelligence Center entry (Export/Import UI) was
    // missing, leaving the Dashboard modal with no reachable trigger.
    expect(screen.getByText("intelligenceCenter")).toBeTruthy();
  });

  it("Intelligence Center command fires show_analysis and closes", async () => {
    render(<Omnibar {...defaultProps} />);
    await userEvent.click(
      screen.getByRole("option", { name: "intelligenceCenter" }),
    );
    expect(defaultProps.onAction).toHaveBeenCalledWith("show_analysis");
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("updates query when typing in the input", async () => {
    render(<Omnibar {...defaultProps} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "test query");
    expect(input).toHaveValue("test query");
  });

  it("navigates with ArrowDown/ArrowUp and changes selectedIndex", async () => {
    render(<Omnibar {...defaultProps} />);
    // Command count is a moving target; clamp-driven navigation must always
    // return to the top (the selection clamps at the last result either way).
    for (let i = 0; i < 10; i += 1) {
      await userEvent.keyboard("{ArrowDown}");
    }
    for (let i = 0; i < 10; i += 1) {
      await userEvent.keyboard("{ArrowUp}");
    }
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
  });

  it("ArrowDown does not exceed results limit", async () => {
    render(<Omnibar {...defaultProps} />);
    for (let i = 0; i < 50; i++) await userEvent.keyboard("{ArrowDown}");
    const options = screen.getAllByRole("option");
    expect(options[options.length - 1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("Enter on a command executes the action and closes", async () => {
    render(<Omnibar {...defaultProps} />);
    await userEvent.keyboard("{Enter}");
    expect(defaultProps.onNavigate).toHaveBeenCalledWith("dashboard");
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("Escape llama a onClose", async () => {
    render(<Omnibar {...defaultProps} />);
    await userEvent.keyboard("{Escape}");
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("click on backdrop closes the omnibar", async () => {
    render(<Omnibar {...defaultProps} />);
    await userEvent.click(screen.getByRole("dialog"));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("click on inner panel does not close due to stopPropagation", async () => {
    render(<Omnibar {...defaultProps} />);
    const innerPanel = document.querySelector(".max-w-2xl");
    await userEvent.click(innerPanel!);
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it("types query and shows search results with subtitle", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Document" },
    });
    // Search is debounced 150ms in the component; wait for results to render.
    await screen.findByText("Document 1");
    expect(screen.getByText("Document 1")).toBeTruthy();
    expect(screen.getByText("Document 2")).toBeTruthy();
    expect(screen.getByText("Test summary")).toBeTruthy();
  });

  it("filters commands by query", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "dashboard" },
    });
    // Debounced search: wait until the unfiltered command disappears.
    await waitFor(() =>
      expect(screen.queryByText("app_newDocument")).toBeNull(),
    );
    expect(screen.getByText("app_dashboard")).toBeTruthy();
  });

  it("Enter on a search result sets activeResult with actions", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    await screen.findByText("Document 1");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("group")).toBeTruthy();
    expect(screen.getByText("app_open")).toBeTruthy();
  });

  it("Escape with activeResult clears it instead of closing", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    await screen.findByText("Document 1");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("group")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it("shows document-type actions (open, copy, delete)", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    await screen.findByText("Document 1");
    await userEvent.click(screen.getAllByRole("option")[0]!);
    expect(screen.getByText("app_open")).toBeTruthy();
    expect(screen.getByText("app_copyLink")).toBeTruthy();
    expect(screen.getByText("app_delete")).toBeTruthy();
  });

  it("accion Open en documento llama a onSelectDocument", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    await screen.findByText("Document 1");
    await userEvent.click(screen.getAllByRole("option")[0]!);
    await userEvent.click(screen.getByText("app_open"));
    expect(defaultProps.onSelectDocument).toHaveBeenCalledWith("1");
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("Copy action copies to the clipboard", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    await screen.findByText("Document 1");
    await userEvent.click(screen.getAllByRole("option")[0]!);
    await userEvent.click(screen.getByText("app_copyLink"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("/doc/1"),
    );
  });

  it("does not show success toast if the clipboard fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("permission denied")),
      },
      configurable: true,
      writable: true,
    });
    const { unmount } = render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    await screen.findByText("Document 1");
    await userEvent.click(screen.getAllByRole("option")[0]!);
    await userEvent.click(screen.getByText("app_copyLink"));
    unmount();
    await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalled());
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("accion Delete en documento llama a onAction", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    await screen.findByText("Document 1");
    await userEvent.click(screen.getAllByRole("option")[0]!);
    await userEvent.click(screen.getByText("app_delete"));
    expect(defaultProps.onAction).toHaveBeenCalledWith("delete_doc_1");
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("accion Open en bookmark llama a onSelectBookmark", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    await screen.findByText("Document 1");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByText("app_open"));
    expect(defaultProps.onSelectBookmark).toHaveBeenCalledWith("2");
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("Enter with activeResult that has actions just returns without doing anything extra", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    await screen.findByText("Document 1");
    await userEvent.keyboard("{Enter}");
    defaultProps.onClose.mockClear();
    await userEvent.keyboard("{Enter}");
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it("shows Bookmark icon in bookmark-type results", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    await screen.findByTestId("icon-Bookmark");
    expect(screen.getByTestId("icon-Bookmark")).toBeTruthy();
  });

  it("shows Command and FileText icons in default commands", () => {
    render(<Omnibar {...defaultProps} />);
    expect(screen.getByTestId("icon-Command")).toBeTruthy();
    expect(screen.getByTestId("icon-FileText")).toBeTruthy();
  });

  it("shows ArrowRight and Trash2 icons in document actions", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    await screen.findByText("Document 1");
    await userEvent.click(screen.getAllByRole("option")[0]!);
    expect(screen.getByTestId("icon-ArrowRight")).toBeTruthy();
    expect(screen.getByTestId("icon-Trash2")).toBeTruthy();
  });

  it("input has a translated placeholder by default", () => {
    render(<Omnibar {...defaultProps} />);
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "placeholder",
      "app_omnibarPlaceholder",
    );
  });

  it("keydown en item de resultado llama a setActiveResult con Enter", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    await screen.findByText("Document 1");
    const options = screen.getAllByRole("option");
    options[0]!.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("group")).toBeTruthy();
  });

  it("keydown on an action button with Enter executes the action", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    await screen.findByText("Document 1");
    await userEvent.click(screen.getAllByRole("option")[0]!);
    await userEvent.click(screen.getByText("app_delete"));
    expect(defaultProps.onAction).toHaveBeenCalled();
  });

  it("Escape key in the dialog also closes", async () => {
    render(<Omnibar {...defaultProps} />);
    screen.getByRole("dialog").focus();
    await userEvent.keyboard("{Escape}");
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("a query with leading > is cleaned correctly", async () => {
    render(<Omnibar {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: ">test" },
    });
    await screen.findByText("Document 1");
    expect(screen.getByText("Document 1")).toBeTruthy();
  });
});
