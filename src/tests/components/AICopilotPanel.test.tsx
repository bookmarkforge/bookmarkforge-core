import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

const { default: AICopilotPanel } =
  await import("../../components/BlockEditorParts/AICopilotPanel");

describe("AICopilotPanel", () => {
  it("returns null when isOpen is false", () => {
    const { container } = render(
      <AICopilotPanel
        isOpen={false}
        onClose={vi.fn()}
        isThinking={false}
        onAction={vi.fn()}
      />,
    );
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("renders buttons when isOpen is true", () => {
    const { getByText } = render(
      <AICopilotPanel
        isOpen={true}
        onClose={vi.fn()}
        isThinking={false}
        onAction={vi.fn()}
      />,
    );
    expect(getByText("app_summarizeAll")).toBeTruthy();
    expect(getByText("app_improveWriting")).toBeTruthy();
    expect(getByText("app_continueWriting")).toBeTruthy();
    expect(getByText("app_translate")).toBeTruthy();
    expect(getByText("app_fixGrammar")).toBeTruthy();
  });

  it("calls onAction with summarize when clicking summarize", async () => {
    const onAction = vi.fn();
    const { getByText } = render(
      <AICopilotPanel
        isOpen={true}
        onClose={vi.fn()}
        isThinking={false}
        onAction={onAction}
      />,
    );
    await userEvent.click(getByText("app_summarizeAll"));
    expect(onAction).toHaveBeenCalledWith("summarize");
  });

  it("calls onAction with improve when clicking improve", async () => {
    const onAction = vi.fn();
    const { getByText } = render(
      <AICopilotPanel
        isOpen={true}
        onClose={vi.fn()}
        isThinking={false}
        onAction={onAction}
      />,
    );
    await userEvent.click(getByText("app_improveWriting"));
    expect(onAction).toHaveBeenCalledWith("improve");
  });

  it("calls onAction with translate when clicking translate", async () => {
    const onAction = vi.fn();
    const { getByText } = render(
      <AICopilotPanel
        isOpen={true}
        onClose={vi.fn()}
        isThinking={false}
        onAction={onAction}
      />,
    );
    await userEvent.click(getByText("app_translate"));
    expect(onAction).toHaveBeenCalledWith("translate");
  });

  it("calls onAction with continue when clicking continue", async () => {
    const onAction = vi.fn();
    const { getByText } = render(
      <AICopilotPanel
        isOpen={true}
        onClose={vi.fn()}
        isThinking={false}
        onAction={onAction}
      />,
    );
    await userEvent.click(getByText("app_continueWriting"));
    expect(onAction).toHaveBeenCalledWith("continue");
  });

  it("calls onAction with fix when clicking fix", async () => {
    const onAction = vi.fn();
    const { getByText } = render(
      <AICopilotPanel
        isOpen={true}
        onClose={vi.fn()}
        isThinking={false}
        onAction={onAction}
      />,
    );
    await userEvent.click(getByText("app_fixGrammar"));
    expect(onAction).toHaveBeenCalledWith("fix");
  });

  it("disables action buttons when isThinking is true", () => {
    render(
      <AICopilotPanel
        isOpen={true}
        onClose={vi.fn()}
        isThinking={true}
        onAction={vi.fn()}
      />,
    );
    const buttons = document.querySelectorAll("button");
    const actionButtons = Array.from(buttons).filter(
      (b) => !b.className.includes("md:hidden"),
    );
    actionButtons.forEach((btn) => {
      expect(btn.hasAttribute("disabled")).toBe(true);
    });
  });

  it("shows loader when isThinking is true", () => {
    const { getByText } = render(
      <AICopilotPanel
        isOpen={true}
        onClose={vi.fn()}
        isThinking={true}
        onAction={vi.fn()}
      />,
    );
    expect(getByText(/app_processing/)).toBeTruthy();
  });

  it("calls onClose when clicking the X button", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <AICopilotPanel
        isOpen={true}
        onClose={onClose}
        isThinking={false}
        onAction={vi.fn()}
      />,
    );
    const closeButton = container.querySelector("button");
    expect(closeButton).toBeTruthy();
    if (closeButton) await userEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });
});
