import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvictionBanner } from "../../../components/dashboard/components/EvictionBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string, _opts?: unknown) => s }),
}));

describe("EvictionBanner", () => {
  it("renders when show is true", () => {
    const { getByText } = render(
      <EvictionBanner
        show={true}
        onDismiss={vi.fn()}
        onConfigureSync={vi.fn()}
      />,
    );
    expect(getByText("app_evictionRiskTitle")).toBeTruthy();
  });

  it("renders collapsed and invisible when show is false", () => {
    const { container } = render(
      <EvictionBanner
        show={false}
        onDismiss={vi.fn()}
        onConfigureSync={vi.fn()}
      />,
    );
    // Always mounted, but costing no layout space and no accessibility
    // surface (ADR-055).
    const banner = container.querySelector(".mb-6") as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.style.height).toBe("0px");
  });

  it("hides the whole subtree from assistive tech while off (not just opacity)", () => {
    const { container } = render(
      <EvictionBanner
        show={false}
        onDismiss={vi.fn()}
        onConfigureSync={vi.fn()}
      />,
    );
    // A safari-risk warning rendered at opacity 0 would still be announced —
    // and its buttons would still take focus — on a platform that has no
    // eviction risk at all. `visibility: hidden` keeps the reserved box while
    // taking the subtree out of the a11y tree and the tab order.
    const banner = container.querySelector(".mb-6") as HTMLElement;
    expect(banner.style.visibility).toBe("hidden");
    expect(screen.getByText("app_evictionRiskTitle")).not.toBeVisible();
    expect(screen.getByText("app_configureCloudSync")).not.toBeVisible();
  });

  it("exposes the banner again as soon as show flips to true", () => {
    const { rerender, container } = render(
      <EvictionBanner
        show={false}
        onDismiss={vi.fn()}
        onConfigureSync={vi.fn()}
      />,
    );
    expect(screen.getByText("app_evictionRiskTitle")).not.toBeVisible();

    rerender(
      <EvictionBanner
        show={true}
        onDismiss={vi.fn()}
        onConfigureSync={vi.fn()}
      />,
    );
    // Asserted on the wrapper's inline style rather than toBeVisible(): the
    // body's opacity is driven by motion's fade-in, which jsdom does not run.
    // Visibility must flip without waiting for the fade, otherwise the banner
    // would animate inside an already-hidden subtree and never appear.
    const banner = container.querySelector(".mb-6") as HTMLElement;
    expect(banner.style.visibility).toBe("visible");
    expect(banner.style.transition).toContain("visibility 0s linear 0ms");
    expect(banner.style.height).not.toBe("0px");
  });

  it("calls onConfigureSync when clicking configure", async () => {
    const onSync = vi.fn();
    const { getByText } = render(
      <EvictionBanner
        show={true}
        onDismiss={vi.fn()}
        onConfigureSync={onSync}
      />,
    );
    await userEvent.click(getByText("app_configureCloudSync"));
    expect(onSync).toHaveBeenCalled();
  });

  it("calls onDismiss when clicking dismiss", async () => {
    const onDismiss = vi.fn();
    const { getByText } = render(
      <EvictionBanner
        show={true}
        onDismiss={onDismiss}
        onConfigureSync={vi.fn()}
      />,
    );
    await userEvent.click(getByText("app_dismissEviction"));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("shows the risk description", () => {
    const { getByText } = render(
      <EvictionBanner
        show={true}
        onDismiss={vi.fn()}
        onConfigureSync={vi.fn()}
      />,
    );
    expect(getByText("app_evictionRiskDesc")).toBeTruthy();
  });
});
