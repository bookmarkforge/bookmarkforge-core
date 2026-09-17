import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import {
  PAID_PATH_PREFIXES,
  ROUTE_POLICIES,
  assertRoutePolicies,
  createGuardedDispatcher,
  matchRoutePolicy,
  planRouteGuard,
  policyAllowsMethod,
  validateRoutePolicies,
  type RoutePolicy,
} from "../../../server/src/route-table";
import type { EntitlementGuard } from "../../../server/src/entitlement-guard";
import {
  checkDispatcherWiring,
  evaluateRoutePolicies,
  extractDispatchedRoutePaths,
} from "../../../scripts/check-pro-routes.mjs";

function fakeRequest(url: string, method = "POST"): IncomingMessage {
  return { url, method, headers: {} } as unknown as IncomingMessage;
}

/**
 * A synthetic paid namespace. The real `PAID_PATH_PREFIXES` is empty because no
 * paid route is active. The classification rules still have to hold, so they
 * are exercised against fixtures rather than against a table without paid
 * routes.
 */
const FIXTURE_PAID_PREFIXES: readonly string[] = ["/api/paid-fixture/"];

function fixturePolicy(overrides: Partial<RoutePolicy> = {}): RoutePolicy {
  return {
    path: "/api/paid-fixture/generate",
    methods: ["POST"],
    access: "entitlement",
    guard: { mode: "proof" },
    auth: "fixture",
    note: "fixture",
    ...overrides,
  } as RoutePolicy;
}

describe("route policy table", () => {
  it("is internally consistent", () => {
    expect(validateRoutePolicies()).toEqual([]);
    expect(ROUTE_POLICIES.length).toBeGreaterThan(0);
  });

  /**
   * Regression guard for the proxy removal. The server used to classify
   * the historical paid fixture as paid and gate it with the entitlement guard. Those
   * routes are gone; re-adding one must be a deliberate act that also re-adds
   * the paid prefix, not a silent side effect of a new `req.url` comparison.
   */
  it("declares no paid route, because no paid route is active", () => {
    expect(PAID_PATH_PREFIXES).toEqual([]);
    for (const policy of ROUTE_POLICIES) {
      expect(policy.access, policy.path).toBe("public");
      expect(policy.guard, policy.path).toBeUndefined();
    }
    expect(matchRoutePolicy("/api/paid-fixture/generate")).toBeUndefined();
    expect(matchRoutePolicy("/api/paid-fixture/session")).toBeUndefined();
  });

  it("leaves a method the route does not answer to the handler", () => {
    const policy = matchRoutePolicy("/health")!;
    expect(policyAllowsMethod(policy, "GET")).toBe(true);
    expect(policyAllowsMethod(policy, "POST")).toBe(false);
    // A wrong method keeps answering 405/426 from the handler instead of
    // becoming an entitlement denial for a body the request does not carry.
    expect(planRouteGuard(policy, "POST").guarded).toBe(false);
  });

  it("matches query strings and subpaths by path identity", () => {
    expect(matchRoutePolicy("/health?a=1")?.path).toBe("/health");
    expect(matchRoutePolicy("/csp-report?x=1")?.path).toBe("/csp-report");
    expect(matchRoutePolicy("/api/client-events/retry-stats")?.path).toBe(
      "/api/client-events",
    );
    expect(matchRoutePolicy("/api/analytics/kpis?day=1")?.path).toBe("/api/analytics/kpis");
    expect(matchRoutePolicy("/nope")).toBeUndefined();
    expect(matchRoutePolicy(undefined)).toBeUndefined();
  });

  it("refuses a table that contradicts itself", () => {
    expect(() =>
      assertRoutePolicies(
        [fixturePolicy({ access: "public", guard: undefined, auth: "none", note: "" })],
        FIXTURE_PAID_PREFIXES,
      ),
    ).toThrow(/paid namespace/);
    expect(() =>
      assertRoutePolicies(
        [fixturePolicy({ guard: undefined, auth: "none", note: "" })],
        FIXTURE_PAID_PREFIXES,
      ),
    ).toThrow(/requires a guard mode/);
    expect(() =>
      assertRoutePolicies(
        [fixturePolicy({ note: "" }), fixturePolicy({ note: "" })],
        FIXTURE_PAID_PREFIXES,
      ),
    ).toThrow(/duplicate route policy/);
  });
});

describe("paid-route classification", () => {
  it("plans the guard mode a paid route declares", () => {
    const policy = fixturePolicy();
    expect(planRouteGuard(policy, "POST")).toMatchObject({
      guarded: true,
      mode: "proof",
    });
    expect(planRouteGuard(policy, "GET")).toEqual({ guarded: false });
    expect(validateRoutePolicies([policy], FIXTURE_PAID_PREFIXES)).toEqual([]);
  });

  it("reports a paid route classified public without an audited exception", () => {
    const policy = fixturePolicy({ access: "public", guard: undefined });
    expect(validateRoutePolicies([policy], FIXTURE_PAID_PREFIXES)).toEqual([
      expect.stringContaining("paid namespace"),
    ]);
    // The audited exception is what makes the classification legitimate.
    expect(
      validateRoutePolicies(
        [{ ...policy, paidException: "operator-token gated" }],
        FIXTURE_PAID_PREFIXES,
      ),
    ).toEqual([]);
  });
});

describe("guarded HTTP dispatcher", () => {
  function stubGuard(calls: Array<{ mode: string; path: string | undefined }>) {
    const guard = {
      verifyProof: () => {
        throw new Error("not used");
      },
      attach: async () => {
        throw new Error("not used");
      },
      middleware:
        (mode: string) =>
        async (
          req: IncomingMessage,
          _res: ServerResponse,
          next: (context: unknown) => void | Promise<void>,
        ) => {
          calls.push({ mode, path: req.url });
          await next({ via: "anonymous", identity: "anonymous", entitlement: null });
        },
      enforced: true,
      publicKeySpki: "spki",
    };
    return guard as unknown as EntitlementGuard;
  }

  const res = {} as unknown as ServerResponse;

  it("does not consult the guard for public routes, unknown paths or unhandled methods", async () => {
    const calls: Array<{ mode: string; path: string | undefined }> = [];
    const dispatch = () => {};
    const dispatcher = createGuardedDispatcher({ guard: stubGuard(calls), dispatch });

    await dispatcher(fakeRequest("/health", "GET"), res);
    await dispatcher(fakeRequest("/nope", "GET"), res);
    await dispatcher(fakeRequest("/health", "POST"), res);
    expect(calls).toEqual([]);
  });

  // With no entitlement route in the table, every declared route reaches the
  // handler unguarded. This is the shape of the tree today; the previous
  // "guards a paid route with the mode its policy declares" case lives on as
  // fixture coverage in `scripts/__tests__/check-pro-routes.test.mjs`.
  it("dispatches every declared route without asking the guard", async () => {
    const calls: Array<{ mode: string; path: string | undefined }> = [];
    const dispatched: string[] = [];
    const dispatcher = createGuardedDispatcher({
      guard: stubGuard(calls),
      dispatch: (req) => {
        dispatched.push(req.url ?? "");
      },
    });

    await dispatcher(fakeRequest("/health", "GET"), res);
    await dispatcher(fakeRequest("/api/analytics/kpis", "GET"), res);
    expect(dispatched).toEqual(["/health", "/api/analytics/kpis"]);
    expect(calls).toEqual([]);
  });
});

/**
 * The same contract `scripts/check-pro-routes.mjs` enforces in CI, asserted
 * here against the real tree so the unit suite catches a regression even before
 * the gate runs.
 */
describe("router coverage of the route table", () => {
  const serverIndex = resolve(process.cwd(), "server", "src", "index.ts");
  const source = readFileSync(serverIndex, "utf8");
  const dispatchedPaths = extractDispatchedRoutePaths(source);

  it("finds the router's real routes (anti-vacuity)", () => {
    expect(dispatchedPaths.length).toBeGreaterThan(10);
    expect(dispatchedPaths).toContain("/health");
    expect(dispatchedPaths).toContain("/api/license/entitlement");
    expect(dispatchedPaths).toContain("/api/analytics/kpis");
  });

  it("classifies every dispatched route and gates every paid one", () => {
    const violations = evaluateRoutePolicies({
      policies: ROUTE_POLICIES,
      paidPrefixes: PAID_PATH_PREFIXES,
      dispatchedPaths,
      matchPolicy: (path) => matchRoutePolicy(path),
      planGuard: (policy, method) => planRouteGuard(policy, method),
    });
    expect(violations).toEqual([]);
  });

  it("reaches the unguarded dispatch from exactly one place", () => {
    expect(checkDispatcherWiring(source)).toEqual([]);
  });
});
