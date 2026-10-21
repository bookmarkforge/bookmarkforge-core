import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { getActiveProPrice } from "../../constants/pricing";
import { ProRequiredState } from "../../components/ProRequiredState";

// Interpolating t() mock: assertions below check the rendered copy (feature
// name, price, refund days) rather than raw keys.
const t = (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
  const fallback =
    typeof fallbackOrOpts === "string" ? fallbackOrOpts : undefined;
  const interpolations = (opts ?? fallbackOrOpts) as
    | Record<string, unknown>
    | undefined;
  if (!interpolations) return fallback ?? key;
  return (fallback ?? key).replace(
    /\{\{(\w+)\}\}/g,
    (_m, name: string) => String(interpolations[name] ?? `{{${name}}}`),
  );
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t }),
}));

vi.mock("lucide-react", () => {
  const mock =
    (name: string) =>
    (props: Record<string, unknown>) =>
      <svg data-testid={`icon-${name}`} {...props} />;
  return {
    ShieldCheck: mock("ShieldCheck"),
    ArrowRight: mock("ArrowRight"),
  };
});

describe("ProRequiredState", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("names the feature and quotes the real price and refund terms", () => {
    render(
      <ProRequiredState feature="Expert agents" onSeePro={vi.fn()} />,
    );
    const state = screen.getByTestId("pro-required-state");
    expect(state.textContent).toContain("Expert agents is part of Pro");
    // Price comes from PRICING_CONFIG via getActiveProPrice — the same source
    // as the Free wall, so the CTA cannot drift from the pricing table.
    expect(state.textContent).toContain(`See Pro — ${getActiveProPrice()} once`);
    expect(state.textContent).toContain("money-back guarantee");
  });

  it("renders the license reason body by default and the build body when asked", () => {
    const { rerender } = render(
      <ProRequiredState feature="Flashcards" reason="license" onSeePro={vi.fn()} />,
    );
    expect(screen.getByTestId("pro-required-state").textContent).toContain(
      "one-time Pro license",
    );

    rerender(
      <ProRequiredState feature="Flashcards" reason="build" onSeePro={vi.fn()} />,
    );
    expect(screen.getByTestId("pro-required-state").textContent).toContain(
      "This build ships without the Pro implementation",
    );
  });

  it("defaults onSeePro to the forge:open-settings bridge", async () => {
    const listener = vi.fn();
    const spy = vi.spyOn(window, "dispatchEvent").mockImplementation((ev) => {
      listener(ev);
      return true;
    });
    render(<ProRequiredState feature="P2P sync" />);
    await userEvent.click(screen.getByRole("button"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]![0] as CustomEvent).type).toBe(
      "forge:open-settings",
    );
    spy.mockRestore();
  });

  it("uses the provided onSeePro instead of the bridge", async () => {
    const onSeePro = vi.fn();
    const spy = vi.spyOn(window, "dispatchEvent");
    render(<ProRequiredState feature="P2P sync" onSeePro={onSeePro} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onSeePro).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("banner variant renders a one-line strip without the bullet list", () => {
    render(
      <ProRequiredState feature="P2P sync" variant="banner" onSeePro={vi.fn()} />,
    );
    const state = screen.getByTestId("pro-required-state");
    expect(state.textContent).toContain("P2P sync is part of Pro");
    expect(state.textContent).not.toContain("money-back guarantee");
  });

  it("exposes the reason through a data attribute", () => {
    render(<ProRequiredState feature="X" reason="build" onSeePro={vi.fn()} />);
    expect(screen.getByTestId("pro-required-state").dataset.reason).toBe(
      "build",
    );
  });
});
