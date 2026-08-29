import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
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

  it("renders but is hidden when show is false (CLS optimization)", () => {
    const { container } = render(
      <EvictionBanner
        show={false}
        onDismiss={vi.fn()}
        onConfigureSync={vi.fn()}
      />,
    );
    // Banner always renders (reserves space for CLS) but is invisible
    const banner = container.querySelector(".mb-6");
    expect(banner).toBeTruthy();
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
