/**
 * Human-like E2E interactions (tests/e2e)
 *
 * Wraps the AdvancedHumanBehavior simulator (src/tests/human-like) so the
 * real BookmarkForge E2E suite can exercise vault and quick-capture flows
 * with realistic mouse movement, typing cadence and hesitation — while
 * staying deterministic and fast in CI.
 *
 * Activation (env, read by the Playwright runner process, not the page):
 *
 *   E2E_HUMAN_LIKE=1            force ON   (realistic)
 *   E2E_HUMAN_LIKE=0            force OFF  (plain Playwright actions)
 *   (unset)                     ON locally, OFF when process.env.CI is set
 *
 * Tunables:
 *
 *   E2E_HUMAN_BASE_DELAY        base delay between actions (ms, default 60)
 *   E2E_HUMAN_DELAY_VARIATION   random spread around the base (ms, default 40)
 *   E2E_HUMAN_MOUSE_SPEED       slow | normal | fast (default normal)
 *   E2E_HUMAN_MISTAKES          1 to simulate typos (default 0 — vault
 *                               passwords must stay deterministic)
 *   E2E_HUMAN_FATIGUE           1 to slow down over time (default 0)
 *   E2E_HUMAN_HESITATION        0 to disable pre-action pauses (default 1)
 *   E2E_HUMAN_JITTER            0 to disable mouse jitter (default 1)
 *   E2E_HUMAN_SCROLLING         0 to disable natural scrolling (default 1)
 *
 * When disabled every method falls back to the exact Playwright call the
 * suite previously used (click/fill/press), so CI behavior is unchanged.
 */
import type { Locator, Page } from "@playwright/test";
import {
  AdvancedHumanBehavior,
  createAdvancedHumanBehavior,
  type AdvancedHumanOptions,
  type HumanMetrics,
} from "../../src/tests/human-like/utils/advanced-human-behavior";

export interface HumanE2EConfig {
  enabled: boolean;
  options: AdvancedHumanOptions;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envEnum<T extends string>(
  name: string,
  values: readonly T[],
  fallback: T,
): T {
  const raw = process.env[name];
  return raw !== undefined && (values as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

/** Resolve the human-like config from the environment. */
export function resolveHumanE2EConfig(): HumanE2EConfig {
  const explicit = process.env.E2E_HUMAN_LIKE;
  const enabled =
    explicit !== undefined ? envBool("E2E_HUMAN_LIKE", false) : !process.env.CI;

  return {
    enabled,
    options: {
      baseDelay: envNum("E2E_HUMAN_BASE_DELAY", 60),
      delayVariation: envNum("E2E_HUMAN_DELAY_VARIATION", 40),
      mouseSpeed: envEnum(
        "E2E_HUMAN_MOUSE_SPEED",
        ["slow", "normal", "fast"] as const,
        "normal",
      ),
      naturalScrolling: envBool("E2E_HUMAN_SCROLLING", true),
      simulateMistakes: envBool("E2E_HUMAN_MISTAKES", false),
      enableFatigue: envBool("E2E_HUMAN_FATIGUE", false),
      enableHesitation: envBool("E2E_HUMAN_HESITATION", true),
      enableReadingTime: false,
      enableMouseJitter: envBool("E2E_HUMAN_JITTER", true),
    },
  };
}

/**
 * Human-like interaction facade. `enabled` decides whether every call is
 * routed through the AdvancedHumanBehavior simulator or straight to plain
 * Playwright actions.
 */
export class HumanE2E {
  readonly enabled: boolean;
  private readonly page: Page;
  private readonly human: AdvancedHumanBehavior | null;

  constructor(page: Page, config: HumanE2EConfig = resolveHumanE2EConfig()) {
    this.page = page;
    this.enabled = config.enabled;
    this.human = config.enabled
      ? createAdvancedHumanBehavior(page, config.options)
      : null;
  }

  private resolve(target: Locator | string): Locator {
    return typeof target === "string" ? this.page.locator(target) : target;
  }

  /** Click with natural mouse path; falls back to locator.click(). */
  async click(target: Locator | string): Promise<void> {
    if (this.human) {
      await this.human.click(target);
      return;
    }
    await this.resolve(target).click();
  }

  /** Type with natural cadence; falls back to locator.fill(). */
  async type(target: Locator | string, text: string): Promise<void> {
    if (this.human) {
      await this.human.type(target, text);
      return;
    }
    await this.resolve(target).fill(text);
  }

  /** Key press with human hesitation; falls back to keyboard.press(). */
  async press(
    key: string,
    modifiers?: Array<"Control" | "Alt" | "Shift" | "Meta">,
  ): Promise<void> {
    if (this.human) {
      await this.human.pressKey(key, modifiers);
      return;
    }
    await this.page.keyboard.press(key);
  }

  /**
   * Check a checkbox with human behavior; falls back to locator.check()
   * (not click()) so the disabled path keeps Playwright's checked-state
   * semantics — click() toggles, check() asserts the final state.
   */
  async check(target: Locator | string): Promise<void> {
    if (this.human) {
      await this.human.click(target);
      return;
    }
    await this.resolve(target).check();
  }

  /** Natural scrolling; falls back to a plain wheel event. */
  async scroll(
    direction: "up" | "down" | "left" | "right",
    amount: number = 3,
  ): Promise<void> {
    if (this.human) {
      await this.human.scroll(direction, amount);
      return;
    }
    const delta = direction === "up" || direction === "left" ? -amount : amount;
    await this.page.mouse.wheel(
      direction === "left" || direction === "right" ? delta * 100 : 0,
      direction === "up" || direction === "down" ? delta * 100 : 0,
    );
  }

  /** Current simulator metrics (undefined when disabled). */
  getMetrics(): HumanMetrics | undefined {
    return this.human?.getMetrics();
  }
}

/**
 * Per-page cached HumanE2E instance so a full user journey (setup → lock →
 * unlock) keeps continuous mouse position / fatigue state.
 */
const humanByPage = new WeakMap<Page, HumanE2E>();

export function humanE2E(page: Page): HumanE2E {
  let human = humanByPage.get(page);
  if (!human) {
    human = new HumanE2E(page);
    humanByPage.set(page, human);
  }
  return human;
}
