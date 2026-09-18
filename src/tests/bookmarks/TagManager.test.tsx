import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", (() => ({
  useTranslation: () => ({ t: (s: string) => s }),
})) as any);
vi.mock("lucide-react", (() => ({
  X: () => <span data-testid="x-icon">X</span>,
  Plus: () => <span>+</span>,
  Tag: () => <span>#</span>,
  Sparkles: () => <span data-testid="sparkles-icon">✨</span>,
  Loader2: () => <span>⏳</span>,
  Palette: () => <span data-testid="palette-icon">🎨</span>,
})) as any);

const mockGenerateText = vi
  .fn()
  .mockResolvedValue({ text: "ai-tag-1,ai-tag-2" });
vi.mock(import("../../services/ai/ProviderManager"), (() => ({
  aiManager: { generateText: mockGenerateText },
})) as any);

const mockGetTagColor = vi.fn((tag: string) => "#ff0000");
const mockGetColorPalette = vi.fn(() => ["#ff0000", "#00ff00", "#0000ff"]);
const mockSetTagColor = vi.fn();
const mockRemoveTagColor = vi.fn();
vi.mock("../../services/TagColorService", (() => ({
  tagColorService: {
    getTagColor: (tag: string) => mockGetTagColor(tag),
    getColorPalette: () => mockGetColorPalette(),
    setTagColor: (tag: string, color: string) => mockSetTagColor(tag, color),
    removeTagColor: (tag: string) => mockRemoveTagColor(tag),
  },
})) as any);

const mockSanitizeTags = vi.fn((tags: string[]) => tags);
vi.mock("../../services/SanitizationService", (() => ({
  sanitizeTags: ((...args: any[]) => (mockSanitizeTags as any)(...args)) as any,
})) as any);

const { TagManager, ExpandedTagManager } =
  await import("../../components/bookmarks/TagManager");

describe("TagManager - getContrastColor branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTagColor.mockReturnValue("#ff0000");
  });

  it("renders tag with bright color (luminance > 0.5)", () => {
    mockGetTagColor.mockImplementation(((tag: string): any => {
      if (tag === "bright") return "#ffffff";
      return "#111111";
    }) as any);
    const { getByText } = render(
      <TagManager
        tags={["bright", "dark"]}
        allTags={["bright", "dark"]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    expect(getByText("bright")).toBeTruthy();
    expect(getByText("dark")).toBeTruthy();
  });

  it("renders tag without color when getTagColor returns falsy", () => {
    mockGetTagColor.mockReturnValue(undefined as any);
    const { getByText } = render(
      <TagManager
        tags={["nc"]}
        allTags={["nc"]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    expect(getByText("nc")).toBeTruthy();
  });
});

describe("TagManager - input value changes reset selectedIndex", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resets selectedIndex to 0 when input value changes", async () => {
    const onAddTag = vi.fn();
    const { getByLabelText, getByText } = render(
      <TagManager
        tags={[]}
        allTags={["apple", "apricot", "banana"]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "ap");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{ArrowDown}");
    // Clear then re-type to replace value for new suggestion filter
    await userEvent.clear(input);
    await userEvent.type(input, "ba");
    await userEvent.keyboard("{Enter}");
    expect(onAddTag).toHaveBeenCalledWith("banana");
  });
});

describe("TagManager - no suggestions available on Enter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not add tag when Enter pressed with empty input and no suggestions", async () => {
    const onAddTag = vi.fn();
    const { getByLabelText, getByText } = render(
      <TagManager
        tags={["only"]}
        allTags={["only"]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.click(input);
    await userEvent.keyboard("{Enter}");
    expect(onAddTag).not.toHaveBeenCalled();
  });
});

describe("TagManager - blur handler branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds tag on blur when input has value and suggestion was not clicked", async () => {
    const onAddTag = vi.fn();
    const { getByLabelText, getByText } = render(
      <TagManager
        tags={[]}
        allTags={["tag1", "tag2"]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "newtag");
    fireEvent.blur(input);
    await waitFor(() => {
      expect(onAddTag).toHaveBeenCalledWith("newtag");
    });
  });

  it("does not add tag on blur when input is empty", async () => {
    const onAddTag = vi.fn();
    const { getByLabelText, getByText } = render(
      <TagManager
        tags={[]}
        allTags={["tag1", "tag2"]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    fireEvent.blur(input);
    // Let component's internal async blur handler settle
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(onAddTag).not.toHaveBeenCalled();
  });

  it("does not add tag on blur when input has only whitespace", async () => {
    const onAddTag = vi.fn();
    const { getByLabelText, getByText } = render(
      <TagManager
        tags={[]}
        allTags={["tag1", "tag2"]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "   ");
    fireEvent.blur(input);
    // Let component's internal async blur handler settle
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(onAddTag).not.toHaveBeenCalled();
  });
});

describe("TagManager - suggestion click and keyboard handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clicking a suggestion adds it", async () => {
    const onAddTag = vi.fn();
    const { getByLabelText, getByText } = render(
      <TagManager
        tags={[]}
        allTags={["alpha", "beta", "gamma"]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "a");
    const suggestion = getByText("alpha");
    fireEvent.mouseDown(suggestion);
    expect(onAddTag).toHaveBeenCalledWith("alpha");
  });

  it("pressing Enter on a suggestion div adds it", async () => {
    const onAddTag = vi.fn();
    const { getByLabelText, getByText, container } = render(
      <TagManager
        tags={[]}
        allTags={["alpha", "beta", "gamma"]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "a");
    const suggestionDiv = container.querySelector(
      '[role="button"]',
    ) as HTMLElement;
    fireEvent.keyDown(suggestionDiv, {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      preventDefault: () => {},
    });
    expect(onAddTag).toHaveBeenCalledWith("alpha");
  });

  it("pressing Space on a suggestion div adds it", async () => {
    const onAddTag = vi.fn();
    const { getByLabelText, getByText, container } = render(
      <TagManager
        tags={[]}
        allTags={["alpha", "beta", "gamma"]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "a");
    const suggestionDiv = container.querySelector(
      '[role="button"]',
    ) as HTMLElement;
    fireEvent.keyDown(suggestionDiv, {
      key: " ",
      code: "Space",
      keyCode: 32,
      preventDefault: () => {},
    });
    expect(onAddTag).toHaveBeenCalledWith("alpha");
  });

  it("pressing other keys on suggestion does nothing", async () => {
    const onAddTag = vi.fn();
    const { getByLabelText, getByText, container } = render(
      <TagManager
        tags={[]}
        allTags={["alpha", "beta", "gamma"]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "a");
    const suggestionDiv = container.querySelector(
      '[role="button"]',
    ) as HTMLElement;
    fireEvent.keyDown(suggestionDiv, {
      key: "Tab",
      code: "Tab",
      keyCode: 9,
      preventDefault: () => {},
    });
    expect(onAddTag).not.toHaveBeenCalled();
  });

  it("ArrowDown does not go past last suggestion", async () => {
    const onAddTag = vi.fn();
    const { getByLabelText, getByText } = render(
      <TagManager
        tags={[]}
        allTags={["alpha", "beta", "gamma"]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "a");
    for (let i = 0; i < 10; i++) {
      await userEvent.keyboard("{ArrowDown}");
    }
    await userEvent.keyboard("{Enter}");
    expect(onAddTag).toHaveBeenCalledWith("gamma");
  });

  it("ArrowUp does not go below 0", async () => {
    const onAddTag = vi.fn();
    const { getByLabelText, getByText } = render(
      <TagManager
        tags={[]}
        allTags={["alpha", "beta", "gamma"]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "a");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{ArrowUp}");
    await userEvent.keyboard("{ArrowUp}");
    await userEvent.keyboard("{ArrowUp}");
    await userEvent.keyboard("{Enter}");
    expect(onAddTag).toHaveBeenCalledWith("alpha");
  });
});

describe("TagManager - color picker branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTagColor.mockReturnValue("#ff0000");
  });

  it("sets a color and closes picker", async () => {
    const { getByTestId, container } = render(
      <TagManager
        tags={["mytag"]}
        allTags={["mytag"]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByTestId("palette-icon"));
    const colorBtn = container.querySelector(
      'button[title="#00ff00"]',
    ) as HTMLElement;
    await userEvent.click(colorBtn);
    expect(mockSetTagColor).toHaveBeenCalledWith("mytag", "#00ff00");
  });

  it("removes color and closes picker", async () => {
    const { getByTestId, container } = render(
      <TagManager
        tags={["mytag"]}
        allTags={["mytag"]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByTestId("palette-icon"));
    const removeBtn = container.querySelector(
      'button[title="app_removeColor"]',
    ) as HTMLElement;
    await userEvent.click(removeBtn);
    expect(mockRemoveTagColor).toHaveBeenCalledWith("mytag");
  });

  it("clicking palette icon toggles color picker off", async () => {
    const { getByTestId, container } = render(
      <TagManager
        tags={["mytag"]}
        allTags={["mytag"]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByTestId("palette-icon"));
    expect(container.querySelector('button[title="#ff0000"]')).toBeTruthy();
    expect(container.querySelector('button[title="#00ff00"]')).toBeTruthy();
    expect(container.querySelector('button[title="#0000ff"]')).toBeTruthy();
    await userEvent.click(getByTestId("palette-icon"));
    expect(container.querySelector('button[title="#ff0000"]')).toBeNull();
  });
});

describe("TagManager - AI suggestions branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not generate AI suggestions when content is too short", () => {
    render(
      <TagManager
        tags={[]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        content="short"
      />,
    );
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("does not generate AI suggestions when content is undefined", () => {
    render(
      <TagManager
        tags={[]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("discards stale AI suggestions when the content changes", async () => {
    let resolveSuggestions!: (result: { text: string }) => void;
    mockGenerateText.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSuggestions = resolve;
        }),
    );
    const { rerender, queryByText } = render(
      <TagManager
        tags={[]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        content={"First content ".repeat(10)}
      />,
    );
    await waitFor(() => expect(mockGenerateText).toHaveBeenCalled());
    const signal = mockGenerateText.mock.calls[0]?.[2]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);

    rerender(
      <TagManager
        tags={[]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        content={"Second content ".repeat(10)}
      />,
    );
    expect(signal?.aborted).toBe(true);
    resolveSuggestions({ text: "stale-tag" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(queryByText("stale-tag")).toBeNull();
  });

  it("handles AI generation error gracefully", async () => {
    mockGenerateText.mockRejectedValueOnce(new Error("API error"));
    render(
      <TagManager
        tags={[]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        content={"A".repeat(100)}
      />,
    );
    await waitFor(() => {
      expect(mockGenerateText).toHaveBeenCalled();
    });
  });

  it("filters out tags that are too long from AI suggestions", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "ok,very-long-tag-that-exceeds-twenty-characters,also-ok",
    });
    const { getByText, queryByText } = render(
      <TagManager
        tags={[]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        content={"A".repeat(100)}
      />,
    );
    await waitFor(() => {
      expect(getByText("ok")).toBeTruthy();
      expect(getByText("also-ok")).toBeTruthy();
    });
    expect(
      queryByText("very-long-tag-that-exceeds-twenty-characters"),
    ).toBeNull();
  });

  it("filters out empty tags from AI suggestions", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: "good,,  ,another" });
    const { getByText } = render(
      <TagManager
        tags={[]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        content={"A".repeat(100)}
      />,
    );
    await waitFor(() => {
      expect(getByText("good")).toBeTruthy();
      expect(getByText("another")).toBeTruthy();
    });
  });

  it("shows Loader2 icon when generating suggestions", () => {
    mockGenerateText.mockReturnValue(new Promise(() => {})); // never resolves
    const { getByText } = render(
      <TagManager
        tags={[]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        content={"A".repeat(100)}
      />,
    );
    expect(getByText("⏳")).toBeTruthy();
  });

  it("shows input when isAdding is true, hiding AI suggestions", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: "suggested" });
    const { getByText, getByLabelText } = render(
      <TagManager
        tags={[]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        content={"A".repeat(100)}
      />,
    );
    await waitFor(() => {
      expect(getByText("suggested")).toBeTruthy();
    });
    await userEvent.click(getByText("app_tags"));
    expect(getByLabelText("app_newTag")).toBeTruthy();
  });

  it("limits AI suggestions to max 5", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: "a,b,c,d,e,f,g" });
    const { getAllByTestId } = render(
      <TagManager
        tags={[]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        content={"A".repeat(100)}
      />,
    );
    await waitFor(() => {
      const sparklesIcons = getAllByTestId("sparkles-icon");
      expect(sparklesIcons.length).toBeLessThanOrEqual(5);
    });
  });

  it("excludes existing tags from AI suggestions", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: "existing,new" });
    const { getByText, container } = render(
      <TagManager
        tags={["existing"]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        content={"A".repeat(100)}
      />,
    );
    await waitFor(() => {
      expect(getByText("new")).toBeTruthy();
    });
    // 'existing' only appears in tag pills, not in AI suggestion buttons
    const aiButtons = container.querySelectorAll(
      'button[title="app_aiSuggested"]',
    );
    const existingInAI = Array.from(aiButtons).some((btn) =>
      btn.textContent?.includes("existing"),
    );
    expect(existingInAI).toBe(false);
  });
});

describe("TagManager - suggestion filtering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters suggestions to exclude already applied tags", async () => {
    const { getByLabelText, getByText, container } = render(
      <TagManager
        tags={["avail1"]}
        allTags={["avail1", "avail2", "other"]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "avail");
    // Check the suggestion dropdown (not the tag pills)
    const suggestions = container.querySelectorAll('[role="button"]');
    const suggestionTexts = Array.from(suggestions).map((el) => el.textContent);
    expect(suggestionTexts).toContain("avail2");
    expect(suggestionTexts).not.toContain("avail1");
  });

  it("shows at most 5 suggestions", async () => {
    const manyTags = Array.from({ length: 10 }, (_, i) => `tag-${i}`);
    const { getByLabelText, getByText, container } = render(
      <TagManager
        tags={[]}
        allTags={manyTags}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "tag");
    const suggestions = container.querySelectorAll('[role="button"]');
    expect(suggestions.length).toBeLessThanOrEqual(5);
    expect(getByText("tag-0")).toBeTruthy();
  });
});

describe("TagManager - Enter with custom tag sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSanitizeTags.mockImplementation((tags: string[]) => tags);
  });

  it("sanitizes tag input before adding", async () => {
    mockSanitizeTags.mockReturnValueOnce(["sanitized-tag"] as string[]);
    const onAddTag = vi.fn();
    const { getByLabelText, getByText } = render(
      <TagManager
        tags={[]}
        allTags={[]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "raw tag");
    await userEvent.keyboard("{Enter}");
    expect(onAddTag).toHaveBeenCalledWith("sanitized-tag");
  });

  it("does not add tag when sanitization returns empty array", async () => {
    mockSanitizeTags.mockReturnValueOnce([] as any);
    const onAddTag = vi.fn();
    const { getByLabelText, getByText } = render(
      <TagManager
        tags={[]}
        allTags={[]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "<script>");
    await userEvent.keyboard("{Enter}");
    expect(onAddTag).not.toHaveBeenCalled();
  });
});

describe("TagManager - highlight selected suggestion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("applies selected styling to the first suggestion by default", async () => {
    const { getByLabelText, getByText, container } = render(
      <TagManager
        tags={[]}
        allTags={["alpha", "beta"]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_tags"));
    const input = getByLabelText("app_newTag") as HTMLInputElement;
    await userEvent.type(input, "a");
    const suggestionDivs = container.querySelectorAll('[role="button"]');
    expect(suggestionDivs[0]!.className).toContain("bg-blue-50");
    expect(suggestionDivs[1]!.className).toContain(
      "text-[var(--text-secondary)]",
    );
  });
});

// ─── ExpandedTagManager - additional branch coverage ──────────────────────────

describe("ExpandedTagManager - edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTagColor.mockReturnValue("#ff0000");
  });

  it("renders when tags is undefined", () => {
    const { getByText } = render(
      <ExpandedTagManager
        tags={undefined as any}
        allTags={["t1"]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    expect(getByText("app_noTags")).toBeTruthy();
  });

  it("does not show clear button when tags.length is 1", () => {
    const { queryByText } = render(
      <ExpandedTagManager
        tags={["only-one"]}
        allTags={["only-one"]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onClearTags={vi.fn()}
      />,
    );
    expect(queryByText("app_clearTags")).toBeNull();
  });

  it("does not show clear button when onClearTags is not provided", () => {
    const { queryByText } = render(
      <ExpandedTagManager
        tags={["t1", "t2"]}
        allTags={["t1", "t2"]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    expect(queryByText("app_clearTags")).toBeNull();
  });

  it("does not show add button when input is empty", () => {
    const { queryByText } = render(
      <ExpandedTagManager
        tags={[]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    expect(queryByText("app_add")).toBeNull();
  });

  it("shows no matching tags message when search has no results", async () => {
    const { getByText, getByLabelText } = render(
      <ExpandedTagManager
        tags={[]}
        allTags={["tagA"]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    const input = getByLabelText("app_typeTag") as HTMLInputElement;
    await userEvent.type(input, "zzzz");
    expect(getByText("app_noMatchingTags")).toBeTruthy();
  });

  it("Enter key on input with empty value does nothing", async () => {
    const onAddTag = vi.fn();
    const { getByLabelText } = render(
      <ExpandedTagManager
        tags={[]}
        allTags={[]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    const input = getByLabelText("app_typeTag") as HTMLInputElement;
    await userEvent.click(input);
    await userEvent.keyboard("{Enter}");
    expect(onAddTag).not.toHaveBeenCalled();
  });

  it("Enter key on input with only whitespace does nothing", async () => {
    const onAddTag = vi.fn();
    const { getByLabelText } = render(
      <ExpandedTagManager
        tags={[]}
        allTags={[]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    const input = getByLabelText("app_typeTag") as HTMLInputElement;
    await userEvent.type(input, "   ");
    await userEvent.keyboard("{Enter}");
    expect(onAddTag).not.toHaveBeenCalled();
  });

  it("clicking a suggested available tag adds it and clears input", async () => {
    const onAddTag = vi.fn();
    const { getByText } = render(
      <ExpandedTagManager
        tags={[]}
        allTags={["available"]}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );
    await userEvent.click(getByText("available"));
    expect(onAddTag).toHaveBeenCalledWith("available");
  });

  it("shows tag with color from getTagColor", () => {
    mockGetTagColor.mockReturnValue("#ff6600");
    const { getByText } = render(
      <ExpandedTagManager
        tags={["colored"]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    expect(getByText("colored")).toBeTruthy();
  });

  it("shows tag without color when getTagColor returns undefined", () => {
    mockGetTagColor.mockReturnValue(undefined as any);
    const { getByText } = render(
      <ExpandedTagManager
        tags={["nocol"]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    expect(getByText("nocol")).toBeTruthy();
  });

  it("filters available tags by case-insensitive match", async () => {
    const { getByLabelText, getByText } = render(
      <ExpandedTagManager
        tags={[]}
        allTags={["MyTag"]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    const input = getByLabelText("app_typeTag") as HTMLInputElement;
    await userEvent.type(input, "my");
    expect(getByText("MyTag")).toBeTruthy();
  });

  it("limits available tags to 10 when filtering", async () => {
    const manyTags = Array.from({ length: 20 }, (_, i) => `tag${i}`);
    const { getByLabelText, queryByText } = render(
      <ExpandedTagManager
        tags={[]}
        allTags={manyTags}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    const input = getByLabelText("app_typeTag") as HTMLInputElement;
    await userEvent.type(input, "tag");
    expect(queryByText("tag15")).toBeNull();
    expect(queryByText("tag0")).toBeTruthy();
  });

  it("shows up to 15 available tags when no input", () => {
    const manyTags = Array.from({ length: 20 }, (_, i) => `tag${i}`);
    const { queryByText } = render(
      <ExpandedTagManager
        tags={[]}
        allTags={manyTags}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );
    expect(queryByText("tag15")).toBeNull();
    expect(queryByText("tag0")).toBeTruthy();
  });

  it("expanded manager clears all tags when available", async () => {
    const onClearTags = vi.fn();
    const { getByText } = render(
      <ExpandedTagManager
        tags={["alpha", "beta"]}
        allTags={[]}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onClearTags={onClearTags}
      />,
    );
    await userEvent.click(getByText("app_clearTags"));
    expect(onClearTags).toHaveBeenCalled();
  });
});
