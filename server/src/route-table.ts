/**
 * server/src/route-table.ts — which HTTP routes this server answers.
 *
 * The router used to be a chain of `if (req.url === "...")` comparisons in
 * `index.ts`, so "is this route accounted for?" was answerable only by reading
 * the chain. This table makes the answer data: `createRouteDispatcher()` builds
 * the single HTTP entry point from it, and `scripts/check-pro-routes.mjs` fails
 * the build when:
 *
 *   - a route the router dispatches is not declared here (unclassified route);
 *   - a route here is never dispatched (dead policy);
 *   - a route appears under a paid path prefix (see `PAID_PATH_PREFIXES`).
 *
 * The entitlement guard that used to wrap this dispatcher was retired on
 * 2026-10-19 together with the license/entitlement server surface: the server
 * serves health, admin, CSP, Open Graph, analytics and P2P signaling routes,
 * and license validation is client-side. `PAID_PATH_PREFIXES` stays declared
 * and empty because it is the tripwire the gate reads — adding the first route
 * under a paid namespace fails the build until an enforcement point exists
 * again, instead of shipping an unguarded money-spending route.
 *
 * A table that contradicts itself (a duplicate path) throws when the dispatcher
 * is built, so the process refuses to start rather than serve a table it cannot
 * trust.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Path prefixes that cost money or expose paid capability when called.
 *
 * Empty by design: no route this server serves is paid. The gate still reads
 * this list so the first paid route cannot be added silently.
 */
export const PAID_PATH_PREFIXES: readonly string[] = [];

/** `"prefix"` matches the path itself and every subpath under it. */
export type RouteMatch = "exact" | "prefix";

export interface RoutePolicy {
  path: string;
  /** Defaults to `"exact"`. */
  match?: RouteMatch;
  /** HTTP methods this route answers; `"*"` when the handler decides. */
  methods: readonly string[];
  /** How the route protects itself (rate limits, tokens, verification). */
  auth: string;
  note: string;
}

export const ROUTE_POLICIES: readonly RoutePolicy[] = [
  {
    path: "/health",
    methods: ["GET"],
    auth: "none (liveness probe)",
    note: "Load balancer and monitoring probe.",
  },
  {
    path: "/admin",
    methods: ["GET"],
    auth: "signaling admin token (verified inside the handler)",
    note: "Signaling-server diagnostics; never carries customer data.",
  },
  {
    path: "/csp-report",
    methods: ["*"],
    auth: "origin filtering + per-IP rate limit inside the handler",
    note: "CSP violation reports; the browser posts these without credentials.",
  },
  {
    path: "/api/client-events",
    match: "prefix",
    methods: ["*"],
    auth: "pseudonymous, content-free payload validation + per-IP rate limit",
    note: "Storage-pressure and bundle-integrity telemetry, including /retry-stats subpaths.",
  },
  {
    path: "/api/analytics/events",
    methods: ["*"],
    auth: "opt-in, pseudonymous events with payload validation + rate limit",
    note: "Aggregated product analytics; no account or content data.",
  },
  {
    path: "/api/analytics/kpis",
    methods: ["*"],
    auth: "aggregate-only read; payload validation + rate limit",
    note: "Daily aggregate buckets for the operator dashboard.",
  },
  {
    path: "/og",
    methods: ["GET"],
    auth: "none (public Open Graph card generation)",
    note: "Generates dynamic SVG-based Open Graph cards for social sharing.",
  },
];

/** Strip the query string: route identity is the path. */
export function normalizeRoutePath(url: string | undefined | null): string {
  if (!url) return "";
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
}

/** The policy that owns a path, or undefined when nothing declares it. */
export function matchRoutePolicy(path: string | undefined | null): RoutePolicy | undefined {
  const normalized = normalizeRoutePath(path);
  if (normalized.length === 0) return undefined;
  return ROUTE_POLICIES.find((policy) =>
    policy.match === "prefix"
      ? normalized === policy.path || normalized.startsWith(`${policy.path}/`)
      : normalized === policy.path,
  );
}

/**
 * Contradictions in the table itself. Returns human-readable problems rather
 * than throwing so the gate can print them all; the runtime below throws.
 */
export function validateRoutePolicies(
  policies: readonly RoutePolicy[] = ROUTE_POLICIES,
  paidPrefixes: readonly string[] = PAID_PATH_PREFIXES,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const policy of policies) {
    if (seen.has(policy.path)) problems.push(`${policy.path}: duplicate route policy`);
    seen.add(policy.path);
    if (policy.methods.length === 0) problems.push(`${policy.path}: declares no HTTP method`);
    if (paidPrefixes.some((prefix) => policy.path.startsWith(prefix))) {
      problems.push(
        `${policy.path}: declared under a paid namespace, but this server has no enforcement point — re-add one before mounting a route that costs money`,
      );
    }
  }
  return problems;
}

/**
 * Refuse to build a dispatcher from a table that contradicts itself.
 *
 * This used to run at module scope, which made the module un-importable and hid
 * *which* policy was wrong behind a loader error. It runs here instead: the
 * server always builds its dispatcher at startup, so an inconsistent table
 * still cannot serve traffic — and the gate can read the table to report every
 * problem as a violation rather than an opaque crash.
 */
export function assertRoutePolicies(
  policies: readonly RoutePolicy[] = ROUTE_POLICIES,
  paidPrefixes: readonly string[] = PAID_PATH_PREFIXES,
): void {
  const problems = validateRoutePolicies(policies, paidPrefixes);
  if (problems.length > 0) {
    throw new Error(`[route-table] inconsistent route policies:\n- ${problems.join("\n- ")}`);
  }
}

export interface RouteDispatcherOptions {
  /**
   * The HTTP dispatch. Only the returned dispatcher may call it; the
   * pro-route gate asserts `index.ts` reaches it from exactly one place.
   */
  dispatch: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

/**
 * The single entry point for HTTP requests: validate the route table, then
 * dispatch. Routes that are not declared still reach the dispatch function so
 * the 426 catch-all and the handlers' own 405s keep working — declaration is a
 * build-time contract enforced by `check:pro-routes`, not a runtime gate.
 */
export function createRouteDispatcher(
  options: RouteDispatcherOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  // Fail closed at construction: an inconsistent table must not serve traffic.
  assertRoutePolicies();
  return async (req, res) => {
    await options.dispatch(req, res);
  };
}
