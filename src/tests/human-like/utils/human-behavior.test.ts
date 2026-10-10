/**
 * Unit tests for HumanBehavior (src/tests/human-like/utils).
 *
 * Regression coverage mirroring advanced-human-behavior.test.ts across the
 * same six bugs, adapted to the basic class's surface:
 *  1. Uppercase characters are typed as-is (no manual Shift handling that
 *     could corrupt the case).
 *  2. pressKey() no longer mutates the caller's modifiers array in place.
 *  3. Pointer actions scroll the target into view before reading its box.
 *  4. A null boundingBox throws instead of silently returning.
 *  5. Metrics — N/A: the basic class has no metrics surface (no
 *     getMetrics/totalTimeSpent), unlike the advanced class, so there is
 *     nothing to pin here.
 *  6. Scroll pacing — the basic class has no momentum deceleration: its
 *     natural-scroll per-tick delay stays constant (the advanced class
 *     shrinks it), so these tests pin the constant pacing and the
 *     single-wheel non-natural path.
 *
 * Plus the ciBasicOptions CI profile: derivation from ciBehavior
 * (config.ts) and deterministic wait delays under createHumanBehavior.
 * Plus natural-behavior coverage mirroring the advanced class: type()
 * keystroke delays and thinking pauses, typeWithMistakes() on/off,
 * scroll() directions, and readContent().
 *
 * Playwright's Page/Locator are type-only exports (undefined at runtime);
 * the source module imports them with an explicit `import type`, so nothing
 * depends on esbuild eliding the import for the module to load under Vitest.
 * The tests drive a fully mocked page/locator with deterministic
 * Math.random.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Page, Locator } from "@playwright/test";
import type { HumanBehavior } from "./human-behavior";
import {
  createHumanBehavior,
  ciBasicOptions,
} from "./human-behavior";
import { ciBehavior } from "../config";

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
function makeHuman(page: MockPage, overrides: Record<string, unknown> = {}): HumanBehavior {
  return createHumanBehavior(page as unknown as Page, {
    baseDelay: 10,
    delayVariation: 0,
    mouseSpeed: "fast",
    naturalScrolling: false,
    simulateMistakes: false,
    ...overrides,
  });
}

describe("HumanBehavior (fixed-bug regression tests)", () => {
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
      // Released in reverse order via a copy — the caller's array is never
      // reversed in place.
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

  describe("Bug 5 — metrics (N/A: basic class has no metrics surface)", () => {
    it("exposes no getMetrics method (documenting why Bug 5 is not applicable)", () => {
      const { page } = createHarness();
      const human = makeHuman(page);

      // The basic class tracks no totalTimeSpent/actionsPerformed — the
      // advanced class's Bug 5 (accurate metrics) has no analogue here, so
      // there is deliberately nothing to assert beyond the absence of the
      // metrics API.
      expect((human as unknown as { getMetrics?: unknown }).getMetrics).toBeUndefined();
    });
  });

  describe("Bug 6 — scroll pacing (no momentum deceleration in the basic class)", () => {
    it("natural scrolling emits one wheel tick per amount with constant pacing", async () => {
      const { page } = createHarness();
      const human = makeHuman(page, { naturalScrolling: true });

      await human.scroll("down", 3);

      // The basic class keeps the per-tick delay constant (50 + 0.5*50 =
      // 75) and the wheel delta constant (20 + 0.5*30 = 35), unlike the
      // advanced class which shrinks the delay per tick (momentum). Pinning
      // the constant values guards against accidentally importing momentum.
      expect(page.mouse.wheel).toHaveBeenCalledTimes(3);
      expect(page.mouse.wheel.mock.calls.map((c) => c[1])).toEqual([35, 35, 35]);
      const waits = page.waitForTimeout.mock.calls.map((c) => c[0] as number);
      expect(waits).toEqual([75, 75, 75]);
    });

    it("non-natural scrolling issues a single plain wheel event with no waits", async () => {
      const { page } = createHarness();
      const human = makeHuman(page);

      await human.scroll("down", 3);

      expect(page.mouse.wheel).toHaveBeenCalledTimes(1);
      expect(page.waitForTimeout).not.toHaveBeenCalled();
    });
  });

  describe("type() — natural keystroke delays", () => {
    it("applies the natural per-keystroke delay to every character", async () => {
      const { locator, page } = createHarness();
      const human = makeHuman(page);

      await human.type(locator as unknown as Locator, "Hello");

      // Natural delay = 50 + 0.5*100 = 100ms per keystroke under the
      // Math.random() = 0.5 mock. Playwright's keyboard.type applies the
      // Shift modifier for uppercase automatically, so the delay stream is
      // the only thing to pin here (uppercase preservation is Bug 1).
      const delays = page.keyboard.type.mock.calls.map((c) => c[1]);
      expect(delays).toEqual([
        { delay: 100 },
        { delay: 100 },
        { delay: 100 },
        { delay: 100 },
        { delay: 100 },
      ]);
      expect(page.keyboard.type).toHaveBeenCalledTimes(5);
    });

    it("fires an occasional thinking pause when the random roll is low", async () => {
      const { locator, page } = createHarness();
      vi.mocked(Math.random).mockReturnValue(0.05);
      const human = makeHuman(page);

      await human.type(locator as unknown as Locator, "a");

      // Thinking pause fires at 0.05 (< 0.1): 200 + 0.05*300 = 215ms.
      expect(page.waitForTimeout).toHaveBeenCalledWith(215);
      // Keystroke delay is still natural: 50 + 0.05*100 = 55ms.
      expect(page.keyboard.type).toHaveBeenCalledWith("a", { delay: 55 });
    });
  });

  describe("typeWithMistakes() — simulateMistakes on/off", () => {
    it("never mistypes when simulateMistakes is off", async () => {
      const { locator, page } = createHarness();
      const human = makeHuman(page);

      await human.typeWithMistakes(locator as unknown as Locator, "abc");

      // 0.5 is above the 0.1 mistake threshold and the option is off, so
      // every character is typed exactly once, in order, with no correction.
      const typed = page.keyboard.type.mock.calls.map((c) => c[0]);
      expect(typed).toEqual(["a", "b", "c"]);
      expect(page.keyboard.press).not.toHaveBeenCalledWith("Backspace");
    });

    it("types a wrong character then corrects it when simulateMistakes is on", async () => {
      const { locator, page } = createHarness();
      // 0.05 is below the 0.1 threshold: every character triggers a typo.
      vi.mocked(Math.random).mockReturnValue(0.05);
      const human = makeHuman(page, { simulateMistakes: true });

      await human.typeWithMistakes(locator as unknown as Locator, "ab");

      // Per char: wrong char (charCode+1) → Backspace → correct char.
      const typed = page.keyboard.type.mock.calls.map((c) => c[0]);
      expect(typed).toEqual(["b", "a", "c", "b"]);
      expect(page.keyboard.press).toHaveBeenCalledTimes(2);
      expect(page.keyboard.press).toHaveBeenNthCalledWith(1, "Backspace");
      expect(page.keyboard.press).toHaveBeenNthCalledWith(2, "Backspace");
      // Realize-mistake pause (300 + 0.05*200 = 310) and fix pause (100).
      expect(page.waitForTimeout).toHaveBeenCalledWith(310);
      expect(page.waitForTimeout).toHaveBeenCalledWith(100);
    });
  });

  describe("scroll() — directions (natural mode)", () => {
    it("signs the wheel delta per direction and axis", async () => {
      const { page } = createHarness();
      const human = makeHuman(page, { naturalScrolling: true });

      await human.scroll("up", 1);
      // delta -1 * (20 + 0.5*30) = -35 on the vertical axis.
      expect(page.mouse.wheel).toHaveBeenLastCalledWith(0, -35);

      await human.scroll("left", 1);
      // delta -1 * 35 = -35 on the horizontal axis.
      expect(page.mouse.wheel).toHaveBeenLastCalledWith(-35, 0);
    });
  });

  describe("readContent()", () => {
    it("scans in an F pattern per 500ms tick (simple mode)", async () => {
      const { page } = createHarness();
      const human = makeHuman(page);

      await human.readContent(1000);

      // scrollCount = floor(1000/500) = 2 F-scan ticks after the initial
      // duration*0.3 = 300ms scan delay. Tick 1 (even) wheels a horizontal
      // right scan (delta 1 on X) with its 200 + 0.5*100 = 250ms pause,
      // then every tick wheels the vertical down scan (delta 1 on Y) with
      // the 300 + 0.5*200 = 400ms read pause. One eye-tracking mouse move
      // per tick.
      expect(page.mouse.wheel.mock.calls).toEqual([
        [1, 0], // tick 1: right scan
        [0, 1], // tick 1: down scan
        [0, 1], // tick 2: down scan
      ]);
      // Real read pauses; the eye-tracking moves interleave their own
      // per-bezier-point waits (10ms * fast multiplier = 5ms), filtered out
      // here so the assertion pins pacing, not the mouse-path granularity.
      const pauses = page.waitForTimeout.mock.calls.map((c) => c[0] as number);
      expect(pauses.filter((t) => t >= 50)).toEqual([300, 250, 400, 400]);
      // One eye-tracking path per tick; each path issues one move per
      // bezier point, so only its presence (not its point count) is pinned.
      expect(page.mouse.move.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("composes natural scrolling into each F-scan tick", async () => {
      const { page } = createHarness();
      const human = makeHuman(page, { naturalScrolling: true });

      await human.readContent(1000);

      // Natural wheels are (20 + 0.5*30) = 35 on the scan axis, each
      // followed by its 50 + 0.5*50 = 75ms pacing delay; the read pause is
      // 400ms. Tick 1 = right scan + down scan, tick 2 = down scan only.
      expect(page.mouse.wheel.mock.calls.map((c) => [c[0], c[1]])).toEqual([
        [35, 0], // tick 1: natural right scan (X)
        [0, 35], // tick 1: natural down scan (Y)
        [0, 35], // tick 2: natural down scan (Y)
      ]);
      // Per tick: pacing (75ms) after each natural wheel, the horizontal
      // read pause (250ms) after the right scan, and the 400ms read pause
      // after each down scan — mouse-path waits (5ms) filtered out.
      const pauses = page.waitForTimeout.mock.calls.map((c) => c[0] as number);
      expect(pauses.filter((t) => t >= 50)).toEqual([
        300, // initial F-scan delay
        75, 250, 75, 400, // tick 1: right pacing+pause, down pacing+pause
        75, 400, // tick 2: down pacing+pause
      ]);
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
      // the 100ms backoff fires between the failed and retried scroll.
      expect(scroll).toHaveBeenCalledTimes(2);
      expect(page.mouse.click).toHaveBeenCalledTimes(1);
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

  describe("ciBasicOptions (CI-friendly profile)", () => {
    it("mirrors ciHumanOptions: short base delay, no realism extras", () => {
      expect(ciBasicOptions.baseDelay).toBe(30);
      expect(ciBasicOptions.delayVariation).toBe(10);
      expect(ciBasicOptions.mouseSpeed).toBe("fast");
      expect(ciBasicOptions.naturalScrolling).toBe(false);
      expect(ciBasicOptions.simulateMistakes).toBe(false);
    });

    it("makeHuman harness defaults actually reach the simulator", async () => {
      const { locator, page } = createHarness();
      const human = makeHuman(page);

      await human.pressKey("Enter");

      // getDelay() = max(50, baseDelay + variation) → 50 with baseDelay 10,
      // variation 0 — deterministic under Math.random() = 0.5. wait() runs
      // exactly once, so pinning the call count guards against a future
      // pressKey regression that double-waits.
      expect(page.waitForTimeout).toHaveBeenCalledTimes(1);
      expect(page.waitForTimeout).toHaveBeenCalledWith(50);
      expect(locator.waitFor).not.toHaveBeenCalled();
    });

    it("derives from ciBehavior (config.ts) as an independent spread copy", () => {
      // Deep-equals the central CI profile — the single source of truth —
      // while not aliasing it, so callers can override fields without
      // mutating the shared profile.
      expect(ciBasicOptions).toEqual(ciBehavior);
      expect(ciBasicOptions).not.toBe(ciBehavior);
    });

    it("createHumanBehavior with ciBasicOptions waits deterministically", async () => {
      const { page } = createHarness();
      const human = createHumanBehavior(page as unknown as Page, ciBasicOptions);

      await human.wait();
      await human.wait();

      // getDelay() = max(50, baseDelay + variation); with baseDelay 30 and
      // Math.random() = 0.5, variation = 0.5*10*2 - 10 = 0, so every wait is
      // exactly max(50, 30) = 50ms — deterministic across calls.
      expect(page.waitForTimeout.mock.calls.map((c) => c[0])).toEqual([50, 50]);
    });
  });
});
