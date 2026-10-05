/**
 * eslint-rules/lib/jsx-utils.mjs — shared JSX traversal helpers.
 *
 * Shared by the local ESLint rules in eslint-rules/ (no-unbounded-text,
 * no-unbounded-card-header, …). Single source of truth for the
 * dynamic-text / defense-class detection so each rule implements only its
 * own scope decision (which tags, which wrappers, which props) on top of
 * the same primitives.
 *
 * Kept intentionally dependency-free and pure: everything here derives
 * from the ESTree/JSX AST alone.
 */

// Defense: (a) literal `truncate`, (b) `line-clamp` (Tailwind 4 bare), or
// (c) `line-clamp-N` (Tailwind ≤3), or (d) `max-w-{preset}` Tailwind
// utility, or (e) `max-w-[arbitrary-value]`.
export const DEFENSE_RE =
  /\b(?:truncate|line-clamp(?:-[1-9]\d?)?|max-w-(?:[\w-]+|\[[^\s"'`]+\]))/;

/** Returns the tag name as a flat string for a JSXOpeningElement's name. */
export function getElementName(openingElement) {
  const n = openingElement.name;
  if (n.type === "JSXIdentifier") return n.name;
  if (n.type === "JSXMemberExpression") {
    // MemberExpressions like `<Foo.Bar>` collapse to the property name.
    if (n.property && n.property.type === "JSXIdentifier") return n.property.name;
    return null;
  }
  return null;
}

/**
 * Returns a string suitable for `{name}` in the diagnostic message,
 * including a fallback for fully-unknown tag shapes (JSXNamespacedName,
 * deeply-nested MemberExpressions, etc.) so the report never renders
 * `<undefined>`.
 */
export function getDisplayName(openingElement) {
  const flat = getElementName(openingElement);
  if (flat) return flat;
  const n = openingElement.name;
  if (n && n.type === "JSXMemberExpression") {
    const tail = n.property && n.property.name;
    return `<...${tail ?? "?"}>`;
  }
  return "(unknown)";
}

export function getAttributeByName(openingElement, attrName) {
  return openingElement.attributes.find(
    (a) =>
      a.type === "JSXAttribute" &&
      a.name &&
      a.name.type === "JSXIdentifier" &&
      a.name.name === attrName,
  );
}

/**
 * Returns the literal className STRING when it can be statically
 * determined (Literal, TemplateLiteral, string-Literal inside an
 * expression container). Otherwise null — in which case callers treat
 * the element as having NO statically-verifiable className.
 */
export function classNameText(openingElement) {
  const attr = getAttributeByName(openingElement, "className");
  if (!attr) return null;
  const value = attr.value;
  if (value && value.type === "Literal" && typeof value.value === "string") {
    return value.value;
  }
  if (value && value.type === "JSXExpressionContainer") {
    const expr = value.expression;
    if (expr.type === "TemplateLiteral") {
      // Static iff there are no interpolations. We only return the
      // joined text for the defense regex to match against; interpolation
      // presence is handled elsewhere.
      return expr.quasis.map((q) => q.value.raw).join("");
    }
    if (expr.type === "Literal" && typeof expr.value === "string") {
      return expr.value;
    }
  }
  return null;
}

/**
 * Recursively unwrap type-cast / non-null / type-assert expressions to
 * reach the underlying expression; otherwise return the input. Lets rules
 * treat `{x as string}` and `{x!}` uniformly with the un-cast form.
 */
function unwrapTypeWrappers(expr) {
  let cur = expr;
  while (cur) {
    if (cur.type === "TSAsExpression") cur = cur.expression;
    else if (cur.type === "TSTypeAssertion") cur = cur.expression;
    else if (cur.type === "TSNonNullExpression") cur = cur.expression;
    else if (cur.type === "TSInstantiationExpression") cur = cur.expression;
    else break;
  }
  return cur;
}

/**
 * Returns true if `expr` is a value whose runtime content cannot be
 * statically proven to be a short literal string. The exact identifier
 * `children` is exempt — that's the React composition boundary.
 */
export function expressionIsDynamic(expr) {
  if (!expr) return false;
  const inner = unwrapTypeWrappers(expr);
  if (!inner) return false;
  switch (inner.type) {
    case "Literal":
      // string literal is statically known; numbers, booleans, null,
      // regex, bigint — typically short, treated as non-text for the
      // purpose of overflow, but rules still flag them because i18n or
      // future edits could turn them into strings.
      return typeof inner.value !== "string";
    case "Identifier":
      // `children` is a known composition boundary; do not flag.
      if (inner.name === "children") return false;
      return true;
    case "TemplateLiteral":
      // A template literal with no interpolations is static.
      return inner.expressions.length > 0;
    default:
      // MemberExpression (incl. `?.`), CallExpression,
      // LogicalExpression, ConditionalExpression, BinaryExpression,
      // UnaryExpression, ArrowFunctionExpression, JSXSpreadChild
      // (handled at the parent walker, see hasDynamicChild), and
      // anything not enumerated explicitly is assumed dynamic.
      return true;
  }
}

/**
 * Returns true if any of `children` is renderable dynamic content —
 * a non-`{children}` expression, a JSXSpreadChild, a nested element
 * whose children in turn are dynamic, etc. Pure JSXText nodes (even
 * non-empty) do NOT force the element out of "static" — the placeholders
 * ARE the surface, and the static string is decoration.
 */
export function hasDynamicChild(children) {
  if (!children || children.length === 0) return false;
  for (const child of children) {
    if (child.type === "JSXText") continue;
    if (child.type === "JSXExpressionContainer") {
      if (expressionIsDynamic(child.expression)) return true;
      continue;
    }
    // JSXSpreadChild is a direct child of the JSX children array,
    // NOT wrapped in JSXExpressionContainer. Its presence is
    // invariably dynamic — the consumer does not know what shape
    // is being spread in.
    if (child.type === "JSXSpreadChild") return true;
    if (child.type === "JSXElement" || child.type === "JSXFragment") {
      if (hasDynamicChild(child.children)) return true;
      continue;
    }
  }
  return false;
}
