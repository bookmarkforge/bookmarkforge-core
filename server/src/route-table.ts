/**
 * server/src/route-table.ts — which HTTP routes this server answers, and which
 * of them are paid (Pro) surfaces.
 *
 * The router used to be a chain of `if (req.url === "...")` comparisons in
 * `index.ts`, so "is this route entitlement-gated?" was answerable only by
 * reading the chain and knowing which handlers verify a proof. Adding a route
 * that spends money (a new AI modality, a new cloud-backed feature) required
 * remembering to gate it; nothing failed when you did not.
 *
 * This table makes the answer data. `createGuardedDispatcher()` applies the
 * entitlement guard to every route declared `access: "entitlement"` before the
 * handler can run, and `scripts/check-pro-routes.mjs` fails the build when:
 *
 *   - a route the router dispatches is not declared here (unclassified route);
 *   - a route here is never dispatched (dead policy);
 *   - a route under a paid namespace is not entitlement-gated and gives no
 *     `paidException` reason.
 *
 * A table that contradicts itself (an entitlement route without a guard mode)
 * throws at import time, so the process refuses to start rather than serve a
 * paid route unguarded.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { EntitlementGuard, GuardMode } from "./entitlement-guard";

/**
 * Path prefixes that cost money or expose paid capability when called. A route
 * under one of these is entitlement-gated unless it records a `paidException`
 * (an audited "this is not what Pro means here" reason, e.g. an
 * operator-token-gated admin surface).
 *
 * The server serves only license, health, admin, CSP, analytics and P2P
 * signaling routes.
 */
export const PAID_PATH_PREFIXES: readonly string[] = [];

export type RouteAccess = "public" | "entitlement";
/** `"prefix"` matches the path itself and every subpath under it. */
export type RouteMatch = "exact" | "prefix";

export interface RouteGuardSpec {
  mode: GuardMode;
  /** What the request body is, for denial messages ("license proof"). */
  proofLabel?: string;
}

export interface RoutePolicy {
  path: string;
  /** Defaults to `"exact"`. */
  match?: RouteMatch;
  /** HTTP methods this route answers; `"*"` when the handler decides. */
  methods: readonly string[];
  access: RouteAccess;
  /** Required when `access` is `"entitlement"`. */
  guard?: RouteGuardSpec;
  /** How a public route protects itself (rate limits, tokens, verification). */
  auth: string;
  /** Why a route under a paid prefix is not entitlement-gated. */
  paidException?: string;
  note: string;
}

export const ROUTE_POLICIES: readonly RoutePolicy[] = [
  {
    path: "/api/license/health",
    methods: ["*"],
    access: "public",
    auth: "license server (origin check + per-IP rate limit)",
    note: "Health of the licensing provider integration.",
  },
  {
    path: "/api/license/activate",
    methods: ["*"],
    access: "public",
    auth: "license server (origin check + per-IP rate limit)",
    note: "Activation exchanges a purchased key for a signed proof; the caller has no proof yet.",
  },
  {
    path: "/api/license/validate",
    methods: ["*"],
    access: "public",
    auth: "license server (origin check + per-IP rate limit)",
    note: "Revalidation of an existing key, reached while the vault may still be locked.",
  },
  {
    path: "/api/license/deactivate",
    methods: ["*"],
    access: "public",
    auth: "license server (origin check + per-IP rate limit)",
    note: "Releases an activation slot; requiring a proof here would strand a lost device.",
  },
  {
    path: "/api/license/entitlement",
    methods: ["POST"],
    access: "public",
    auth: "verifies the caller's own proof; answers { plan: \"pro\" | \"free\" }",
    note:
      "An entitlement *answer*, not an entitlement gate: it must serve a free or expired client so " +
      "it can be downgraded explicitly. Gating it with `access: \"entitlement\"` would make the " +
      "endpoint unreachable exactly when it is useful.",
  },
  {
    path: "/health",
    methods: ["GET"],
    access: "public",
    auth: "none (liveness probe)",
    note: "Load balancer and monitoring probe.",
  },
  {
    path: "/admin",
    methods: ["GET"],
    access: "public",
    auth: "signaling admin token (verified inside the handler)",
    note: "Signaling-server diagnostics; never carries customer data.",
  },
  {
    path: "/csp-report",
    methods: ["*"],
    access: "public",
    auth: "origin filtering + per-IP rate limit inside the handler",
    note: "CSP violation reports; the browser posts these without credentials.",
  },
  {
    path: "/api/client-events",
    match: "prefix",
    methods: ["*"],
    access: "public",
    auth: "pseudonymous, content-free payload validation + per-IP rate limit",
    note: "Storage-pressure and bundle-integrity telemetry, including /retry-stats subpaths.",
  },
  {
    path: "/api/analytics/events",
    methods: ["*"],
    access: "public",
    auth: "opt-in, pseudonymous events with payload validation + rate limit",
    note: "Aggregated product analytics; no account or content data.",
  },
  {
    path: "/api/analytics/kpis",
    methods: ["*"],
    access: "public",
    auth: "aggregate-only read; payload validation + rate limit",
    note: "Daily aggregate buckets for the operator dashboard.",
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

/** Whether a route answers a method (`"*"` means the handler decides). */
export function policyAllowsMethod(policy: RoutePolicy, method: string | undefined): boolean {
  if (policy.methods.includes("*")) return true;
  const normalized = (method ?? "GET").toUpperCase();
  return policy.methods.some((allowed) => allowed.toUpperCase() === normalized);
}

export type RouteGuardPlan =
  | { guarded: false }
  | { guarded: true; mode: GuardMode; proofLabel?: string };

/**
 * What the dispatcher must do for one request to one route.
 *
 * A method the route does not answer is deliberately left unguarded: a wrong
 * method still reaches the handler and answers 405/426 as it always has,
 * instead of being turned into an entitlement denial for a body it does not
 * carry.
 */
export function planRouteGuard(
  policy: RoutePolicy,
  method: string | undefined,
): RouteGuardPlan {
  if (policy.access !== "entitlement") return { guarded: false };
  if (!policyAllowsMethod(policy, method)) return { guarded: false };
  const guard = policy.guard;
  if (!guard) return { guarded: false };
  return {
    guarded: true,
    mode: guard.mode,
    ...(guard.proofLabel !== undefined ? { proofLabel: guard.proofLabel } : {}),
  };
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
    const paid = paidPrefixes.some((prefix) => policy.path.startsWith(prefix));
    if (policy.access === "entitlement") {
      if (!policy.guard) {
        problems.push(`${policy.path}: access "entitlement" requires a guard mode`);
      }
    } else if (paid && !policy.paidException) {
      problems.push(
        `${policy.path}: under a paid namespace but declared "${policy.access}" without a paidException reason`,
      );
    }
  }
  return problems;
}

/**
 * Refuse to build an enforcement point from a table that contradicts itself.
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

export interface GuardedHttpDispatcherOptions {
  guard: EntitlementGuard;
  /**
   * The unguarded dispatch. Only the returned dispatcher may call it; the
   * pro-route gate asserts `index.ts` reaches it from exactly one place.
   */
  dispatch: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

/**
 * The single entry point for HTTP requests: resolve the route policy, apply the
 * entitlement guard when the route is a paid surface, then dispatch. Routes
 * that are not declared (or a method the route does not answer) fall through
 * unchanged, so the 426 catch-all and the handlers' own 405s keep working.
 */
export function createGuardedDispatcher(
  options: GuardedHttpDispatcherOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  // Fail closed at construction: without this, a hand-edited table could ship
  // a paid route with no guard mode and `planRouteGuard` would quietly return
  // "not guarded" for it.
  assertRoutePolicies();
  return async (req, res) => {
    const policy = matchRoutePolicy(req.url);
    const plan = policy ? planRouteGuard(policy, req.method) : { guarded: false as const };
    if (!plan.guarded) {
      await options.dispatch(req, res);
      return;
    }
    const middleware = options.guard.middleware(
      plan.mode,
      plan.proofLabel !== undefined ? { proofLabel: plan.proofLabel } : {},
    );
    await middleware(req, res, () => options.dispatch(req, res));
  };
}
