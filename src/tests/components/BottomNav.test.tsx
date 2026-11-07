import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

const { BottomNav } = await import("../../components/BottomNav");

describe("BottomNav", () => {
  it("renders navigation buttons", () => {
    const { getByText } = render(
      <BottomNav
        activeTab="dashboard"
        setActiveTab={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenSearch={vi.fn()}
      />,
    );
    expect(getByText("app_dashboard")).toBeTruthy();
    expect(getByText("app_documents")).toBeTruthy();
    expect(getByText("app_bookmarksTitle")).toBeTruthy();
  });

  it("destaca tab activo", () => {
    const { container } = render(
      <BottomNav
        activeTab="documents"
        setActiveTab={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenSearch={vi.fn()}
      />,
    );
    const buttons = container.querySelectorAll("button");
    const activeBtn = Array.from(buttons).find((b) =>
      b.className.includes("ds-text-accent"),
    );
    expect(activeBtn).toBeTruthy();
    expect(activeBtn?.textContent).toContain("app_documents");
  });

  it("calls setActiveTab when clicked", async () => {
    const setActive = vi.fn();
    const { getByText } = render(
      <BottomNav
        activeTab="dashboard"
        setActiveTab={setActive}
        onOpenSettings={vi.fn()}
        onOpenSearch={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_documents"));
    expect(setActive).toHaveBeenCalledWith("documents");
  });

  it("calls onOpenSearch when clicking search", async () => {
    const onSearch = vi.fn();
    const { getByText } = render(
      <BottomNav
        activeTab="dashboard"
        setActiveTab={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenSearch={onSearch}
      />,
    );
    await userEvent.click(getByText("app_search"));
    expect(onSearch).toHaveBeenCalled();
  });

  it("calls onOpenSettings when clicking settings", async () => {
    const onSettings = vi.fn();
    const { getByText } = render(
      <BottomNav
        activeTab="dashboard"
        setActiveTab={vi.fn()}
        onOpenSettings={onSettings}
        onOpenSearch={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_settings"));
    expect(onSettings).toHaveBeenCalled();
  });
});
