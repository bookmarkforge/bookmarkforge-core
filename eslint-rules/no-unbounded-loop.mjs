/**
 * eslint-rules/no-unbounded-loop.mjs
 *
 * Flags `for(;;)` / `while(true)` loops in service-layer and test code that
 * have no guaranteed termination mechanism.
 *
 * Motivation: `src/services/GarbageCollectionService.pruneVersions()` shipped
 * a `for(;;)` batch loop over RxDB whose only exits were data-volume checks
 * (`stale.length === 0` / `stale.length < BATCH_SIZE`). A test mock — or a
 * pathological collection — that always returns a full batch made the loop
 * allocate forever, deterministically OOM-ing the vitest worker (and, in
 * production, freezing the tab). The fix added an iteration cap
 * (`MAX_ITERATIONS`). This rule turns that fix into a permanent invariant:
 * any NEW unbounded loop in the service / worker / utils / `src/tests` layers
 * fails `npm run lint`.
 *
 * A loop is considered SAFE (not reported) when it has either:
 *
 *   1. An iteration cap — an exit (`break`, `return`, or `throw`) guarded by
 *      a counter-vs-limit comparison such as
 *      `if (iterations >= MAX_ITERATIONS) break;` or
 *      `if (count >= 100) throw ...;`. The counter must be updated inside the
 *      loop body (`iterations++`, `count += 1`, an assignment) and the limit
 *      must be a numeric literal or a MAX/LIMIT/CAP/BOUND-named constant
 *      (identifier or member like `this.MAX_ITERATIONS`). An UNCONDITIONAL
 *      exit (`for (;;) { ...; break; }`) also counts — the body runs at most
 *      once.
 *
 *   2. A stream-reader call — the loop body calls `.read()` on an identifier
 *      named `*reader*` (`const { done } = await reader.read()`). Such loops
 *      are bounded by the streaming protocol (the stream signals
 *      `{ done: true }` exactly once) and, in this codebase, additionally
 *      carry byte/char-size guards that throw on runaway streams. A bare
 *      `if (done) break;` WITHOUT a `.read()` call is NOT an exemption — a
 *      `done` flag that never becomes true is exactly the unbounded case.
 *
 * Anything else is reported. Loops bounded by their own test
 * (`while (i < N)`, `for (let i = 0; i < N; i++)`) are OUT of scope — only
 * constant-true tests (`for(;;)`, `while(true)`, `while(1)`) are inspected.
 *
 * Known limitation: the reader exemption keys on the identifier name ending
 * in `reader` (matches every current call site). A future `stream.read()`
 * or `file.read()` loop would be conservatively flagged and need a cap —
 * acceptable, since adding one is cheap.
 */

const COMPARISON_OPS = new Set(["<", "<=", ">", ">="]);
const CAP_NAME_RE = /(?:max|limit|cap|bound)/i;
const LOOP_TYPES = new Set([
  "ForStatement",
  "WhileStatement",
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
]);
const EXIT_TYPES = new Set([
  "BreakStatement",
  "ReturnStatement",
  "ThrowStatement",
]);

/** `for(;;)` has no test; `while(true)` / `while(1)` have a truthy literal. */
function isConstantTrue(test) {
  if (!test) return true;
  return test.type === "Literal" && Boolean(test.value);
}

/** Numeric literal or a MAX/LIMIT/CAP/BOUND-named identifier/member. */
function isCapExpression(node) {
  if (!node) return false;
  if (node.type === "Literal" && typeof node.value === "number") return true;
  const name =
    node.type === "Identifier"
      ? node.name
      : node.type === "MemberExpression" &&
          node.property.type === "Identifier"
        ? node.property.name
        : null;
  return name !== null && CAP_NAME_RE.test(name);
}

/** Identifier (or member property) whose name is mutated inside the loop. */
function isCounter(node, updated) {
  const name =
    node.type === "Identifier"
      ? node.name
      : node.type === "MemberExpression" &&
          node.property.type === "Identifier"
        ? node.property.name
        : null;
  return name !== null && updated.has(name);
}

/**
 * Depth-first walk of `node`'s subtree, invoking `cb(child)` for each node
 * INCLUDING `node` itself. Does not descend into nested functions (a break /
 * return inside an arrow or function body cannot exit this loop). The walk
 * stops early when `cb` returns true.
 */
function walkChildren(node, cb) {
  if (!node || typeof node.type !== "string") return;
  if (cb(node)) return;
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c.type === "string") walkChildren(c, cb);
      }
    } else if (child && typeof child.type === "string") {
      walkChildren(child, cb);
    }
  }
}

/** Names updated via `++`/`--` or assignment inside the loop body. */
function collectUpdatedIdentifiers(loop) {
  const updated = new Set();
  walkChildren(loop.body, (node) => {
    const target =
      node.type === "UpdateExpression"
        ? node.argument
        : node.type === "AssignmentExpression"
          ? node.left
          : null;
    if (target) {
      if (target.type === "Identifier") updated.add(target.name);
      else if (
        target.type === "MemberExpression" &&
        target.property.type === "Identifier"
      ) {
        updated.add(target.property.name);
      }
    }
    return false;
  });
  return updated;
}

/** True when a nested loop or switch sits between `node` and `loop`. */
function sitsInsideNestedLoopOrSwitch(node, loop) {
  let cur = node.parent;
  while (cur && cur !== loop) {
    if (LOOP_TYPES.has(cur.type) || cur.type === "SwitchStatement") {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

/** Nearest IfStatement between `node` and `loop`, or null. */
function findGuardIf(node, loop) {
  let cur = node.parent;
  while (cur && cur !== loop) {
    if (cur.type === "IfStatement") return cur;
    cur = cur.parent;
  }
  return null;
}

/**
 * True when the loop body carries a guaranteed exit:
 *   - an UNCONDITIONAL break/return/throw (runs the body at most once), or
 *   - an exit guarded by a counter-vs-cap comparison (iteration cap).
 * Breaks belonging to a nested loop or switch are not exits of this loop.
 */
function hasGuaranteedExit(loop, updated) {
  let found = false;
  walkChildren(loop.body, (node) => {
    if (found) return true;
    if (!EXIT_TYPES.has(node.type)) return false;
    if (
      node.type === "BreakStatement" &&
      sitsInsideNestedLoopOrSwitch(node, loop)
    ) {
      return false;
    }
    const guard = findGuardIf(node, loop);
    if (guard === null) {
      found = true; // unconditional exit
      return true;
    }
    const test = guard.test;
    if (
      test &&
      test.type === "BinaryExpression" &&
      COMPARISON_OPS.has(test.operator)
    ) {
      const left = test.left;
      const right = test.right;
      if (
        (isCounter(left, updated) && isCapExpression(right)) ||
        (isCounter(right, updated) && isCapExpression(left))
      ) {
        found = true;
        return true;
      }
    }
    return false;
  });
  return found;
}

/**
 * True when the loop body calls `.read()` on a `*reader*` identifier — the
 * stream-reader pattern, bounded by the protocol's terminal `done` signal
 * (plus the size-cap throws this codebase pairs with it).
 */
function hasReaderRead(loop) {
  let found = false;
  walkChildren(loop.body, (node) => {
    if (found) return true;
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.property.type === "Identifier" &&
      node.callee.property.name === "read" &&
      node.callee.object.type === "Identifier" &&
      /reader/i.test(node.callee.object.name)
    ) {
      found = true;
      return true;
    }
    return false;
  });
  return found;
}

export const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require an iteration cap (or a stream-reader .read() call) on for(;;)/while(true) loops in service and test code.",
      recommended: false,
    },
    schema: [],
    messages: {
      noCap:
        "Unbounded `{{loop}}` loop without an iteration cap. Add a counter-vs-limit exit (e.g. `let iterations = 0;` ... `if (iterations >= MAX_ITERATIONS) break; iterations++;`) or call a stream reader's `.read()` (bounded by protocol + size guards). Data-volume-only exits (`batch.length === 0`, `if (done) break;` without a reader) are the pruneVersions OOM class: they allocate forever when a collection keeps returning full batches.",
    },
  },

  create(context) {
    const check = (node) => {
      if (hasReaderRead(node)) return;
      const updated = collectUpdatedIdentifiers(node);
      if (hasGuaranteedExit(node, updated)) return;
      const label =
        node.type === "ForStatement"
          ? "for(;;)"
          : `while(${context.sourceCode.getText(node.test)})`;
      context.report({ node, messageId: "noCap", data: { loop: label } });
    };

    return {
      ForStatement(node) {
        if (isConstantTrue(node.test)) check(node);
      },
      WhileStatement(node) {
        if (isConstantTrue(node.test)) check(node);
      },
    };
  },
};

export default rule;
