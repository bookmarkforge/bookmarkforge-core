#!/usr/bin/env node
/**
 * scripts/check-pro-routes.mjs — fail the build when the HTTP surface and its
 * declared route table disagree.
 *
 * Route accounting used to be knowledge carried in someone's head: the HTTP
 * router was a chain of `req.url === "..."` comparisons, and whether a route
 * verified a license proof was invisible in a diff. `server/src/route-table.ts`
 * now declares every route, and `createRouteDispatcher()` builds the single
 * HTTP entry point from it. This gate closes the loop by comparing that
 * declaration against the router that actually runs:
 *
 *   1. COVERAGE     every `req.url` the router dispatches is declared in the
 *                   route table (a new route cannot be mounted unclassified),
 *                   and every declared route is dispatched (no dead policy
 *                   that makes the table look complete while it is not);
 *   2. CAPABILITY   a route under a paid namespace (`PAID_PATH_PREFIXES` in the
 *                   route table; empty today) is a violation, because this
 *                   server no longer has an enforcement point to gate it —
 *                   re-adding the first paid route has to re-add enforcement
 *                   rather than ship unguarded;
 *   3. WIRING       the dispatch function must have exactly one caller — the
 *                   route dispatcher — so no route can bypass the table.
 *
 * The entitlement guard and its proof/session modes were retired on 2026-10-19
 * with the license/entitlement server surface; there is no `access` field and
 * no guard plan left to agree with.
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
 * The HTTP dispatch. Exported by name so the wiring rule and the router cannot
 * drift apart silently: renaming it in `index.ts` fails this gate until the
 * gate is updated in the same change.
 */
export const DISPATCH_FN = "dispatchHttpRequest";
/** The only function allowed to call `DISPATCH_FN`. */
export const ROUTE_DISPATCHER = "createRouteDispatcher";

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
  const endMarker = `${ROUTE_DISPATCHER}(`;
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
 * against fixtures. `matchPolicy` must be the REAL `matchRoutePolicy` from
 * `server/src/route-table.ts`: the gate asserts the code that runs, not a
 * second copy of its rules.
 */
export function evaluateRoutePolicies({
  policies,
  paidPrefixes,
  dispatchedPaths,
  matchPolicy,
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
          "the router dispatches this path but the route table does not declare it — add a policy to server/src/route-table.ts",
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
    if (!Array.isArray(policy.methods) || policy.methods.length === 0) {
      violations.push(
        violation(
          "empty-methods",
          policy.path,
          "the policy declares no HTTP method, so nothing documents what this route answers",
        ),
      );
    }
  }

  // 2. A paid namespace has no enforcement point left: adding one back fails.
  for (const policy of policies) {
    if (paidPrefixes.some((prefix) => policy.path.startsWith(prefix))) {
      violations.push(
        violation(
          "paid-route-without-enforcement",
          policy.path,
          `under a paid namespace (${paidPrefixes.join(", ")}) but this server has no entitlement guard — re-add an enforcement point before mounting a paid route`,
        ),
      );
    }
  }

  return violations;
}

/**
 * The HTTP dispatch must have exactly one caller. Two occurrences are the
 * declaration and the `dispatch:` wiring; anything more means a route (or a
 * helper) can reach the handler chain without passing through the dispatcher.
 */
export function checkDispatcherWiring(source) {
  const violations = [];
  const declarations = source.split(DISPATCH_FN).length - 1;
  if (declarations !== 2) {
    violations.push(
      violation(
        "dispatch-fanout",
        DISPATCH_FN,
        `expected exactly 2 references (the declaration and the dispatcher wiring), found ${declarations} — every extra reference can serve a route without passing through the route table`,
      ),
    );
  }
  if (!source.includes(`dispatch: ${DISPATCH_FN}`)) {
    violations.push(
      violation(
        "dispatch-unwired",
        DISPATCH_FN,
        `the route dispatcher is not wired to it (\`dispatch: ${DISPATCH_FN}\` not found in ${SERVER_INDEX})`,
      ),
    );
  }
  if (!source.includes(`${ROUTE_DISPATCHER}({`)) {
    violations.push(
      violation(
        "dispatch-missing",
        ROUTE_DISPATCHER,
        `the router no longer builds its dispatcher from the route table (${ROUTE_DISPATCHER}({ not found)`,
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
    }),
    ...checkDispatcherWiring(source),
  ];

  if (json) {
    console.log(JSON.stringify({ violations, dispatchedPaths }, null, 2));
  } else if (violations.length > 0) {
    console.error(`${TAG} FAIL — ${violations.length} violation(s)`);
    console.error(formatViolations(violations));
  } else {
    const paidPrefixes = [...table.PAID_PATH_PREFIXES];
    console.log(
      `${TAG} ${table.ROUTE_POLICIES.length} routes classified, ${dispatchedPaths.length} dispatched, ` +
        `${paidPrefixes.length} paid path prefix(es) declared`,
    );
  }

  process.exit(violations.length > 0 ? 1 : 0);
}
