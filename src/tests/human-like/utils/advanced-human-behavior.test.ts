/* eslint-disable @typescript-eslint/ban-ts-comment -- deliberate strict-check exemption (see note below) */
// @ts-nocheck
// Human-like harness — self-contained test infrastructure with intentionally
// loose typing (heavy `as any`), so noUncheckedIndexedAccess `!` churn adds
// no assertion value here. Excluded from strict checking; mirrors the
// src/tests/db/encryption.test.ts precedent (tsconfig.json "exclude").
/**
 * Unit tests for AdvancedHumanBehavior (src/tests/human-like/utils).
 *
 * Regression coverage for the six bugs fixed in the human simulator:
 *  1. Uppercase characters are typed as-is (no manual Shift handling that
 *     released Shift before typing, corrupting the case).
 *  2. pressKey() no longer mutates the caller's modifiers array in place.
 *  3. Pointer actions scroll the target into view before reading its box.
 *  4. A null boundingBox throws instead of silently returning.
 *  5. Metrics: totalTimeSpent matches the real post-click wait and
 *     actionsPerformed is not double-counted by moveMouse().
 *  6. scroll() natural mode decelerates (per-tick delay shrinks, floored).
 *
 * Playwright's Page/Locator are type-only exports (undefined at runtime);
 * the source module imports them with an explicit `import type`, so nothing
 * depends on esbuild eliding the import for the module to load under Vitest.
 * The tests drive a fully mocked page/locator with deterministic
 * Math.random.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Page, Locator } from "@playwright/test";
import type { AdvancedHumanBehavior } from "./advanced-human-behavior";
import {
  createAdvancedHumanBehavior,
  ciHumanOptions,
} from "./advanced-human-behavior";

interface MockLocator {
  waitFor: ReturnType<typeof vi.fn>;
  scrollIntoViewIfNeeded: ReturnType<typeof vi.fn>;
  boundingBox: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
}

interface MockPage {
  waitForTimeout: ReturnType<typeof vi.fn>;
  mouse: {
    move: ReturnType<typeof vi.fn>;
    click: ReturnType<typeof vi.fn>;
    dblclick: ReturnType<typeof vi.fn>;
    down: ReturnType<typeof vi.fn>;
    up: ReturnType<typeof vi.fn>;
    wheel: ReturnType<typeof vi.fn>;
  };
  keyboard: {
    type: ReturnType<typeof vi.fn>;
    press: ReturnType<typeof vi.fn>;
    down: ReturnType<typeof vi.fn>;
    up: ReturnType<typeof vi.fn>;
  };
  locator: ReturnType<typeof vi.fn>;
}

const BOX = { x: 10, y: 20, width: 100, height: 30 };

function createHarness(
  boundingBox: { x: number; y: number; width: number; height: number } | null = BOX,
  scrollImpl: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
  boxImpl?: ReturnType<typeof vi.fn>,
): { locator: MockLocator; page: MockPage } {
  const locator: MockLocator = {
    waitFor: vi.fn().mockResolvedValue(undefined),
    scrollIntoViewIfNeeded: scrollImpl,
    boundingBox: boxImpl ?? vi.fn().mockResolvedValue(boundingBox),
    fill: vi.fn().mockResolvedValue(undefined),
  };
  const page: MockPage = {
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    mouse: {
      move: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      dblclick: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
      wheel: vi.fn().mockResolvedValue(undefined),
    },
    keyboard: {
      type: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
    },
    locator: vi.fn().mockReturnValue(locator),
  };
  return { locator, page };
}

/** Deterministic, fast simulator options for unit tests. */
function makeHuman(page: MockPage, overrides: Record<string, unknown> = {}): AdvancedHumanBehavior {
  return createAdvancedHumanBehavior(page as unknown as Page, {
    baseDelay: 10,
    delayVariation: 0,
    mouseSpeed: "fast",
    naturalScrolling: false,
    simulateMistakes: false,
    enableFatigue: false,
    enableHesitation: false,
    enableReadingTime: false,
    enableMouseJitter: false,
    ...overrides,
  });
}

describe("AdvancedHumanBehavior (fixed-bug regression tests)", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Bug 1 — uppercase typing", () => {
    it("types each character exactly as given (uppercase preserved), without manual Shift", async () => {
      const { locator, page } = createHarness();
      const human = makeHuman(page);

      await human.type(locator as unknown as Locator, "Hello WORLD!");

      const typed = page.keyboard.type.mock.calls.map((c) => c[0]);
      expect(typed).toEqual(["H", "e", "l", "l", "o", " ", "W", "O", "R", "L", "D", "!"]);
      // The broken implementation used press('Shift')/up('Shift'); neither
      // should ever be issued now.
      expect(page.keyboard.press).not.toHaveBeenCalledWith("Shift");
      expect(page.keyboard.up).not.toHaveBeenCalledWith("Shift");
      expect(locator.fill).toHaveBeenCalledWith("");
    });
  });

  describe("Bug 2 — modifiers array not mutated", () => {
    it("pressKey leaves the caller's modifiers array untouched", async () => {
      const { page } = createHarness();
      const human = makeHuman(page);

      const modifiers: Array<"Control" | "Shift"> = ["Control", "Shift"];
      await human.pressKey("KeyA", modifiers);

      expect(modifiers).toEqual(["Control", "Shift"]);
      expect(page.keyboard.down.mock.calls.map((c) => c[0])).toEqual(["Control", "Shift"]);
      expect(page.keyboard.up.mock.calls.map((c) => c[0])).toEqual(["Shift", "Control"]);
    });

    it("pressKey works without modifiers", async () => {
      const { page } = createHarness();
      const human = makeHuman(page);

      await human.pressKey("Enter");

      expect(page.keyboard.down).not.toHaveBeenCalled();
      expect(page.keyboard.up).not.toHaveBeenCalled();
      expect(page.keyboard.press).toHaveBeenCalledWith("Enter");
    });
  });

  describe("Bug 3 — scrollIntoViewIfNeeded before boundingBox", () => {
    it("click scrolls the target into view before reading its box", async () => {
      const { locator, page } = createHarness();
      const human = makeHuman(page);

      await human.click(locator as unknown as Locator);

      expect(locator.scrollIntoViewIfNeeded).toHaveBeenCalledTimes(1);
      // The raw coordinate click re-reads the box right before clicking
      // (missed-click guard), so click reads it twice: initial + fresh.
      expect(locator.boundingBox).toHaveBeenCalledTimes(2);
      const scrollOrder = locator.scrollIntoViewIfNeeded.mock.invocationCallOrder[0]!;
      const boxOrder = locator.boundingBox.mock.invocationCallOrder[0]!;
      expect(scrollOrder).toBeLessThan(boxOrder);
    });

    it("hover, doubleClick and selectText also scroll before reading the box", async () => {
      const { locator, page } = createHarness();
      const human = makeHuman(page);

      await human.hover(locator as unknown as Locator);
      await human.doubleClick(locator as unknown as Locator);
      await human.selectText(locator as unknown as Locator);

      const scrollOrder = locator.scrollIntoViewIfNeeded.mock.invocationCallOrder;
      const boxOrder = locator.boundingBox.mock.invocationCallOrder;
      expect(scrollOrder).toHaveLength(3);
      expect(boxOrder).toHaveLength(3);
      for (let i = 0; i < 3; i += 1) {
        expect(scrollOrder[i]!).toBeLessThan(boxOrder[i]!);
      }
    });

    it("dragAndDrop scrolls both endpoints (re-scrolling the source) before reading their boxes", async () => {
      const { locator, page } = createHarness();
      const human = makeHuman(page);

      await human.dragAndDrop(locator as unknown as Locator, locator as unknown as Locator);

      // source → target → source (the last scroll guards against the target
      // scroll pushing the source back out of view).
      expect(locator.scrollIntoViewIfNeeded).toHaveBeenCalledTimes(3);
      const scrollOrder = locator.scrollIntoViewIfNeeded.mock.invocationCallOrder;
      const boxOrder = locator.boundingBox.mock.invocationCallOrder;
      expect(Math.max(...scrollOrder)).toBeLessThan(Math.min(...boxOrder));
    });
  });

  describe("Bug 4 — null boundingBox throws", () => {
    it.each(["click", "hover", "doubleClick", "selectText"] as const)(
      "%s throws 'Element not found or not visible' when boundingBox is null",
      async (method) => {
        const { locator, page } = createHarness(null);
        const human = makeHuman(page);

        await expect(human[method](locator as unknown as Locator)).rejects.toThrow(
          "Element not found or not visible",
        );
      },
    );

    it("dragAndDrop throws 'Source or target element not found' when an endpoint is null", async () => {
      const { locator, page } = createHarness(null);
      const human = makeHuman(page);

      await expect(
        human.dragAndDrop(locator as unknown as Locator, locator as unknown as Locator),
      ).rejects.toThrow("Source or target element not found");
    });
  });

  describe("Bug 5 — accurate metrics", () => {
    it("totalTimeSpent equals the actual post-click wait; actions counted once", async () => {
      const { locator, page } = createHarness();
      const human = makeHuman(page);

      await human.click(locator as unknown as Locator);

      const waits = page.waitForTimeout.mock.calls.map((c) => c[0] as number);
      const metrics = human.getMetrics();
      expect(metrics.actionsPerformed).toBe(1);
      expect(metrics.totalTimeSpent).toBe(waits[waits.length - 1]);
      expect(metrics.totalTimeSpent).toBeGreaterThan(0);
    });

    it("moveMouse alone does not inflate actionsPerformed", async () => {
      const { page } = createHarness();
      const human = makeHuman(page);

      await human.moveMouse(50, 50);

      expect(human.getMetrics().actionsPerformed).toBe(0);
    });
  });

  describe("Missed-click — coordinate re-validation retry", () => {
    it("click re-reads the box and retries when the element moved under the pointer", async () => {
      // Attempt 0: initial read gives BOX (click point computed inside), but
      // the fresh re-read shows the element moved away → retry. Attempt 1:
      // both reads agree → the click lands.
      const moved: { x: number; y: number; width: number; height: number } = {
        x: 200,
        y: 200,
        width: 100,
        height: 30,
      };
      const boxes = [BOX, moved, BOX, BOX];
      const boxImpl = vi
        .fn()
        .mockImplementation(() => Promise.resolve(boxes.shift() ?? BOX));
      const { locator, page } = createHarness(BOX, undefined, boxImpl);
      const human = makeHuman(page);

      await human.click(locator as unknown as Locator);

      // 4 box reads (2 per attempt), 2 scrolls (1 per attempt), 1 click.
      expect(locator.boundingBox).toHaveBeenCalledTimes(4);
      expect(locator.scrollIntoViewIfNeeded).toHaveBeenCalledTimes(2);
      expect(page.mouse.click).toHaveBeenCalledTimes(1);
      expect(human.getMetrics().actionsPerformed).toBe(1);
    });

    it("click throws 'Element moved during click' when the element never stabilizes", async () => {
      const moved: { x: number; y: number; width: number; height: number } = {
        x: 200,
        y: 200,
        width: 100,
        height: 30,
      };
      // Alternate between the original and the moved position so the fresh
      // re-read always disagrees with the initial read — a click point
      // computed inside one box is always outside the other, so the guard
      // exhausts its 3 attempts without ever landing a click.
      const boxes = [BOX, moved, BOX, moved, BOX, moved];
      const boxImpl = vi
        .fn()
        .mockImplementation(() => Promise.resolve(boxes.shift() ?? moved));
      const { locator, page } = createHarness(BOX, undefined, boxImpl);
      const human = makeHuman(page);

      await expect(human.click(locator as unknown as Locator)).rejects.toThrow(
        "Element moved during click",
      );
      // 3 attempts × (1 initial read + 1 fresh re-read) = 6 box reads;
      // no click is ever issued.
      expect(locator.boundingBox).toHaveBeenCalledTimes(6);
      expect(locator.scrollIntoViewIfNeeded).toHaveBeenCalledTimes(3);
      expect(page.mouse.click).not.toHaveBeenCalled();
    });
  });

  describe("Transient detach — scrollIntoViewSafely bounded retry", () => {
    it("click retries the scroll once when the element is transiently detached", async () => {
      const scroll = vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            "Protocol error (DOM.scrollIntoViewIfNeeded): Cannot find context with specified id",
          ),
        )
        .mockResolvedValue(undefined);
      const { locator, page } = createHarness(BOX, scroll);
      const human = makeHuman(page);

      await human.click(locator as unknown as Locator);

      // One transient failure + one success; the click still lands and
      // the retry never double-counts the action in the metrics.
      expect(scroll).toHaveBeenCalledTimes(2);
      expect(page.mouse.click).toHaveBeenCalledTimes(1);
      expect(human.getMetrics().actionsPerformed).toBe(1);
      // The 100ms backoff fires between the failed and retried scroll.
      expect(page.waitForTimeout).toHaveBeenCalledWith(100);
    });

    it("click rethrows when the element stays detached past the retry budget", async () => {
      const scroll = vi.fn().mockRejectedValue(
        new Error(
          "Protocol error (DOM.scrollIntoViewIfNeeded): Cannot find context with specified id",
        ),
      );
      const { locator, page } = createHarness(BOX, scroll);
      const human = makeHuman(page);

      await expect(human.click(locator as unknown as Locator)).rejects.toThrow(
        "Cannot find context",
      );
      expect(scroll).toHaveBeenCalledTimes(3);
    });

    it("click rethrows non-transient scroll errors immediately (no retry)", async () => {
      const scroll = vi.fn().mockRejectedValue(new Error("some other error"));
      const { locator, page } = createHarness(BOX, scroll);
      const human = makeHuman(page);

      await expect(human.click(locator as unknown as Locator)).rejects.toThrow(
        "some other error",
      );
      expect(scroll).toHaveBeenCalledTimes(1);
    });
  });

  describe("ciHumanOptions (CI-friendly profile)", () => {
    it("keeps every realism feature off with a short base delay", () => {
      expect(ciHumanOptions.baseDelay).toBe(30);
      expect(ciHumanOptions.delayVariation).toBe(10);
      expect(ciHumanOptions.mouseSpeed).toBe("fast");
      expect(ciHumanOptions.naturalScrolling).toBe(false);
      expect(ciHumanOptions.simulateMistakes).toBe(false);
      expect(ciHumanOptions.enableFatigue).toBe(false);
      expect(ciHumanOptions.enableHesitation).toBe(false);
      expect(ciHumanOptions.enableReadingTime).toBe(false);
      expect(ciHumanOptions.enableMouseJitter).toBe(false);
    });

    it("spreads cleanly under feature-specific overrides", async () => {
      const { locator, page } = createHarness();
      const human = makeHuman(page, { ...ciHumanOptions, enableReadingTime: true });

      // Reading time is the only realism feature re-enabled; the rest stay
      // fast so the example suite keeps within the CI 90s budget.
      await human.simulateReading(500);

      // 500 chars → ~100 words → 24000ms at 250wpm → capped to the 5s
      // ceiling. Pinning the exact value guards the cap math itself.
      expect(page.waitForTimeout).toHaveBeenCalledWith(5000);
      expect(human.getMetrics().actionsPerformed).toBe(0);
    });
  });

  describe("Bug 6 — scroll momentum", () => {
    it("natural scrolling shrinks the per-tick delay (momentum) with a floor", async () => {
      const { page } = createHarness();
      const human = makeHuman(page, { naturalScrolling: true });

      await human.scroll("down", 3);

      const waits = page.waitForTimeout.mock.calls.map((c) => c[0] as number);
      expect(waits).toHaveLength(3);
      // With Math.random() = 0.5: (40 + 0.5*40) * (1 - i*0.1) → 60, 54, 48.
      expect(waits[0]).toBeGreaterThan(waits[1]);
      expect(waits[1]).toBeGreaterThan(waits[2]);
      expect(waits[2]).toBeGreaterThanOrEqual(15);
      expect(waits).toEqual([60, 54, 48]);
    });

    it("non-natural scrolling issues a single plain wheel event", async () => {
      const { page } = createHarness();
      const human = makeHuman(page);

      await human.scroll("down", 3);

      expect(page.mouse.wheel).toHaveBeenCalledTimes(1);
      expect(page.waitForTimeout).not.toHaveBeenCalled();
    });
  });
});
