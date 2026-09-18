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
import { COLLAPSE_MS } from "../../../constants/motion";

interface CollapsibleSurfaceProps {
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
  /**
   * The surface's visibility decision is still pending (an async check has
   * not settled). While pending AND hidden, the box does NOT collapse: it
   * holds the real content's measured height, so the eventual reveal flips
   * `visibility` in place — zero layout shift (ADR-055). The content stays
   * mounted and measured underneath; only the estimate below covers engines
   * with no measurement. Callers must pass `pending=false` once the decision
   * settles, or when the surface is known-not-to-appear (a later dismissal,
   * a sibling banner winning priority) so the box still collapses.
   */
  pending?: boolean;
  /** Estimated hold height when no layout engine can measure. Default 160. */
  placeholderHeight?: number;
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
 *   4. **A pending decision holds, not collapses.** While a caller marks the
 *      show decision `pending`, the box holds the measured content height
 *      (hidden), so the reveal animates nothing: the banner appears in a
 *      space that was already exactly its own. Measured mobile CLS of the
 *      animated reveal was 0.13–0.32 (ADR-055); the hold brings the reveal
 *      to zero shift without reserving space for banners that never show
 *      (the hold ends when the decision settles).
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
  pending = false,
  placeholderHeight = 160,
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

  // While pending-and-hidden the box holds the content's measured height
  // (a real measurement wins; the estimate covers engines without one), so
  // the eventual reveal happens in an already-sized box — no shift. The
  // estimate only paints where measurement is impossible: the real content
  // never animates inside the placeholder.
  const holding = pending && !show;
  const style: CSSProperties = {
    height: show
      ? (contentHeight ?? "auto")
      : holding
        ? (contentHeight ?? placeholderHeight)
        : 0,
    overflow: "hidden",
    visibility: show || holding ? "visible" : "hidden",
    // The surface owns its own rhythm so a collapsed banner leaves no margin
    // behind: the animated box and its margins leave together.
    marginTop: show || holding ? undefined : 0,
    marginBottom: show || holding ? undefined : 0,
    transition: [
      `height ${durationMs}ms ease`,
      `margin ${durationMs}ms ease`,
      // Deliberately one-directional: leaving waits for the collapse, showing
      // is immediate (see the contract above). While holding, immediate too:
      // the reveal is the whole point of the hold.
      `visibility 0s linear ${show || holding ? 0 : durationMs}ms`,
    ].join(", "),
  };

  return (
    <div
      className={className}
      style={{ ...style, position: "relative" }}
      data-testid={testId}
    >
      {/* While holding, only the shimmer overlay (below) paints: the real
          content must not flash before the decision settles. Measuring the
          real content still works — visibility does not affect layout. */}
      <div
        ref={contentRef}
        style={holding ? { visibility: "hidden" } : undefined}
      >
        {children}
      </div>
      {holding ? (
        // Decorative stand-in for the held space: fills the reserved box
        // exactly (the box height IS the measured content height, or the
        // estimate on engines without measurement). aria-hidden: never
        // competes with the real content it stands in for.
        <div
          aria-hidden="true"
          data-testid="collapsible-surface-placeholder"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 16,
            background:
              "linear-gradient(90deg, transparent, rgba(127,127,127,0.12), transparent)",
          }}
        />
      ) : null}
    </div>
  );
}
