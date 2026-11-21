import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) => options?.defaultValue || key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

vi.mock("../../components/VoiceCommandCenter", () => ({
  default: ({ onSearch, onNavigate, onAction, showFloatingButton }: any) => {
    (globalThis as any).__capturedOnAction = onAction;
    return (
      <div data-testid="voice-command-center">
        <span data-testid="show-floating">{String(showFloatingButton)}</span>
        <span data-testid="has-on-search">{String(!!onSearch)}</span>
        <span data-testid="has-on-navigate">{String(!!onNavigate)}</span>
        <span data-testid="has-on-action">{String(!!onAction)}</span>
      </div>
    );
  },
}));

describe("VoiceCommandCenterWrapper", () => {
  let VoiceCommandCenterWrapper: React.FC<{
    onSearch: (query: string) => void;
    onNavigate: (page: string) => void;
    onAction: (
      action: string,
      params: Record<string, unknown>,
    ) => Promise<void>;
  }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../components/VoiceCommandCenterWrapper");
    VoiceCommandCenterWrapper = mod.VoiceCommandCenterWrapper;
  });

  it("renders VoiceCommandCenter", () => {
    render(
      <VoiceCommandCenterWrapper
        onSearch={vi.fn()}
        onNavigate={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("voice-command-center")).toBeTruthy();
  });

  it("pasa showFloatingButton=false", () => {
    render(
      <VoiceCommandCenterWrapper
        onSearch={vi.fn()}
        onNavigate={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("show-floating").textContent).toBe("false");
  });

  it("pasa las props onSearch, onNavigate, onAction", () => {
    render(
      <VoiceCommandCenterWrapper
        onSearch={vi.fn()}
        onNavigate={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("has-on-search").textContent).toBe("true");
    expect(screen.getByTestId("has-on-navigate").textContent).toBe("true");
    expect(screen.getByTestId("has-on-action").textContent).toBe("true");
  });

  it("handleAction calls onAction with explicit params", async () => {
    const onAction = vi.fn();
    render(
      <VoiceCommandCenterWrapper
        onSearch={vi.fn()}
        onNavigate={vi.fn()}
        onAction={onAction}
      />,
    );
    const captured = (globalThis as any).__capturedOnAction;
    captured("search", { query: "test" });
    expect(onAction).toHaveBeenCalledWith("search", { query: "test" });
  });

  it("handleAction uses {} when params is undefined", async () => {
    const onAction = vi.fn();
    render(
      <VoiceCommandCenterWrapper
        onSearch={vi.fn()}
        onNavigate={vi.fn()}
        onAction={onAction}
      />,
    );
    const captured = (globalThis as any).__capturedOnAction;
    captured("navigate"); // no params
    expect(onAction).toHaveBeenCalledWith("navigate", {});
  });
});
