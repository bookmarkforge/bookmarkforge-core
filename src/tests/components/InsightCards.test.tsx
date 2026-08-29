import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) => options?.defaultValue || key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

// No esparcir props de motion (whileHover/variants/...) al DOM: no son
// valid attributes and React emits warnings that mask the real ones.
vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Sparkles: mock("Sparkles"),
    ArrowRight: mock("ArrowRight"),
    Link: mock("Link"),
    Calendar: mock("Calendar"),
  };
});

describe("InsightCards", () => {
  let InsightCards: React.FC<{
    insights: any[];
    onAction: (insight: any) => void;
  }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../components/ai/InsightCards");
    InsightCards = mod.default;
  });

  it("does not render when insights is empty", () => {
    const { container } = render(
      <InsightCards insights={[]} onAction={vi.fn()} />,
    );
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("renders title when there are insights", () => {
    render(
      <InsightCards
        insights={[
          {
            id: "1",
            title: "Insight 1",
            type: "suggestion",
            content: "Content",
            createdAt: new Date().toISOString(),
          },
        ]}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("app_aiSuggestions")).toBeTruthy();
  });

  it("shows the insight title", () => {
    render(
      <InsightCards
        insights={[
          {
            id: "1",
            title: "Test Insight",
            type: "suggestion",
            content: "Content",
            createdAt: new Date().toISOString(),
          },
        ]}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("Test Insight")).toBeTruthy();
  });

  it("shows the insight content", () => {
    render(
      <InsightCards
        insights={[
          {
            id: "1",
            title: "Title",
            type: "connection",
            content: "Content body",
            createdAt: new Date().toISOString(),
          },
        ]}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("Content body")).toBeTruthy();
  });

  it("is keyboard-activatable with Enter and Space", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const insight = {
      id: "keyboard-1",
      title: "Keyboard Insight",
      type: "suggestion",
      content: "Content",
      createdAt: new Date().toISOString(),
    };
    render(<InsightCards insights={[insight]} onAction={onAction} />);
    const card = screen.getByRole("button", { name: /Keyboard Insight/ });
    card.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ }");
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("calls onAction when clicked", async () => {
    const onAction = vi.fn();
    const insight = {
      id: "1",
      title: "Title",
      type: "suggestion",
      content: "Content",
      createdAt: new Date().toISOString(),
    };
    render(<InsightCards insights={[insight]} onAction={onAction} />);
    await userEvent.click(screen.getByText("Title"));
    expect(onAction).toHaveBeenCalledWith(insight);
  });
});
