import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));
vi.mock("../../i18n", () => ({
  default: { t: (_s: string, fallback?: string) => fallback || "" },
}));

const rafCbs: Map<number, () => void> = new Map();
const idleCbs: Map<number, () => void> = new Map();
let nextRafId = 0;
let nextIdleId = 0;

function runPendingRaf() {
  const ids = [...rafCbs.keys()];
  for (const id of ids) {
    const cb = rafCbs.get(id);
    rafCbs.delete(id);
    cb?.();
  }
}

beforeEach(() => {
  rafCbs.clear();
  idleCbs.clear();
  nextRafId = 0;
  nextIdleId = 0;
  vi.useFakeTimers();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(
    (cb: FrameRequestCallback) => {
      nextRafId++;
      rafCbs.set(nextRafId, () => cb(0));
      return nextRafId;
    },
  );
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) =>
    rafCbs.delete(id),
  );
  (window as any).requestIdleCallback = vi.fn((cb: IdleRequestCallback) => {
    nextIdleId++;
    idleCbs.set(nextIdleId, () =>
      cb({ didTimeout: false, timeRemaining: () => 0 }),
    );
    return nextIdleId;
  });
  (window as any).cancelIdleCallback = vi.fn((id: number) =>
    idleCbs.delete(id),
  );
  class MockObserver {
    callback: IntersectionObserverCallback;
    elements: Set<Element>;
    constructor(cb: IntersectionObserverCallback) {
      this.callback = cb;
      this.elements = new Set();
    }
    observe(_el: Element) {
      /* noop */
    }
    unobserve(_el: Element) {
      /* noop */
    }
    disconnect() {
      this.elements.clear();
    }
  }
  vi.stubGlobal("IntersectionObserver", MockObserver as any);
});

afterEach(() => {
  vi.useRealTimers();
});

function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
    runPendingRaf();
  });
}

function callIdle() {
  const ids = [...idleCbs.keys()];
  act(() => {
    for (const id of ids) {
      const cb = idleCbs.get(id);
      idleCbs.delete(id);
      cb?.();
    }
  });
}

// Only the LIVE exports of the streaming-hydration module are tested here.
// The dead experiment components (StreamingContainer, TimeSliced,
// HydrationBoundary, Deferred, PriorityQueue, StreamingShell,
// useStreamingStats) were removed in P89 — see docs/AUDITORIA.md.
import { useProgressiveHydration } from "../../components/streaming-hydration/useProgressiveHydration";
import { ProgressiveComponent } from "../../components/streaming-hydration/ProgressiveComponent";

// ===== useProgressiveHydration =====
describe("useProgressiveHydration", () => {
  it("critical priority renders immediately", () => {
    function Test() {
      const ok = useProgressiveHydration("critical");
      return ok ? <div>ok</div> : null;
    }
    const { container } = render(<Test />);
    expect(
      Array.from(container.children).find((el) => el.tagName !== "STYLE")!
        .textContent,
    ).toBe("ok");
  });

  it("medium priority renders after the delay + raf", () => {
    function Test() {
      const ok = useProgressiveHydration("medium");
      return ok ? <div>ok</div> : null;
    }
    const { container } = render(<Test />);
    expect(
      Array.from(container.children).find((el) => el.tagName !== "STYLE")
        ?.textContent ?? "",
    ).toBe("");
    tick(500);
    expect(
      Array.from(container.children).find((el) => el.tagName !== "STYLE")!
        .textContent,
    ).toBe("ok");
  });

  it("idle priority uses requestIdleCallback", () => {
    function Test() {
      const ok = useProgressiveHydration("idle");
      return ok ? <div>ok</div> : null;
    }
    const { container } = render(<Test />);
    expect(
      Array.from(container.children).find((el) => el.tagName !== "STYLE")
        ?.textContent ?? "",
    ).toBe("");
    callIdle();
    expect(
      Array.from(container.children).find((el) => el.tagName !== "STYLE")!
        .textContent,
    ).toBe("ok");
  });

  it("custom delay sobrescribe el default", () => {
    function Test() {
      const ok = useProgressiveHydration("high", 200);
      return ok ? <div>ok</div> : null;
    }
    const { container } = render(<Test />);
    tick(200);
    expect(
      Array.from(container.children).find((el) => el.tagName !== "STYLE")!
        .textContent,
    ).toBe("ok");
  });

  it("low priority honra el delay de PRIORITY_DELAYS.low", () => {
    function Test() {
      const ok = useProgressiveHydration("low");
      return ok ? <div>ok</div> : null;
    }
    const { container } = render(<Test />);
    expect(
      Array.from(container.children).find((el) => el.tagName !== "STYLE")
        ?.textContent ?? "",
    ).toBe("");
    tick(1000);
    expect(
      Array.from(container.children).find((el) => el.tagName !== "STYLE")!
        .textContent,
    ).toBe("ok");
  });
});

// ===== ProgressiveComponent =====
describe("ProgressiveComponent", () => {
  it("renders fallback before the delay", () => {
    const { container } = render(
      <ProgressiveComponent priority="high">
        <div>content</div>
      </ProgressiveComponent>,
    );
    expect(
      Array.from(container.children).find((el) => el.tagName !== "STYLE")
        ?.textContent ?? "",
    ).toBe("");
    tick(100);
    expect(
      Array.from(container.children).find((el) => el.tagName !== "STYLE")!
        .textContent,
    ).toBe("content");
  });

  it("uses a custom fallback", () => {
    const { getByText } = render(
      <ProgressiveComponent priority="high" fallback={<div>loading</div>}>
        <div>content</div>
      </ProgressiveComponent>,
    );
    expect(getByText("loading")).toBeTruthy();
    tick(100);
    expect(getByText("content")).toBeTruthy();
  });

  it("critical renders immediately", () => {
    const { getByText } = render(
      <ProgressiveComponent priority="critical">
        <div>content</div>
      </ProgressiveComponent>,
    );
    expect(getByText("content")).toBeTruthy();
  });
});
