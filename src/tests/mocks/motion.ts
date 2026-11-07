/**
 * Shared `motion/react` mock factory for tests.
 *
 * WHY THIS EXISTS (regression guard): components import `useReducedMotion`
 * from `src/hooks/useReducedMotion.ts`, which re-exports it straight from
 * `motion/react`. Any test mock that stubs `motion/react` without providing
 * `useReducedMotion` crashes the component under test on mount ("not a
 * function"). Before this factory, ~80 test files each hand-rolled their own
 * partial mock, and any component adding a new motion/react import silently
 * broke the tests that forgot to add it.
 *
 * This factory returns a COMPLETE, self-contained mock surface:
 *   * `motion`            — Proxy that renders ANY HTML tag (div, span, p,
 *                           aside, button, …) as a plain element, spreading
 *                           safe DOM props and stripping motion-only props
 *                           (initial/animate/exit/variants/transition/…).
 *   * `AnimatePresence`   — renders children (no exit animations in jsdom).
 *   * `MotionConfig`      — renders children.
 *   * `useReducedMotion`  — always defined; returns false unless overridden.
 *   * `m`                 — alias of `motion` (some components use `m.div`).
 *   * `LazyMotion`        — renders children.
 *
 * Usage (async factory so the mock module can be imported from the hoisted
 * `vi.mock` call — vi.mock factories are hoisted above imports, so a static
 * `import` of this module would be "used before declaration"; an `await
 * import()` inside the factory resolves correctly):
 *
 *   vi.mock("motion/react", async () => {
 *     const { createMotionMock } = await import("../../mocks/motion");
 *     return createMotionMock();
 *   });
 *
 * To override a signal (e.g. assert on useReducedMotion calls):
 *
 *   vi.mock("motion/react", async () => {
 *     const { createMotionMock } = await import("../../mocks/motion");
 *     return createMotionMock({ useReducedMotion: mockUseReducedMotion });
 *   });
 */
import React from "react";

/** Motion-only props that must never leak onto a plain DOM element.
 *
 * Deliberately NOT included: `hidden` — that is a standard HTML attribute
 * (React renders it as a real DOM attribute and jsdom/testing-library honor
 * it in `toBeVisible()`), not a framer-motion prop. Stripping it would
 * silently break visibility semantics for `<motion.div hidden={...}>`.
 */
const MOTION_ONLY_PROPS = new Set([
  "initial",
  "animate",
  "exit",
  "whileHover",
  "whileTap",
  "whileDrag",
  "whileFocus",
  "whileInView",
  "transition",
  "variants",
  "viewport",
  "layout",
  "layoutId",
  "layoutDependency",
  "drag",
  "dragConstraints",
  "dragControls",
  "dragElastic",
  "dragListener",
  "dragMomentum",
  "dragDirectionLock",
  "dragPropagation",
  "dragSnapToOrigin",
  "dragTransition",
  "onDragStart",
  "onDrag",
  "onDragEnd",
  "onDirectionLock",
  "onHoverStart",
  "onHoverEnd",
  "onTap",
  "onTapStart",
  "onTapCancel",
  "onPan",
  "onPanStart",
  "onPanEnd",
  "onPanSessionStart",
  "onViewportEnter",
  "onViewportLeave",
  "onAnimationStart",
  "onAnimationComplete",
  "onAnimationCancel",
  "onLayoutAnimationStart",
  "onLayoutAnimationComplete",
  "onUpdate",
  "custom",
  "inherit",
  "styleOrigin",
  "transformTemplate",
  "visualElement",
  "motionValue",
]);

export interface MotionMockOptions {
  /**
   * Override `useReducedMotion`. Default: `() => false`. Pass a vi.fn when a
   * test needs to assert on it or flip its return value per-test.
   */
  useReducedMotion?: () => boolean;
  /**
   * Override `MotionConfig` renderer. Default renders children directly.
   * Some tests want a wrapper (e.g. `data-testid="motion-config"`).
   */
  MotionConfig?: React.ComponentType<{ children?: React.ReactNode }>;
  /**
   * Override `AnimatePresence` renderer. Default renders children directly.
   */
  AnimatePresence?: React.ComponentType<{ children?: React.ReactNode }>;
  /** Extra named exports merged into the mock module (rarely needed). */
  extras?: Record<string, unknown>;
}

/**
 * Builds the complete motion/react mock object. `motion` is a Proxy that
 * returns a stable functional component per HTML tag on first access.
 */
export function createMotionMock(options: MotionMockOptions = {}) {
  const elementCache = new Map<string, React.FC<any>>();

  const makeMotionElement = (tag: string): React.FC<any> => {
    const cached = elementCache.get(tag);
    if (cached) {return cached;}
    const MotionEl: React.FC<any> = ({ children, ...props }) => {
      const domProps: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (!MOTION_ONLY_PROPS.has(key)) {
          domProps[key] = value;
        }
      }
      return React.createElement(tag, domProps, children);
    };
    elementCache.set(tag, MotionEl);
    return MotionEl;
  };

  const motion = new Proxy({} as Record<string, React.FC<any>>, {
    get: (_target, tag: string | symbol) => {
      if (typeof tag !== "string") {return undefined;}
      return makeMotionElement(tag);
    },
  });

  const Passthrough: React.FC<{ children?: React.ReactNode }> = ({
    children,
  }) => React.createElement(React.Fragment, null, children);

  return {
    motion,
    m: motion,
    AnimatePresence: options.AnimatePresence ?? Passthrough,
    MotionConfig: options.MotionConfig ?? Passthrough,
    LazyMotion: Passthrough,
    useReducedMotion: options.useReducedMotion ?? (() => false),
    ...options.extras,
  };
}
