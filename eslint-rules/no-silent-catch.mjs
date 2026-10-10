/**
 * eslint-rules/no-silent-catch.mjs
 *
 * Structural guard for non-test code: an EMPTY catch block (no statements,
 * comments only) swallows the error with zero signal if it does not even
 * carry a comment saying why. The repo convention (AGENTS.md section 3) is
 * explicit — an empty catch must say so with an explanatory comment whose
 * body starts with `INTENTIONAL SILENCE:` — and anything that handles the
 * error (re-throw, return, continue, logging, recovery) is a real statement
 * and passes without a comment.
 *
 * A block passes when EITHER:
 *
 *   1. It contains at least one statement — the error is handled, logged,
 *      re-thrown, or explicitly diverted (return/break/continue). This is
 *      the normal path and is never flagged.
 *
 *   2. It is empty but carries at least one comment — the author declared
 *      the silence on purpose and said why (`INTENTIONAL SILENCE:` is the
 *      repo convention; any explanatory comment is accepted).
 *
 * A block FAILS only when it is empty of both statements AND comments —
 * `catch {}` is indistinguishable from an accidental skeleton.
 *
 * Out of scope by design:
 *   - Non-empty catches, however weak their body is (they surface
 *     SOMETHING: a log line, a fallback value, a metric).
 *   - Test trees (src/tests/**, tests/e2e/**, *.test.*, scripts/__tests__)
 *     where catch-and-fail style assertions are idiomatic.
 *
 * The rule is scoped to app source, tooling scripts, the companion server
 * and the extension in eslint.config.js and ships at `error` — the tree is
 * clean today, so ANY new silent catch breaks `npm run lint`.
 */
export const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a justification comment or an error-handling statement in every empty catch block.",
      recommended: false,
    },
    schema: [],
    messages: {
      needJustification:
        "Empty catch block swallows the error silently. Add a comment explaining why (repo convention: /* INTENTIONAL SILENCE: <reason> */) or handle/re-throw the error in the block.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    return {
      CatchClause(node) {
        const body = node.body;
        if (body.type !== "BlockStatement") {return;}
        // A statement means the error is handled, logged, re-thrown or
        // diverted — never flag those.
        if (body.body.length > 0) {return;}
        // Empty body: the author must have said *why* in a comment.
        const comments = sourceCode.getCommentsInside(node);
        if (comments.length > 0) {return;}
        context.report({
          node: body,
          messageId: "needJustification",
        });
      },
    };
  },
};

export default rule;