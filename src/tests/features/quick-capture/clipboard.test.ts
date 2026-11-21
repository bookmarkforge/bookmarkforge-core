import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyPastedText,
  isEditableTarget,
  extractClipboardImage,
  buildBookmarkletCode,
  requestQuickCapture,
  consumePendingQuickCapture,
  QUICK_CAPTURE_EVENT,
  NOTE_PASTE_MIN_CHARS,
} from "../../../features/quick-capture/clipboard";

describe("classifyPastedText", () => {
  it("classifies http(s) URLs as url", () => {
    expect(classifyPastedText("https://example.com/a?b=1")).toBe("url");
    expect(classifyPastedText("  http://example.com  ")).toBe("url");
  });

  it("classifies bare domains as url", () => {
    expect(classifyPastedText("example.com/path")).toBe("url");
    expect(classifyPastedText("sub.example.co.uk?q=1")).toBe("url");
  });

  it("classifies long plain text as note", () => {
    const long = "a".repeat(NOTE_PASTE_MIN_CHARS);
    expect(classifyPastedText(long)).toBe("note");
  });

  it("returns empty for short non-URL text and blank input", () => {
    expect(classifyPastedText("hello world")).toBe("empty");
    expect(classifyPastedText("   ")).toBe("empty");
    expect(classifyPastedText(`${"a".repeat(NOTE_PASTE_MIN_CHARS - 1)}`)).toBe(
      "empty",
    );
  });
});

describe("isEditableTarget", () => {
  it("detects inputs, textareas and contentEditable", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const div = document.createElement("div");
    div.contentEditable = "true";
    const plain = document.createElement("div");

    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(div)).toBe(true);
    expect(isEditableTarget(plain)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("extractClipboardImage", () => {
  const file = new File(["x"], "p.png", { type: "image/png" });

  it("returns the first image item", () => {
    const items = [
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/png", getAsFile: () => file },
    ];
    const result = extractClipboardImage(items);
    expect(result?.blob).toBe(file);
    expect(result?.filename).toBe("pasted-image.png");
  });

  it("returns null when no image item exists", () => {
    const items = [
      { kind: "string", type: "text/plain", getAsFile: () => null },
    ];
    expect(extractClipboardImage(items)).toBeNull();
  });
});

describe("buildBookmarkletCode", () => {
  it("embeds payload in the URL fragment, never the query string", () => {
    const code = buildBookmarkletCode("https://www.bookmarkforgeapp.com/");
    expect(code).toContain("javascript:(function()");
    expect(code).toContain("/capture#");
    expect(code).toContain("noAutoSave=true");
    expect(code).not.toContain("/capture?");
    expect(code).toContain("encodeURIComponent(location.href)");
    expect(code).toContain("getSelection()");
  });

  it("strips trailing slashes from the origin", () => {
    const code = buildBookmarkletCode("http://localhost:5173//");
    expect(code).toContain("http://localhost:5173/capture#");
  });
});

describe("quick-capture request parking", () => {
  beforeEach(() => {
    consumePendingQuickCapture();
  });

  it("dispatches the window event and parks the request", () => {
    const listener = vi.fn();
    window.addEventListener(QUICK_CAPTURE_EVENT, listener);
    requestQuickCapture("https://a.com");
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(QUICK_CAPTURE_EVENT, listener);

    const pending = consumePendingQuickCapture();
    expect(pending?.input).toBe("https://a.com");
    expect(consumePendingQuickCapture()).toBeNull();
  });
});
