import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return { Shield: mock("Shield"), Save: mock("Save") };
});

const mockT = vi.fn(
  (key: string, options?: any) => options?.defaultValue || key,
);

describe("CustomPromptsSection", () => {
  let CustomPromptsSection: React.FC<{
    customPrompts: { summarize: string; tagging: string; chat: string };
    setCustomPrompts: (p: {
      summarize: string;
      tagging: string;
      chat: string;
    }) => void;
    handleSavePrompts: () => void;
    t: any;
  }>;

  const defaultPrompts = {
    summarize: "summarize this",
    tagging: "tag this",
    chat: "chat",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod =
      await import("../../../components/settings/CustomPromptsSection");
    CustomPromptsSection = mod.CustomPromptsSection;
  });

  it("renders title", () => {
    render(
      <CustomPromptsSection
        customPrompts={defaultPrompts}
        setCustomPrompts={vi.fn()}
        handleSavePrompts={vi.fn()}
        t={mockT}
      />,
    );
    expect(screen.getByText("app_customSystemPrompts")).toBeTruthy();
  });

  it("renders 3 textareas", () => {
    render(
      <CustomPromptsSection
        customPrompts={defaultPrompts}
        setCustomPrompts={vi.fn()}
        handleSavePrompts={vi.fn()}
        t={mockT}
      />,
    );
    expect(screen.getByLabelText("app_summarizePromptLabel")).toBeTruthy();
    expect(screen.getByLabelText("app_taggingPromptLabel")).toBeTruthy();
    expect(screen.getByLabelText("app_chatPromptLabel")).toBeTruthy();
  });

  it("shows initial values", () => {
    render(
      <CustomPromptsSection
        customPrompts={defaultPrompts}
        setCustomPrompts={vi.fn()}
        handleSavePrompts={vi.fn()}
        t={mockT}
      />,
    );
    expect(screen.getByDisplayValue("summarize this")).toBeTruthy();
    expect(screen.getByDisplayValue("tag this")).toBeTruthy();
    expect(screen.getByDisplayValue("chat")).toBeTruthy();
  });

  it("calls setCustomPrompts on textarea change", () => {
    const setter = vi.fn();
    render(
      <CustomPromptsSection
        customPrompts={defaultPrompts}
        setCustomPrompts={setter}
        handleSavePrompts={vi.fn()}
        t={mockT}
      />,
    );
    fireEvent.change(screen.getByLabelText("app_summarizePromptLabel"), {
      target: { value: "new summary" },
    });
    expect(setter).toHaveBeenCalledWith({
      ...defaultPrompts,
      summarize: "new summary",
    });
  });

  it("calls handleSavePrompts on save click", async () => {
    const handleSave = vi.fn();
    render(
      <CustomPromptsSection
        customPrompts={defaultPrompts}
        setCustomPrompts={vi.fn()}
        handleSavePrompts={handleSave}
        t={mockT}
      />,
    );
    await userEvent.click(screen.getByText("app_save"));
    expect(handleSave).toHaveBeenCalled();
  });
});
