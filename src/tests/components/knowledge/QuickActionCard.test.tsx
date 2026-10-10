import { describe, it, expect, vi } from "vitest";
import type { TFunction } from "i18next";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickActionCard } from "../../../components/knowledge/QuickActionCard";

describe("QuickActionCard", () => {
  const mockT = vi.fn((key: string) => {
    const map: Record<string, string> = {
      app_readyIntelligence: "Ready Intelligence",
      app_readyIntelligenceDesc: "Desc text",
      app_forceReindexation: "Reindex",
    };
    return map[key] || key;
  }) as unknown as TFunction;
  const variants = { hidden: {}, visible: {} };

  const onForceReindex = vi.fn();

  it("renders translated texts", () => {
    const { getByText } = render(
      <QuickActionCard
        cardVariants={variants}
        t={mockT as unknown as TFunction}
        onForceReindex={onForceReindex}
      />,
    );
    expect(getByText("Ready Intelligence")).toBeTruthy();
    expect(getByText("Desc text")).toBeTruthy();
    expect(getByText("Reindex")).toBeTruthy();
  });

  it("renders reindex button", () => {
    const { container } = render(
      <QuickActionCard
        cardVariants={variants}
        t={mockT as unknown as TFunction}
        onForceReindex={onForceReindex}
      />,
    );
    const btn = container.querySelector("button");
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toBe("Reindex");
  });

  it("runs the reindex action", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(
      <QuickActionCard
        cardVariants={variants}
        t={mockT as unknown as TFunction}
        onForceReindex={onForceReindex}
      />,
    );
    await user.click(getByRole("button", { name: "Reindex" }));
    expect(onForceReindex).toHaveBeenCalledTimes(1);
  });

  it("has background styling with a token", () => {
    const { container } = render(
      <QuickActionCard
        cardVariants={variants}
        t={mockT as unknown as TFunction}
        onForceReindex={onForceReindex}
      />,
    );
    const motionDiv = Array.from(container.children).find(
      (el) => el.tagName !== "STYLE",
    )!;
    expect(motionDiv.className).toContain("rounded-[3rem]");
  });
});
