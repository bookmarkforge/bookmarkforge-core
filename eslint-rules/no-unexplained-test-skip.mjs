/**
 * eslint-rules/no-unexplained-test-skip.mjs
 *
 * Structural guard for the Playwright e2e suite (tests/e2e/**): a
 * `test.skip()` / `test.fixme()` / `test.todo()` call that silences a
 * test MUST carry an explicit reason, so a silently-disabled test cannot
 * be committed and forgotten. Motivation: the visual-testing.spec.ts
 * incident — a bare `test.skip` shipped with the harness commit and the
 * test stayed disabled for weeks with zero signal.
 *
 * A call is accepted when EITHER:
 *
 *   1. Reason string argument — any positional argument is a string
 *      literal (or an interpolation-free template literal). This covers
 *      the declaration forms (`test.skip("name", body)`,
 *      `test.todo("name")`) and conditional skips with a description
 *      (`test.skip(cond, "reason")`).
 *
 *   2. Adjacent reason comment — a `//` line comment or a block comment
 *      whose last line is the line directly above the call, or that
 *      starts on the same line as the call (trailing
 *      `test.skip(); // reason`). A comment separated by a blank line
 *      does NOT count — it may belong to a different statement.
 *
 * Out of scope by design:
 *   - `test.skipIf(cond)` / `test.describe.skipIf(cond)` — whole-suite
 *     environment guards (e.g. missing server entry, absent docs),
 *     usually paired with a self-documenting condition.
 *   - `test.describe.skip(...)` — declaration form with a name string.
 *
 * The rule is scoped to the e2e suite glob in eslint.config.js and ships
 * at `error` — the suite is clean today, so ANY new unexplained skip
 * breaks `npm run lint`.
 */
const OBJECT_NAMES = new Set(["test", "it"]);
const SKIP_METHODS = new Set(["skip", "fixme", "todo"]);

function hasReasonStringArg(args, sourceCode) {
  return args.some((arg) => {
    if (arg.type === "Literal" && typeof arg.value === "string") {
      return true;
    }
    // A template literal without interpolations is a static string;
    // require non-empty so bare `` `` `` never counts as a reason.
    if (arg.type === "TemplateLiteral" && arg.expressions.length === 0) {
      return sourceCode.getText(arg).trim().length > 2;
    }
    return false;
  });
}

function hasAdjacentReasonComment(node, sourceCode) {
  const callLine = sourceCode.getFirstToken(node).loc.start.line;
  // Comment directly above the call (last line of the comment is the
  // line right before, or the same line before the call).
  const before = sourceCode.getCommentsBefore(node);
  const lastBefore = before[before.length - 1];
  if (lastBefore && lastBefore.loc.end.line >= callLine - 1) return true;
  // Trailing comment on the same line: `test.skip(); // reason`. The
  // comment sits after the statement's `;`, so getCommentsAfter on the
  // CallExpression itself sees nothing (the `;` token is between) —
  // inspect the enclosing ExpressionStatement as well.
  const afterNode = sourceCode.getCommentsAfter(node)[0];
  if (afterNode && afterNode.loc.start.line === callLine) return true;
  const stmt =
    node.parent && node.parent.type === "ExpressionStatement"
      ? node.parent
      : node;
  const afterStmt = sourceCode.getCommentsAfter(stmt)[0];
  if (afterStmt && afterStmt.loc.start.line === callLine) return true;
  return false;
}

export const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require an explicit reason (string argument or adjacent comment) for test.skip() / test.fixme() / test.todo().",
      recommended: false,
    },
    schema: [],
    messages: {
      needReason:
        "test.{{method}}() silently disables a test. Pass a description string argument or add a `// reason` comment on the line directly above.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        if (callee.computed) return;
        if (callee.object.type !== "Identifier") return;
        if (!OBJECT_NAMES.has(callee.object.name)) return;
        if (callee.property.type !== "Identifier") return;
        const method = callee.property.name;
        if (!SKIP_METHODS.has(method)) return;
        if (hasReasonStringArg(node.arguments, sourceCode)) return;
        if (hasAdjacentReasonComment(node, sourceCode)) return;
        context.report({
          node: callee.property,
          messageId: "needReason",
          data: { method },
        });
      },
    };
  },
};

export default rule;
