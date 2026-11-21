import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBlockEditorState } from "../../components/block-editor/useBlockEditorState";

describe("useBlockEditorState", () => {
  it("returns default initial state", () => {
    const { result } = renderHook(() => useBlockEditorState());
    expect(result.current.initialContent).toBe("empty");
    expect(result.current.docTitle).toBe("");
    expect(result.current.editorText).toBe("");
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.theme).toBe("light");
    expect(result.current.showChat).toBe(false);
    expect(result.current.showHistory).toBe(false);
    expect(result.current.showPreview).toBe(false);
    expect(result.current.showSuggestions).toBe(false);
    expect(result.current.showCopilot).toBe(false);
    expect(result.current.showExpertAgents).toBe(false);
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.lastEmbeddingSavedAt).toBeNull();
    expect(result.current.lastVersionSavedAt).toBeNull();
    expect(result.current.isZenMode).toBe(false);
    expect(result.current.isPrivate).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.editorRef.current).toBeNull();
    expect(result.current.isRemoteUpdateRef.current).toBe(false);
    expect(result.current.isWarmedUpRef.current).toBe(false);
    expect(result.current.handleSuggestionClickRef.current).toBeNull();
  });

  it("updates string state via setters", () => {
    const { result } = renderHook(() => useBlockEditorState());
    act(() => result.current.setDocTitle("My Doc"));
    expect(result.current.docTitle).toBe("My Doc");
    act(() => result.current.setEditorText("Hello world"));
    expect(result.current.editorText).toBe("Hello world");
  });

  it("updates enum state via setters", () => {
    const { result } = renderHook(() => useBlockEditorState());
    act(() => result.current.setInitialContent("loading"));
    expect(result.current.initialContent).toBe("loading");
    act(() => result.current.setSaveStatus("unsaved"));
    expect(result.current.saveStatus).toBe("unsaved");
    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");
  });

  it("toggles boolean flags via setters", () => {
    const { result } = renderHook(() => useBlockEditorState());
    act(() => result.current.setShowChat(true));
    expect(result.current.showChat).toBe(true);
    act(() => result.current.setIsZenMode(true));
    expect(result.current.isZenMode).toBe(true);
    act(() => result.current.setIsPrivate(true));
    expect(result.current.isPrivate).toBe(true);
    act(() => result.current.setError("Something went wrong"));
    expect(result.current.error).toBe("Something went wrong");
  });

  it("refs are stable across renders", () => {
    const { result, rerender } = renderHook(() => useBlockEditorState());
    const ref1 = result.current.editorRef;
    rerender();
    expect(result.current.editorRef).toBe(ref1);
  });
});
