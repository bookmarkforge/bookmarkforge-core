/**
 * eslint-rules/no-unbounded-text.mjs
 *
 * Flags JSX elements that render dynamic text inside a "tight" container
 * WITHOUT a defensive className marker — `truncate`, `line-clamp-N`
 * (or the Tailwind 4 bare `line-clamp`), or `max-w-*`.
 *
 * The runtime consequence is a cross-locale overflow that the Playwright
 * text-fit spec (tests/e2e/text-fit.spec.ts) is designed to catch at
 * e2e time. This rule shifts the same catch upstream to compile time so
 * authors add the defense before shipping.
 *
 * Element scope (the rule inspects an opening element if ANY of these
 * is true):
 *
 *   - Tag name is `<button>` or `<td>` (literal JSXIdentifier match).
 *   - Tag name is `<Tooltip>` (Mantine's wrapper) — the rule checks
 *     the `label` prop instead of children.
 *   - The element's own className matches /\bcard-(?:title|heading|header)\b/i.
 *   - The element is one of `<h1>..<h6>` AND a close ancestor
 *     JSXElement (≤ CARD_ANCESTOR_DEPTH_LIMIT wrappers up) has a
 *     className matching /\bcard\b/i.
 *
 * Dynamic content (NOT a defense is required when):
 *
 *   The element has at least one child whose expression is not a
 *   string literal AND not the exact identifier `children`. A spread
 *   child (`{...xs}`), a call expression (`{t("key")}`), a template
 *   literal with expressions (`{\`prefix-${var}\`}`), and TypeScript
 *   type casts / non-null assertions all count as dynamic.
 *
 * Defense regex (must match somewhere in the element's className, OR
 * for `<Tooltip>` also in `classNames.tooltip`):
 *
 *   /\b(?:truncate|line-clamp(?:-[1-9]\d?)?|max-w-(?:[\w-]+|\[[^\s"'`]+\]))/
 *
 * Autofix (conservative, opt-in via `eslint --fix`):
 *
 *   For `<button>` / `<td>` only — the two scopes where a single-line
 *   `truncate` is a safe default. Prepends `truncate ` to a statically-
 *   known className string (preserving quote style), or inserts
 *   `className="truncate"` when the element has no className.
 *
 *   NO autofix is produced for:
 *     - `<Tooltip>` — its defense lives in `classNames.tooltip` / the
 *       `label` prop, not the wrapper's own className.
 *     - Card headers (self-class or h1-h6 in a card ancestor) — these
 *       usually need a VERTICAL defense (`line-clamp-N`), which
 *       `truncate` cannot provide.
 *     - Dynamic className expressions (`cx(...)`, template-literal
 *       className, interpolation) — cannot be edited safely.
 *
 *   The "ideal" fix would be `truncate` + a computed `max-w-[200px]`
 *   derived from the parent's measured width — that needs runtime
 *   layout analysis, deferred to v2 (px-width analysis).
 *
 * The diagnostic message lists the three accepted defenses.
 *
 * `children` is exempted from the "dynamic" check because
 * `<button>{children}</button>` is the React composition boundary;
 * the *consumer* of such a component is responsible for any
 * truncation they need.
 *
 * The generic JSX traversal primitives (className extraction, dynamic
 * child detection, defense regex) live in eslint-rules/lib/jsx-utils.mjs
 * and are shared with the companion no-unbounded-card-header rule.
 *
 * Known limitations (called out so callers can `eslint-disable-next-line`
 * when they bite):
 *   - `<button dangerouslySetInnerHTML={{ __html: x }}>` is not flagged
 *     because the rule inspects `children`, not this prop. The codebase
 *     has zero occurrences — leave as-is until the surface changes.
 *   - Conditional render like
 *       `<button>{cond && <span className="truncate">{x}</span>}</button>`
 *     will flag the outer `button` even though the inner span truncates
 *     the only renderable surface. Fixing this requires descending into
 *     the right-hand JSXElement of every LogicalExpression /
 *     ConditionalExpression at every nesting — deferred.
 */
import {
  DEFENSE_RE,
  classNameText,
  expressionIsDynamic,
  getAttributeByName,
  getDisplayName,
  getElementName,
  hasDynamicChild,
} from "./lib/jsx-utils.mjs";

const TAG_NAMES = new Set(["button", "td"]);
const TOOLTIP_NAME = "Tooltip";
const HEADING_TAG_NAMES = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
const CARD_HEADER_CLASS = /\b(?:card-(?:title|heading|header))\b/i;
const CARD_ANCESTOR_CLASS = /\bcard\b/i;
// CARD_ANCESTOR_DEPTH_LIMIT = 5 covers Mantine's `<Card><div><CardSection>
// <h2/></CardSection></div></Card>` (4 wrappers), Mantine Tooltip
// internals (~3), and any reasonable two-level card composition. Tighter
// bounds risk missing nested wrappers; looser bounds risk matching an
// unrelated `card`-class container higher up the tree.
const CARD_ANCESTOR_DEPTH_LIMIT = 5;

/**
 * Mantine `<Tooltip classNames={{ tooltip: "..." }}>` — return the
 * value of the `tooltip` sub-key when statically known.
 */
function classNamesTooltipText(openingElement) {
  const attr = getAttributeByName(openingElement, "classNames");
  if (!attr || !attr.value || attr.value.type !== "JSXExpressionContainer") {
    return null;
  }
  const expr = attr.value.expression;
  if (!expr || expr.type !== "ObjectExpression") return null;
  const prop = expr.properties.find(
    (p) =>
      p.type === "Property" &&
      !p.computed &&
      ((p.key.type === "Identifier" && p.key.name === "tooltip") ||
        (p.key.type === "Literal" && p.key.value === "tooltip")),
  );
  if (!prop) return null;
  if (prop.value.type === "Literal" && typeof prop.value.value === "string") {
    return prop.value.value;
  }
  if (prop.value.type === "TemplateLiteral") {
    return prop.value.quasis.map((q) => q.value.raw).join("");
  }
  return null;
}

/**
 * Decide whether this JSXElement is in our scope. Returns one of:
 *   - "tag:button" / "tag:td"
 *   - "tooltip"
 *   - "card-header-self"
 *   - "card-header-ancestor"
 *   - null (out of scope — the rule does not inspect this element).
 *
 * Walks ancestors of the JSXElement node (not the openingElement)
 * so that a wrapper JSXElement's `openingElement` is reachable
 * through `a.openingElement`.
 */
function classifyElement(node, sourceCode) {
  const opening = node.openingElement;
  const name = getElementName(opening);
  if (!name) return null;
  if (TAG_NAMES.has(name)) return `tag:${name}`;
  if (name === TOOLTIP_NAME) return "tooltip";
  if (CARD_HEADER_CLASS.test(classNameText(opening) ?? "")) {
    return "card-header-self";
  }

  if (HEADING_TAG_NAMES.has(name)) {
    const ancestors = sourceCode.getAncestors(node);
    let depth = 0;
    for (const a of ancestors) {
      // Count both JSXElement AND JSXFragment as wrapper layers so a
      // `<><Card><h2/></Card></>` nesting is still bounded by the
      // depth limit. JSXFragment is essentially transparent markup —
      // it adds a real DOM grouping step.
      if (a.type !== "JSXElement" && a.type !== "JSXFragment") continue;
      depth += 1;
      if (depth > CARD_ANCESTOR_DEPTH_LIMIT) break;
      // Fragments have no openingElement to inspect; they contribute
      // depth budget but never match the className heuristic.
      if (a.type === "JSXFragment") continue;
      const ancestorClass = classNameText(a.openingElement) ?? "";
      if (CARD_ANCESTOR_CLASS.test(ancestorClass)) {
        return "card-header-ancestor";
      }
    }
  }
  return null;
}

function tooltipLabelIsDynamic(openingElement) {
  const attr = getAttributeByName(openingElement, "label");
  if (!attr) return false;
  if (!attr.value || attr.value.type !== "JSXExpressionContainer") return false;
  return expressionIsDynamic(attr.value.expression);
}

/**
 * Build the autofix for a reported violation, or null when a fix is not
 * safe. Conservative scope: ONLY `<button>`/`<td>` (kind `tag:*`).
 *
 *   - Tooltip: excluded — the defense belongs in `classNames.tooltip` or
 *     on the `label` content, not the wrapper's className; adding
 *     `truncate` to the Tooltip element itself would be a no-op.
 *   - Card headers (card-header-self / card-header-ancestor): excluded —
 *     headings usually want a vertical `line-clamp-N`, which `truncate`
 *     cannot deliver.
 *   - Dynamic className (cx/clsx/template interpolation): skipped — the
 *     runtime-resolved value cannot be edited statically.
 *
 * The fix prepends `truncate ` to a statically-known className string
 * (preserving single/double quote style), or inserts
 * `className="truncate"` right before the opening element's `>` when the
 * element has no className attribute at all.
 */
function buildFix(node, kind, sourceCode) {
  if (!kind || !kind.startsWith("tag:")) return null;
  const opening = node.openingElement;
  // JSX spread: `<button {...props}>` has no *static* className, but an
  // explicit prop placed AFTER a spread REPLACES the spread's className —
  // inserting `className="truncate"` would silently drop whatever styling
  // `props` carries. Refuse to edit what cannot be statically verified.
  if (opening.attributes.some((a) => a.type === "JSXSpreadAttribute")) {
    return null;
  }
  const attr = getAttributeByName(opening, "className");
  if (!attr) {
    // Insert ` className="truncate"` immediately before the closing `>`.
    const end = opening.range[1]; // exclusive — one past `>`
    // If the opening tag already carries trailing inline whitespace
    // (`<button >`), replace it so the result stays single-spaced
    // (`<button className="truncate">`) instead of `<button  className...`.
    const before = sourceCode.getText(opening).slice(0, -1);
    const ws = /[ \t]+$/.exec(before);
    if (ws) {
      const wsStart = end - 1 - ws[0].length;
      return (fixer) =>
        fixer.replaceTextRange(
          [wsStart, end - 1],
          ' className="truncate"',
        );
    }
    return (fixer) =>
      fixer.insertTextBeforeRange([end - 1, end], ' className="truncate"');
  }
  let literal = null;
  if (
    attr.value &&
    attr.value.type === "Literal" &&
    typeof attr.value.value === "string"
  ) {
    literal = attr.value;
  } else if (
    attr.value &&
    attr.value.type === "JSXExpressionContainer" &&
    attr.value.expression.type === "Literal" &&
    typeof attr.value.expression.value === "string"
  ) {
    literal = attr.value.expression;
  }
  if (!literal) return null; // dynamic or template-literal className — skip
  return (fixer) => {
    const raw = sourceCode.getText(literal);
    const quote = raw.startsWith("'") ? "'" : '"';
    const val = literal.value;
    // Empty / whitespace-only className (`className=""`) must not gain a
    // dangling space — emit bare `truncate` instead of `truncate `.
    const suffix =
      typeof val === "string" && val.trim() !== "" ? ` ${val}` : "";
    return fixer.replaceText(literal, `${quote}truncate${suffix}${quote}`);
  };
}

function defensePresent(openingElement, kind) {
  const cls = classNameText(openingElement);
  if (cls && DEFENSE_RE.test(cls)) return true;
  if (kind === "tooltip") {
    const clsNames = classNamesTooltipText(openingElement);
    if (clsNames && DEFENSE_RE.test(clsNames)) return true;
  }
  return false;
}

export const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow dynamic text in tight JSX containers without a defensive className (truncate / line-clamp(-N) / max-w-*).",
      recommended: false,
      url: "https://github.com/local/no-unbounded-text",
    },
    fixable: "code",
    schema: [],
    messages: {
      needDefense:
        "Dynamic text inside <{{name}}> may overflow. Add one of `truncate`, `line-clamp-N`, or `max-w-*` to className (or rename the dynamic expression to `children` if it is composition-only).",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    return {
      JSXElement(node) {
        const kind = classifyElement(node, sourceCode);
        if (!kind) return;

        let isDynamic = false;
        if (kind === "tooltip") {
          isDynamic = tooltipLabelIsDynamic(node.openingElement);
        } else if (
          kind === "card-header-self" ||
          kind.startsWith("tag:") ||
          kind === "card-header-ancestor"
        ) {
          isDynamic = hasDynamicChild(node.children);
        }

        if (!isDynamic) return;
        if (defensePresent(node.openingElement, kind)) return;

        context.report({
          node: node.openingElement,
          messageId: "needDefense",
          data: { name: getDisplayName(node.openingElement) },
          fix: buildFix(node, kind, sourceCode),
        });
      },
    };
  },
};

export default rule;
