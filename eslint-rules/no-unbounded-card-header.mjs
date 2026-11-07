/**
 * eslint-rules/no-unbounded-card-header.mjs
 *
 * Companion to `no-unbounded-text` with a deliberately NARROWER scope —
 * the pilot the team runs before widening the base rule:
 *
 *   - Tag is exactly one of `<h1>`, `<h2>`, `<h3>`, `<h4>` (h5/h6 are
 *     out of scope by design — they are rarely card titles).
 *   - A close ancestor `<div>` (literal tag, any nesting depth up to
 *     CARD_WRAPPER_DEPTH_LIMIT) carries a card-container className token:
 *     `card`, `ds-card`, `ds-card-soft`, `card-inactive`, … Matched by
 *     `CARD_WRAPPER_CLASS` — deliberately NOT `ds-bg-card` /
 *     `ds-radius-card` / `ds-card-title` (those are color/radius/text
 *     tokens, not containers, and matching them would add noise).
 *   - The heading has at least one dynamic child (`{var}`, `{t(...)}`,
 *     conditional, spread, interpolated template, TS cast — same
 *     semantics as no-unbounded-text via shared helpers).
 *   - The heading's OWN className lacks a defense marker: `truncate`,
 *     `line-clamp-N` (or Tailwind 4 bare `line-clamp`), or `max-w-*`.
 *
 * Difference from no-unbounded-text: this rule inspects ONLY heading-inside-
 * card-wrappers (no `<button>`/`<td>`/`<Tooltip>`, no card-header SELF-class
 * match, no Mantine `<Card>` component — literal `<div>` only). It requires
 * the defense on the heading itself; a `max-w-*` on the wrapper does NOT
 * count (a wrapper width cap does not stop a long single-word title from
 * overflowing inside it).
 *
 * Shares the traversal primitives (className extraction, dynamic-child
 * detection, DEFENSE_RE) with no-unbounded-text via
 * eslint-rules/lib/jsx-utils.mjs.
 *
 * Known limitations:
 *   - Mantine `<Card>` / `<Paper>` components are not matched (literal
 *     `<div>` only). Revisit if the pilot shows a big Card-component
 *     blind spot.
 *   - `<CardHeader>` / `<Card.Title>` Mantine sub-components are out of
 *     scope (they are not h1-h4 with a card div ancestor).
 */
import {
  DEFENSE_RE,
  classNameText,
  getDisplayName,
  getElementName,
  hasDynamicChild,
} from "./lib/jsx-utils.mjs";

const HEADING_TAG_NAMES = new Set(["h1", "h2", "h3", "h4"]);
const WRAPPER_TAG_NAME = "div";
// Card-CONTAINER token, positively enumerated: `card` / `ds-card` /
// `ds-card-soft` / `ds-card-soft-primary` / `card-inactive`. Anything
// else that merely CONTAINS `card` — `ds-bg-card` (color),
// `ds-radius-card` (radius), `ds-border-card` (border),
// `ds-card-title` / `ds-card-subtitle` (text tokens),
// `security-card-in` (animation) — fails the match and adds no noise.
const CARD_WRAPPER_CLASS =
  /(?:^|\s)(?:ds-)?card(?:-soft(?:-primary)?|-inactive)?(?=\s|$)/;
// Generous bound for "transversal" (deeply nested) card compositions —
// the scope is already narrow, so a larger limit adds no noise here.
const CARD_WRAPPER_DEPTH_LIMIT = 10;

/**
 * Returns true when `node` is a heading whose ancestor chain (up to
 * CARD_WRAPPER_DEPTH_LIMIT JSXElement/JSXFragment layers) contains a
 * literal `<div>` carrying a card-container className token.
 */
function headingInsideCardDiv(node, sourceCode) {
  // getAncestors() is root-first (AST root → node), so reverse it to walk
  // OUTWARD from the heading — that is what "transversal up to the card
  // wrapper" means, and it makes CARD_WRAPPER_DEPTH_LIMIT bound the
  // heading-to-wrapper distance rather than the root-to-wrapper distance.
  const ancestors = [...sourceCode.getAncestors(node)].reverse();
  let depth = 0;
  for (const a of ancestors) {
    // Count JSXElement AND JSXFragment as wrapper layers so a
    // `<><div className="card"><h2/></div></>` nesting stays bounded.
    if (a.type !== "JSXElement" && a.type !== "JSXFragment") continue;
    depth += 1;
    if (depth > CARD_WRAPPER_DEPTH_LIMIT) break;
    if (a.type === "JSXFragment") continue;
    if (getElementName(a.openingElement) !== WRAPPER_TAG_NAME) continue;
    const cls = classNameText(a.openingElement);
    if (cls && CARD_WRAPPER_CLASS.test(cls)) return true;
  }
  return false;
}

export const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow dynamic text in <h1>..<h4> card headers without a defensive className (truncate / line-clamp(-N) / max-w-*) on the heading.",
      recommended: false,
      url: "https://github.com/local/no-unbounded-card-header",
    },
    schema: [],
    messages: {
      needDefense:
        "Dynamic text inside <{{name}}> (card header) may overflow. Add `truncate`, `line-clamp-N`, or `max-w-*` to the heading's className.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    return {
      JSXElement(node) {
        const opening = node.openingElement;
        const name = getElementName(opening);
        if (!name || !HEADING_TAG_NAMES.has(name)) return;

        if (!hasDynamicChild(node.children)) return;
        if (!headingInsideCardDiv(node, sourceCode)) return;

        const cls = classNameText(opening);
        if (cls && DEFENSE_RE.test(cls)) return;

        context.report({
          node: opening,
          messageId: "needDefense",
          data: { name: getDisplayName(opening) },
        });
      },
    };
  },
};

export default rule;
