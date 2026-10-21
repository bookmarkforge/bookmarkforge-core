import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import {
  PAID_PATH_PREFIXES,
  ROUTE_POLICIES,
  assertRoutePolicies,
  createRouteDispatcher,
  matchRoutePolicy,
  validateRoutePolicies,
  type RoutePolicy,
} from "../../../server/src/route-table";
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
 * paid route is active; the tripwire rule still has to hold, so it is exercised
 * against fixtures rather than against a table without paid routes.
 */
const FIXTURE_PAID_PREFIXES: readonly string[] = ["/api/paid-fixture/"];

function fixturePolicy(overrides: Partial<RoutePolicy> = {}): RoutePolicy {
  return {
    path: "/api/paid-fixture/generate",
    methods: ["POST"],
    auth: "fixture",
    note: "fixture",
    ...overrides,
  };
}

describe("route policy table", () => {
  it("is internally consistent", () => {
    expect(validateRoutePolicies()).toEqual([]);
    expect(ROUTE_POLICIES.length).toBeGreaterThan(0);
  });

  /**
   * Regression guard for the proxy removal and the 2026-10-19 entitlement-seam
   * retirement. The server used to classify historical paid fixtures and gate
   * them with the entitlement guard. Those routes are gone; re-adding one must
   * be a deliberate act that also re-adds an enforcement point, not a silent
   * side effect of a new `req.url` comparison.
   */
  it("declares no paid route, because no paid route is active", () => {
    expect(PAID_PATH_PREFIXES).toEqual([]);
    expect(matchRoutePolicy("/api/paid-fixture/generate")).toBeUndefined();
    expect(matchRoutePolicy("/api/paid-fixture/session")).toBeUndefined();
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
      assertRoutePolicies([fixturePolicy()], FIXTURE_PAID_PREFIXES),
    ).toThrow(/paid namespace/);
    expect(() =>
      assertRoutePolicies([fixturePolicy({ methods: [] })], []),
    ).toThrow(/no HTTP method/);
    expect(() =>
      assertRoutePolicies([fixturePolicy(), fixturePolicy()], []),
    ).toThrow(/duplicate route policy/);
  });
});

describe("paid namespace tripwire", () => {
  it("reports a route under a paid prefix, because no enforcement point exists", () => {
    expect(validateRoutePolicies([fixturePolicy()], FIXTURE_PAID_PREFIXES)).toEqual([
      expect.stringContaining("paid namespace"),
    ]);
  });

  it("leaves the same route alone outside a paid namespace", () => {
    expect(validateRoutePolicies([fixturePolicy()], [])).toEqual([]);
  });
});

describe("HTTP dispatcher", () => {
  const res = {} as unknown as ServerResponse;

  it("forwards every declared route to the handler", async () => {
    const dispatched: string[] = [];
    const dispatcher = createRouteDispatcher({
      dispatch: (req) => {
        dispatched.push(req.url ?? "");
      },
    });

    await dispatcher(fakeRequest("/health", "GET"), res);
    await dispatcher(fakeRequest("/api/analytics/kpis", "GET"), res);
    expect(dispatched).toEqual(["/health", "/api/analytics/kpis"]);
  });

  it("builds from the real, consistent table", () => {
    // The throw path (a contradictory table) is covered through
    // `assertRoutePolicies` above, which this constructor calls before serving.
    expect(() => createRouteDispatcher({ dispatch: () => {} })).not.toThrow();
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
    expect(dispatchedPaths.length).toBeGreaterThan(5);
    expect(dispatchedPaths).toContain("/health");
    expect(dispatchedPaths).toContain("/api/client-events");
    expect(dispatchedPaths).toContain("/api/analytics/kpis");
  });

  it("classifies every dispatched route and flags every dead policy", () => {
    const violations = evaluateRoutePolicies({
      policies: ROUTE_POLICIES,
      paidPrefixes: PAID_PATH_PREFIXES,
      dispatchedPaths,
      matchPolicy: (path) => matchRoutePolicy(path),
    });
    expect(violations).toEqual([]);
  });

  it("reaches the dispatch from exactly one place", () => {
    expect(checkDispatcherWiring(source)).toEqual([]);
  });
});
