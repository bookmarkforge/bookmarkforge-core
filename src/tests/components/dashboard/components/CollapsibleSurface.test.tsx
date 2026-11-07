import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

const { CollapsibleSurface } = await import(
  "../../../../components/dashboard/components/CollapsibleSurface"
);

/**
 * jsdom has no layout engine: `scrollHeight` is always 0 and the ResizeObserver
 * in the test setup never fires. These helpers install a controllable height and
 * capture the observer callback, so both measurement paths can be exercised.
 */
function installMeasuredHeight(initial: number) {
  let value = initial;
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => value,
  });
  return {
    set: (next: number) => {
      value = next;
    },
  };
}

function installResizeObserverSpy() {
  const callbacks: Array<() => void> = [];
  class ResizeObserverSpy {
    constructor(cb: () => void) {
      callbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const previous = window.ResizeObserver;
  window.ResizeObserver = ResizeObserverSpy as unknown as typeof ResizeObserver;
  return {
    fire: () => callbacks.forEach((cb) => cb()),
    restore: () => {
      window.ResizeObserver = previous;
    },
  };
}

function surfaceEl(container: HTMLElement): HTMLElement {
  return container.querySelector(".mb-6") as HTMLElement;
}

function renderSurface(
  props?: Partial<ComponentProps<typeof CollapsibleSurface>>,
) {
  return render(
    <CollapsibleSurface show={false} className="mb-6" {...props}>
      <p>Banner body</p>
    </CollapsibleSurface>,
  );
}

describe("CollapsibleSurface", () => {
  afterEach(() => {
    cleanup();
    delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
    vi.restoreAllMocks();
  });

  it("collapses its box instead of reserving space when hidden", () => {
    installMeasuredHeight(320);
    const { container } = renderSurface({ show: false });

    const surface = surfaceEl(container);
    // The whole point: a hidden banner costs no vertical space. `0`, not
    // "auto with the content still laid out inside".
    expect(surface.style.height).toBe("0px");
    expect(surface.style.marginTop).toBe("0px");
    expect(surface.style.marginBottom).toBe("0px");
  });

  it("expands to the measured content height", () => {
    installMeasuredHeight(320);
    const { container } = renderSurface({ show: true });

    expect(surfaceEl(container).style.height).toBe("320px");
  });

  it("animates the box and its margins over the shared duration", () => {
    installMeasuredHeight(320);
    const { container } = renderSurface({ show: true });

    const transition = surfaceEl(container).style.transition;
    expect(transition).toContain("height 200ms");
    expect(transition).toContain("margin 200ms");
  });

  it("stays hidden for the whole collapse, then leaves the a11y tree", () => {
    installMeasuredHeight(320);
    const { container } = renderSurface({ show: false });

    const surface = surfaceEl(container);
    expect(surface.style.visibility).toBe("hidden");
    // The visibility flip must wait for the collapse animation, or the banner
    // would blink out instead of collapsing.
    expect(surface.style.transition).toContain("visibility 0s linear 200ms");
    expect(screen.getByText("Banner body")).not.toBeVisible();
  });

  it("reveals immediately, without waiting for the animation", () => {
    installMeasuredHeight(320);
    const { container } = renderSurface({ show: true });

    const surface = surfaceEl(container);
    expect(surface.style.visibility).toBe("visible");
    expect(surface.style.transition).toContain("visibility 0s linear 0ms");
    expect(screen.getByText("Banner body")).toBeVisible();
  });

  it("re-measures when the content resizes", async () => {
    const height = installMeasuredHeight(320);
    const observer = installResizeObserverSpy();
    try {
      const { container } = renderSurface({ show: true });
      expect(surfaceEl(container).style.height).toBe("320px");

      // A banner whose copy swaps while collapsed must expand to the new
      // height on the next reveal, not the stale one.
      height.set(540);
      await act(async () => {
        observer.fire();
      });
      expect(surfaceEl(container).style.height).toBe("540px");
    } finally {
      observer.restore();
    }
  });

  it("falls back to auto instead of collapsing an unmeasurable surface", () => {
    // No layout engine (jsdom, exotic embedders): scrollHeight stays 0. The
    // worst case must be the old reserved-space behaviour, never a banner
    // blanked to zero height while it is supposed to be on screen.
    const { container } = renderSurface({ show: true });
    expect(surfaceEl(container).style.height).toBe("auto");
    expect(screen.getByText("Banner body")).toBeVisible();
  });

  // ── ADR-055 hold: pending decisions reserve the natural height ────────

  it("holds its natural height (auto) behind a shimmer while the decision is pending", () => {
    installMeasuredHeight(320);
    const { container } = renderSurface({ show: false, pending: true });

    const surface = surfaceEl(container);
    // The box holds its NATURAL height (`auto`): the content is mounted and
    // hidden, and layout — not a measurement — sizes the box. There is no
    // height value to race against first paint, so the first layout is
    // already final and flipping `show` later is a visibility flip.
    expect(surface.style.height).toBe("auto");
    expect(surface.style.visibility).toBe("visible");
    // Transitions are OFF while holding: layout-stable is the hold's job.
    expect(surface.style.transition).toBe("none");
    // The real content never flashes before the decision settles…
    expect(screen.getByText("Banner body")).not.toBeVisible();
    // …and the shimmer stands in for it, decoratively.
    expect(
      document.querySelector("[data-testid=collapsible-surface-placeholder]"),
    ).not.toBeNull();
  });

  it("reveals in place from the hold, without a height animation", () => {
    installMeasuredHeight(320);
    const { container, rerender } = renderSurface({
      show: false,
      pending: true,
    });
    rerender(
      <CollapsibleSurface show className="mb-6">
        <p>Banner body</p>
      </CollapsibleSurface>,
    );

    const surface = surfaceEl(container);
    // `show` picks up the measured height for the steady state. The hold was
    // `auto` — the same layout size — so the flip changes no geometry (the
    // E2E battery proves the geometry in a real browser; this pins the
    // state machine: hold=auto → show=measured, placeholder gone).
    expect(surface.style.height).toBe("320px");
    expect(screen.getByText("Banner body")).toBeVisible();
    expect(
      document.querySelector("[data-testid=collapsible-surface-placeholder]"),
    ).toBeNull();
  });

  it("collapses when a pending decision settles to no", () => {
    installMeasuredHeight(320);
    const { container, rerender } = renderSurface({
      show: false,
      pending: true,
    });
    rerender(
      <CollapsibleSurface show={false} className="mb-6">
        <p>Banner body</p>
      </CollapsibleSurface>,
    );

    const surface = surfaceEl(container);
    expect(surface.style.height).toBe("0px");
    expect(surface.style.visibility).toBe("hidden");
    expect(
      document.querySelector("[data-testid=collapsible-surface-placeholder]"),
    ).toBeNull();
  });

  it("holds natural height even when nothing can be measured", () => {
    // No scrollHeight stub: jsdom's layout-free path. The hold never needed
    // a measurement — `auto` reads the height out of the layout itself, so
    // there is no estimate, no fallback and nothing to correct later.
    const { container } = renderSurface({ show: false, pending: true });

    const surface = surfaceEl(container);
    expect(surface.style.height).toBe("auto");
    expect(
      document.querySelector("[data-testid=collapsible-surface-placeholder]"),
    ).not.toBeNull();
    // Hidden content is inert: it must not grab focus or be announced.
    expect(screen.getByText("Banner body")).not.toBeVisible();
  });
});
