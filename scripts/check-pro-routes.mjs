#!/usr/bin/env node
/**
 * scripts/check-pro-routes.mjs — fail the build when a paid route is not
 * entitlement-gated.
 *
 * Entitlement used to be enforceable only by remembering to enforce it: the
 * HTTP router was a chain of `req.url === "..."` comparisons, and whether a
 * route verified a license proof was knowledge you had to carry in your head.
 * A new AI modality, a new cloud-backed endpoint, or a refactor that drops the
 * guard all looked identical to a clean diff.
 *
 * `server/src/route-table.ts` now declares every route and its access level, and
 * `createGuardedDispatcher()` applies the entitlement guard to each
 * `access: "entitlement"` route. This gate closes the loop by comparing that
 * declaration against the router that actually runs:
 *
 *   1. COVERAGE     every `req.url` the router dispatches is declared in the
 *                   route table (a new route cannot be mounted unclassified),
 *                   and every declared route is dispatched (no dead policy
 *                   that makes the table look complete while it is not);
 *   2. CAPABILITY   any route under a paid namespace (`PAID_PATH_PREFIXES` in
 *                   the route table; empty today) must be
 *                   `access: "entitlement"` unless it records an audited
 *                   `paidException` reason — so a new paid route cannot be
 *                   classified as public by accident;
 *   3. WIRING       the guard plan the real module computes for each route must
 *                   agree with the declared access (an entitlement route whose
 *                   plan is "not guarded" is a red build, not a runtime
 *                   surprise), and the unguarded dispatch function must have
 *                   exactly one caller — the guarded dispatcher.
 *
 * FAIL CLOSED: if the router source, the dispatch function or the route table
 * cannot be read, or the scan finds no routes at all, the gate exits non-zero.
 * A gate that passes because it found nothing is worse than no gate.
 *
 * Usage:
 *   tsx scripts/check-pro-routes.mjs              # the whole check (npm run check:pro-routes)
 *   tsx scripts/check-pro-routes.mjs --json       # machine-readable violations
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// process.cwd() rather than import.meta.url: vitest rewrites module URLs to a
// non-file scheme, and this module is imported by its own unit test. Both the
// CLI and the test run from the repo root.
const ROOT = process.cwd();
const TAG = "[check-pro-routes]";
const SERVER_INDEX = join("server", "src", "index.ts");
const ROUTE_TABLE = join("server", "src", "route-table.ts");

/**
 * The unguarded dispatch. Exported by name so the wiring rule and the router
 * cannot drift apart silently: renaming it in `index.ts` fails this gate until
 * the gate is updated in the same change.
 */
export const DISPATCH_FN = "dispatchUnGuardedRequest";
/** The only function allowed to call `DISPATCH_FN`. */
export const GUARDED_DISPATCHER = "createGuardedDispatcher";
/**
 * The factory that must build the guard the dispatcher is wired to. Asserting
 * the factory, not a variable name, is what makes the rule survive a rename of
 * the wiring without losing its guarantee.
 */
export const ENTITLEMENT_GUARD_FACTORY = "createEntitlementGuard";

/**
 * `req.url === "/x"` and `req.url?.startsWith("/x?")`, i.e. both comparison
 * shapes the router uses to own a path.
 */
const ROUTE_LITERAL_RE = /req\.url(?:\s*===\s*|\??\.startsWith\()\s*"((?:[^"\\\n]|\\.)*)"/g;

/**
 * Route path literals the router dispatches, in source order, deduplicated.
 * Scoped to the dispatch function body when its markers are present so literals
 * inside unrelated helpers (health, CSP) are not mistaken for routes.
 */
export function extractDispatchedRoutePaths(source) {
  const startMarker = `const ${DISPATCH_FN}`;
  const endMarker = `${GUARDED_DISPATCHER}(`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  const scoped =
    start !== -1 && end !== -1 && end > start ? source.slice(start, end) : source;

  const paths = [];
  ROUTE_LITERAL_RE.lastIndex = 0;
  let match;
  while ((match = ROUTE_LITERAL_RE.exec(scoped)) !== null) {
    const literal = match[1];
    if (literal && !paths.includes(literal)) paths.push(literal);
  }
  return paths;
}

/** Violation: `{ rule, route, detail }`, printable and machine-readable. */
function violation(rule, route, detail) {
  return { rule, route, detail };
}

/**
 * The check itself, with the route table injected so it is unit-testable
 * against fixtures. `planGuard` is the REAL `planRouteGuard` from
 * `server/src/route-table.ts`: the gate asserts the code that runs, not a
 * second copy of its rules.
 */
export function evaluateRoutePolicies({
  policies,
  paidPrefixes,
  dispatchedPaths,
  matchPolicy,
  planGuard,
}) {
  const violations = [];

  if (!Array.isArray(dispatchedPaths) || dispatchedPaths.length === 0) {
    violations.push(
      violation(
        "vacuous-scan",
        "*",
        `no \`req.url\` route literals found in ${SERVER_INDEX} — the scan or the router changed shape, so this gate cannot certify anything`,
      ),
    );
  }

  // 1a. Every dispatched route is classified; 1b. every class is dispatched.
  for (const path of dispatchedPaths) {
    if (!matchPolicy(path)) {
      violations.push(
        violation(
          "unclassified-route",
          path,
          "the router dispatches this path but the route table does not declare it — add a policy (access + guard) to server/src/route-table.ts",
        ),
      );
    }
  }
  for (const policy of policies) {
    const declared = dispatchedPaths.some(
      (path) => matchPolicy(path)?.path === policy.path,
    );
    if (!declared) {
      violations.push(
        violation(
          "dead-policy",
          policy.path,
          "declared in the route table but never dispatched by server/src/index.ts — a policy that matches nothing certifies nothing",
        ),
      );
    }
  }

  // 2. Paid namespace ⇒ entitlement, unless an audited exception says why.
  for (const policy of policies) {
    const paid = paidPrefixes.some((prefix) => policy.path.startsWith(prefix));
    if (policy.access !== "entitlement" && paid && !policy.paidException) {
      violations.push(
        violation(
          "paid-route-not-gated",
          policy.path,
          `under a paid namespace but declared access "${policy.access}" without a paidException reason`,
        ),
      );
    }
  }

  // 3a. An entitlement route must declare a guard mode...
  for (const policy of policies) {
    if (policy.access === "entitlement" && !policy.guard?.mode) {
      violations.push(
        violation(
          "entitlement-without-guard",
          policy.path,
          'access "entitlement" requires a guard mode ("proof")',
        ),
      );
    }
  }

  // 3b. ...and the real planner must actually guard it for every answered
  // method, and must NOT guard it anywhere else. A plan that disagrees with the
  // declaration means the table promises enforcement the dispatcher does not do.
  for (const policy of policies) {
    const declaredMethods = policy.methods.includes("*")
      ? ["GET", "POST"]
      : [...policy.methods];
    const probes = [...new Set([...declaredMethods, "PUT", "__UNSUPPORTED__"])];
    for (const method of probes) {
      const answered =
        policy.methods.includes("*") || policy.methods.includes(method);
      const expected = policy.access === "entitlement" && answered;
      const plan = planGuard(policy, method);
      if (plan.guarded !== expected) {
        violations.push(
          violation(
            "guard-plan-mismatch",
            `${policy.path} [${method}]`,
            `the dispatcher ${plan.guarded ? "guards" : "does not guard"} this request but the policy declares access "${policy.access}"${
              answered ? "" : " for a method the route does not answer"
            }`,
          ),
        );
      }
      if (plan.guarded && !plan.mode) {
        violations.push(
          violation(
            "guard-plan-mismatch",
            `${policy.path} [${method}]`,
            "the dispatcher guards this route without a mode, so it cannot resolve an entitlement",
          ),
        );
      }
    }
  }

  return violations;
}

/**
 * The unguarded dispatch must have exactly one caller. Two occurrences are the
 * declaration and the `dispatch:` wiring; anything more means a route (or a
 * helper) can reach the handler chain without the entitlement guard.
 */
export function checkDispatcherWiring(source) {
  const violations = [];
  const declarations = source.split(DISPATCH_FN).length - 1;
  if (declarations !== 2) {
    violations.push(
      violation(
        "dispatch-fanout",
        DISPATCH_FN,
        `expected exactly 2 references (the declaration and the guarded dispatcher wiring), found ${declarations} — every extra reference can serve a route with no entitlement check`,
      ),
    );
  }
  if (!source.includes(`dispatch: ${DISPATCH_FN}`)) {
    violations.push(
      violation(
        "dispatch-unguarded",
        DISPATCH_FN,
        `the guarded dispatcher is not wired to it (\`dispatch: ${DISPATCH_FN}\` not found in ${SERVER_INDEX})`,
      ),
    );
  }
  if (!source.includes(`${GUARDED_DISPATCHER}({`)) {
    violations.push(
      violation(
        "dispatch-missing",
        GUARDED_DISPATCHER,
        `the router no longer builds its dispatcher from the route table (${GUARDED_DISPATCHER}({ not found)`,
      ),
    );
  }
  // The dispatcher must be wired to the guard the deployment owns, and that
  // guard must be the `createEntitlementGuard(...)` instance built in this
  // module. An inline look-alike — a permissive stub, a second guard built with
  // weaker options — would satisfy the length checks above while enforcing
  // nothing, so the wiring is asserted by shape here.
  //
  // Scoped to the dispatcher call: a bare `guard:` anywhere else in the file
  // (a comment, an unrelated helper) must neither satisfy nor break the rule.
  const callStart = source.indexOf(`${GUARDED_DISPATCHER}({`);
  const call = callStart === -1 ? "" : source.slice(callStart, callStart + 400);
  const guardReference = /\bguard:\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/.exec(call)?.[1];
  const guardRoot = guardReference?.split(".")[0];
  const builtByFactory =
    guardRoot !== undefined &&
    new RegExp(
      `(?:const|let|var)\\s+${guardRoot}\\s*=\\s*${ENTITLEMENT_GUARD_FACTORY}\\s*\\(`,
    ).test(source);
  if (!builtByFactory) {
    violations.push(
      violation(
        "guard-not-shared",
        `${GUARDED_DISPATCHER} guard`,
        `the dispatcher is not wired to a guard built by ${ENTITLEMENT_GUARD_FACTORY}() in ${SERVER_INDEX} — a local replacement could enforce a different policy, or none`,
      ),
    );
  }
  return violations;
}

export function formatViolations(violations) {
  return violations
    .map((entry) => `- ${entry.rule} ${entry.route}: ${entry.detail}`)
    .join("\n");
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const json = process.argv.includes("--json");
  const indexPath = resolve(ROOT, SERVER_INDEX);
  if (!existsSync(indexPath)) {
    console.error(`${TAG} FAIL — ${SERVER_INDEX} does not exist`);
    process.exit(2);
  }

  // Imported through tsx (this script runs as `tsx scripts/check-pro-routes.mjs`)
  // so the gate reads the SAME declarations the server executes.
  let table;
  try {
    table = await import("../server/src/route-table.ts");
  } catch (error) {
    console.error(`${TAG} FAIL — could not load ${ROUTE_TABLE}: ${String(error)}`);
    process.exit(2);
  }

  const source = readFileSync(indexPath, "utf8");
  const dispatchedPaths = extractDispatchedRoutePaths(source);
  const violations = [
    ...evaluateRoutePolicies({
      policies: table.ROUTE_POLICIES,
      paidPrefixes: table.PAID_PATH_PREFIXES,
      dispatchedPaths,
      matchPolicy: (path) => table.matchRoutePolicy(path),
      planGuard: (policy, method) => table.planRouteGuard(policy, method),
    }),
    ...checkDispatcherWiring(source),
  ];

  if (json) {
    console.log(JSON.stringify({ violations, dispatchedPaths }, null, 2));
  } else if (violations.length > 0) {
    console.error(`${TAG} FAIL — ${violations.length} violation(s)`);
    console.error(formatViolations(violations));
  } else {
    const paid = table.ROUTE_POLICIES.filter(
      (policy) => policy.access === "entitlement",
    );
    const modes = new Map();
    for (const policy of paid) {
      const mode = policy.guard?.mode ?? "missing";
      modes.set(mode, (modes.get(mode) ?? 0) + 1);
    }
    const breakdown = [...modes].map(([mode, count]) => `${mode}×${count}`).join(", ");
    console.log(
      `${TAG} ${table.ROUTE_POLICIES.length} routes classified, ${dispatchedPaths.length} dispatched, ` +
        `${paid.length} entitlement-gated (${breakdown})`,
    );
  }

  process.exit(violations.length > 0 ? 1 : 0);
}
