// ADR-055: collapsible surfaces collapse their box instead of reserving
// space, and hide with `visibility` — never with `opacity` alone, because a
// transparent subtree is still announced and still focusable.
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { COLLAPSE_MS } from "../../../constants/motion";interface CollapsibleSurfaceProps {
  /** Expanded and exposed to assistive tech when true; collapsed when false. */
  show: boolean;
  children: ReactNode;
  /** Classes for the surface box itself (e.g. the vertical rhythm token). */
  className?: string;
  /** Collapse/expand duration in ms. Defaults to the shared motion token. */
  durationMs?: number;
  /**
   * Stable hook for E2E selectors (playwright `testIdAttribute` is
   * `data-testid`). Distinct per banner: three dashboard banners share the
   * same `mb-6` surface class, so a class locator cannot disambiguate.
   */
  testId?: string;
}

/**
 * A surface that animates its own height between collapsed (0) and its
 * content height, so a hidden banner costs no vertical space instead of
 * reserving a few hundred pixels of emptiness.
 *
 * The contract, in one place:
 *
 *   1. **The box collapses.** `height` animates to 0 (with the surface's own
 *      vertical margins) rather than staying reserved. The reveal is animated
 *      for the same reason the collapse is: the surrounding content moves
 *      smoothly instead of jumping.
 *   2. **Hidden means hidden.** `visibility` leaves with the animation on the
 *      way out — but the moment the surface is shown the flag flips
 *      immediately, otherwise the content would animate inside a still-hidden
 *      subtree and never appear.
 *   3. **A failed measurement never hides content.** If the height cannot be
 *      measured (jsdom, an exotic embedder), the surface falls back to
 *      `auto` when shown, so the worst case is the old reserved-space
 *      behaviour rather than a blanked banner.
 *
 * The height is re-measured through a ResizeObserver, so a banner whose copy
 * swaps while collapsed (the backup reminder switching to its stale wording)
 * expands to the right height on the next reveal.
 */
export function CollapsibleSurface({
  show,
  children,
  className,
  durationMs = COLLAPSE_MS,
  testId,
}: CollapsibleSurfaceProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) {
      return;
    }
    const measure = () => {
      const next = node.scrollHeight;
      // 0 means "unmeasurable" (no layout engine), not "empty": treating it as
      // unknown keeps the `auto` fallback in play so a real banner is never
      // collapsed to nothing.
      setContentHeight((prev) =>
        prev === next ? prev : next > 0 ? next : null,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const style: CSSProperties = {
    height: show ? (contentHeight ?? "auto") : 0,
    overflow: "hidden",
    visibility: show ? "visible" : "hidden",
    // The surface owns its own rhythm so a collapsed banner leaves no margin
    // behind: the animated box and its margins leave together.
    marginTop: show ? undefined : 0,
    marginBottom: show ? undefined : 0,
    transition: [
      `height ${durationMs}ms ease`,
      `margin ${durationMs}ms ease`,
      // Deliberately one-directional: leaving waits for the collapse, showing
      // is immediate (see the contract above).
      `visibility 0s linear ${show ? 0 : durationMs}ms`,
    ].join(", "),
  };

  return (
    <div className={className} style={style} data-testid={testId}>
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
