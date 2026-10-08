# ADR-055: Collapsible surfaces collapse and hide with `visibility`

- **Estado:** accepted (`CollapsibleSurface` implemented and used by the three
  dashboard banners). **Amended 2026-09-22:** the hold changes from measured
  height to *natural* height — see "Amendment 2026-09-22" at the end.
- **Fecha:** 2026-09-18

## Contexto

The dashboard banners — Safari/iOS eviction risk
(`EvictionBanner`), backup reminder (`BackupReminderBanner`) and Free tier
nudge (`FreeTierNudge`) — always mounted and hid with `opacity: 0`
plus `pointer-events: none`, leaving their entire box in the layout "to not
cause layout shift". `HomeDashboard` added a container with the same
contract per banner.

That design had two measured costs in the real app (2026-09-18; desktop
webview, Windows, newly created vault with zero bookmarks):

1. **Occupied hundreds of pixels of nothing.** The hidden containers measured
   280 px and 496 px: about 780 px of white space under invisible banners.
   The reserved space is exactly what the user perceives as "empty dashboard"
   on the first visit.
2. **Did not truly hide.** `opacity: 0` does not remove a subtree from the
   accessibility tree or tab order: the upsell "You reached 1,000 — the Free
   limit" was announced by screen reader with zero saved bookmarks, and its
   buttons "View Pro — $59" and "Continue with Free" received focus with Tab
   while invisible (`document.activeElement === btn`, `tabIndex` 0) without
   focus indication → WCAG 2.4.7. The Safari/iOS data loss alert was announced
   on a platform without eviction risk. axe-core does not evaluate focusable
   with opacity 0, so automated accessibility in CI did not cover this class
   of failure.

## Decisión

1. **The box collapses; space is not reserved.** `CollapsibleSurface`
   (`src/components/dashboard/components/CollapsibleSurface.tsx`) animates its
   own height between `0` (hidden) and the measured height of its content
   (visible), together with its vertical margins. A banner that should not be
   on screen costs no space. `HomeDashboard` stops mounting spacer containers:
   the vertical rhythm is fixed by the surface.

2. **Measurement is the only source of height.** Height is measured with
   `scrollHeight` and re-measured with `ResizeObserver`, so a banner whose
   text changes while collapsed (the backup reminder changing to its "overdue"
   wording) expands to the correct height on the next reveal.

3. **A failed measurement never hides content.** If height cannot be measured
   (jsdom, exotic embedders: `scrollHeight` always 0), the surface falls to
   `auto` when visible. The worst case is the previous behavior —reserved
   space—, never a blank banner.

4. **`visibility: hidden` is mandatory when hiding.** `visibility` preserves
   the box while removing the subtree from the accessibility tree and tab order;
   no need for `aria-hidden` nor `inert`.

5. **The transition is unidirectional.** When hiding, the change is deferred
   the animation duration (`visibility 0s linear 200ms`) so the collapse is
   visible. When showing, it is immediate: a deferred reveal would animate the
   content inside a still-hidden subtree and nothing would be seen.

6. **A single duration.** `DURATION_COLLAPSE` / `COLLAPSE_MS`
   (`src/constants/motion.ts`) is the single source of animation time,
   shared by the CSS height transition and the motion fade of the content, so
   the box and its content do not end at different times.

7. **The contract is fixed by tests.** `CollapsibleSurface.test.tsx` covers
   collapse, measured expansion, re-measurement after size change, the `auto`
   fallback, the unidirectional transition and that hidden content is not
   reachable. Each banner additionally verifies its own hidden state.

## Consecuencias

- A new vault no longer drags ~780 px of white space: hidden banners now
  measure 0 px. A keyboard or screen reader user can no longer land on content
  that is not on screen.
- **A layout shift on reveal is accepted — and measured.** Reserving the
  space was, precisely, the technique that avoided it. Now, a banner that
  appears after its async check (the backup one, the eviction one) shifts
  down the following content, animatedly. The decision prioritizes that the
  default state —everything hidden— does not occupy space over that the late
  appearance does not move anything.

  E2E measurement with the browser's Layout Shift API
  (`tests/e2e/dashboard-banner-cls.spec.ts`, Chromium, 2026-09-18), with two
  batteries — desktop 1200×720 and mobile 390×844 (Pixel 7 emulation):

  | Battery | Reveal CLS | CWV bands |
  |---|---|---|
  | Desktop | **0.068–0.085** (3 runs) | "good" (< 0.1) |
  | Mobile | **0.133–0.318** (2 runs, high variance) | outside "good" |

  **Amendment 2026-09-22 — mobile debt closed with natural hold.**
  The battery probe (`tests/e2e/dashboard-banner-cls.spec.ts`) uncovered
  that the measured height hold lost the race against the first paint:
  the box painted with the default estimate (160 px) before the measurement
  arrived, and the correction 160→531 px **animated** (visible transition
  curve: 160→312→516→531 in seven frames; mobile CLS 0.152 in the 2026-09-22
  run). The hold now uses the **natural height** (`height: auto`,
  transitions disabled while the hold lasts): the content remains mounted
  under `visibility: hidden`, which does not affect layout, so the box is
  exactly as tall as its content from the first layout — without measurement
  losing the race, without estimate to correct, without anything to animate.
  Measured after the amendment (same battery): mobile `path=held`,
  `heldAtBaseline=531px`, `total=0.0000`; the hold is the real height from
  the first layout. Both battery budgets harden to the CWV "good" band
  (< 0.1) in both batteries — from a brute regression tripwire to a good band
  requirement. The initial reservation does not cause shift when it occurs
  before the first paint (the user's initial layout already includes it);
  the spec verifies this with the hold already in place in the baseline.

  Sources attributed to the banner itself (the block that grows) and the
  content it pushes (feature grid, header). The collapse after dismiss registers
  0 (browser excludes shifts activated by interaction) and startup measures 0
  in both batteries. The spec asserts the numbers with margin as regression guard
  (desktop ~3x; mobile ~2x over the worst run due to its variance) and writes
  the JSON artifact with `BMF_CLS_REPORT`.

  **Double conclusion:** on desktop, the collapse remains without reserving
  space — a partial revert is not justified by the data. On mobile, however,
  the same reveal falls outside the "good" threshold: the collapse trade-off
  **does not hold as-is on phones**, and is registered as debt with its
  designated fix (reveal from a measured height placeholder, which eliminates
  the shift without reintroducing the permanent void) before instrumenting
  real mobile user CLS.
  *(Debt closed on 2026-09-22 by the previous amendment: the natural hold is
  the "measured height placeholder" without its defect — measurement no longer
  races against the first paint.)*
- The spacing residue is not zero: the dashboard container's `space-y-*`
  still applies its `margin-top` to the next sibling, so a collapsed surface
  leaves at most a paragraph gap. Bringing it to zero would require the
  container to know each banner's state; not worth the coupled complexity.
