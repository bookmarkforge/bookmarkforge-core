import { describe, expect, it } from "vitest";
import {
  DISPATCH_FN,
  ENTITLEMENT_GUARD_FACTORY,
  checkDispatcherWiring,
  evaluateRoutePolicies,
  extractDispatchedRoutePaths,
  formatViolations,
} from "../check-pro-routes.mjs";

const PAID = ["/api/paid-fixture/"];

function policy(overrides) {
  return {
    path: "/api/paid-fixture/generate",
    methods: ["POST"],
    access: "entitlement",
    guard: { mode: "proof" },
    auth: "AI session",
    note: "fixture",
    ...overrides,
  };
}

/**
 * A stand-in for `server/src/route-table.ts` with the same semantics, so these
 * tests exercise the gate's rules without depending on the current contents of
 * the real table (route-table.test.ts asserts the real tree).
 */
function stubTable(policies) {
  const match = (path) => {
    const normalized = String(path).split("?")[0];
    return policies.find((entry) =>
      entry.match === "prefix"
        ? normalized === entry.path || normalized.startsWith(`${entry.path}/`)
        : normalized === entry.path,
    );
  };
  const plan = (entry, method) => {
    if (entry.access !== "entitlement") return { guarded: false };
    const answered = entry.methods.includes("*") || entry.methods.includes(method);
    if (!answered) return { guarded: false };
    if (!entry.guard?.mode) return { guarded: false };
    return { guarded: true, mode: entry.guard.mode };
  };
  return { match, plan };
}

function evaluate({ policies, dispatched, plan }) {
  const table = stubTable(policies);
  return evaluateRoutePolicies({
    policies,
    paidPrefixes: PAID,
    dispatchedPaths: dispatched,
    matchPolicy: table.match,
    planGuard: plan ?? table.plan,
  });
}

const rules = (violations) => violations.map((entry) => entry.rule);

describe("pro-route gate", () => {
  it("passes a consistent table whose paid routes are gated", () => {
    const policies = [
      policy({}),
      policy({ path: "/health", methods: ["GET"], access: "public", guard: undefined }),
      policy({
        path: "/api/paid-fixture/admin",
        methods: ["*"],
        access: "public",
        guard: undefined,
        paidException: "operator token, no upstream call",
      }),
    ];
    expect(evaluate({ policies, dispatched: policies.map((entry) => entry.path) })).toEqual([]);
  });

  it("fails when the router dispatches a paid route the table never classified", () => {
    const violations = evaluate({
      policies: [policy({})],
      dispatched: ["/api/paid-fixture/generate", "/api/paid-fixture/generate-video"],
    });
    expect(rules(violations)).toContain("unclassified-route");
    expect(violations[0].detail).toMatch(/route table does not declare it/);
  });

  it("fails on a policy that is never dispatched", () => {
    const violations = evaluate({
      policies: [policy({}), policy({ path: "/api/paid-fixture/generate-image" })],
      dispatched: ["/api/paid-fixture/generate"],
    });
    expect(rules(violations)).toContain("dead-policy");
  });

  it("fails when a paid route is declared public without an exemption", () => {
    const violations = evaluate({
      policies: [policy({ access: "public", guard: undefined, auth: "none" })],
      dispatched: ["/api/paid-fixture/generate"],
    });
    expect(rules(violations)).toContain("paid-route-not-gated");
  });

  it("fails when an entitlement route has no guard mode", () => {
    const violations = evaluate({
      policies: [policy({ guard: undefined })],
      dispatched: ["/api/paid-fixture/generate"],
    });
    expect(rules(violations)).toEqual(
      expect.arrayContaining(["entitlement-without-guard", "guard-plan-mismatch"]),
    );
  });

  it("fails when the real planner guards a route the table calls public", () => {
    // The table promises public but the dispatcher gates it: clients would be
    // refused a route the policy says is open. Only a check against the real
    // planner catches this.
    const violations = evaluate({
      policies: [policy({ access: "public", guard: undefined, path: "/health", methods: ["GET"] })],
      dispatched: ["/health"],
      plan: () => ({ guarded: true, mode: "session" }),
    });
    expect(rules(violations)).toContain("guard-plan-mismatch");
  });

  it("fails closed when the scan finds no route at all", () => {
    const violations = evaluate({ policies: [policy({})], dispatched: [] });
    expect(rules(violations)).toContain("vacuous-scan");
  });

  it("formats violations with rule, route and detail", () => {
    const text = formatViolations([
      { rule: "unclassified-route", route: "/x", detail: "why" },
    ]);
    expect(text).toBe("- unclassified-route /x: why");
  });
});

describe("pro-route gate route scanner", () => {
  const source = `
const dispatchUnGuardedRequest = (req, res) => {
  if (req.url === "/a") { return; }
  if (req.url === "/b" || req.url?.startsWith("/b?")) { return; }
  if (req.url?.startsWith("/c/")) { return; }
};
const settle = createGuardedDispatcher({ guard, dispatch: dispatchUnGuardedRequest });
function healthHandler(req, res) { if (req.method === "GET" && req.url === "/should-not-be-scanned") {} }
`;

  it("extracts both comparison shapes, deduplicated", () => {
    expect(extractDispatchedRoutePaths(source)).toEqual(["/a", "/b", "/b?", "/c/"]);
  });

  it("ignores literals outside the dispatch function", () => {
    expect(extractDispatchedRoutePaths(source)).not.toContain("/should-not-be-scanned");
  });
});

describe("pro-route gate dispatcher wiring", () => {
  const good = `
const ${DISPATCH_FN} = (req, res) => {};
const entitlementGuard = createEntitlementGuard();
const settleHttpRequest = createGuardedDispatcher({
  guard: entitlementGuard,
  dispatch: ${DISPATCH_FN},
});
`;

  it("passes the single guarded call site", () => {
    expect(checkDispatcherWiring(good)).toEqual([]);
  });

  it("fails when the unguarded dispatch gains another caller", () => {
    const mutated = good.replace(
      "const settleHttpRequest = createGuardedDispatcher({",
      `if (DEV) { ${DISPATCH_FN}(req, res); }\nconst settleHttpRequest = createGuardedDispatcher({`,
    );
    expect(rules(checkDispatcherWiring(mutated))).toContain("dispatch-fanout");
  });

  it("fails when the dispatcher is not wired to the unguarded dispatch", () => {
    expect(rules(checkDispatcherWiring(good.replace(`dispatch: ${DISPATCH_FN},`, "dispatch: other,")))).toContain(
      "dispatch-unguarded",
    );
  });

  it("fails when the router stops building a guarded dispatcher", () => {
    expect(rules(checkDispatcherWiring("const x = 1;"))).toEqual(
      expect.arrayContaining(["dispatch-fanout", "dispatch-unguarded", "dispatch-missing", "guard-not-shared"]),
    );
  });

  it("fails when the guard is replaced by an inline stub", () => {
    const mutated = good.replace(
      "guard: entitlementGuard,",
      "guard: { middleware: () => async (req, res, next) => next(), },",
    );
    expect(rules(checkDispatcherWiring(mutated))).toContain("guard-not-shared");
  });

  it("fails when the guard identifier is not built by the shared factory", () => {
    // A same-shaped variable that never went through createEntitlementGuard()
    // is exactly the "a local replacement could enforce a different policy, or
    // none" case the rule exists for.
    const mutated = good.replace(
      `const entitlementGuard = ${ENTITLEMENT_GUARD_FACTORY}();`,
      "const entitlementGuard = { middleware: () => async (req, res, next) => next() };",
    );
    expect(rules(checkDispatcherWiring(mutated))).toContain("guard-not-shared");
  });

  it("ignores a `guard:` mention outside the dispatcher call", () => {
    const annotated = `// TRUST_PROXY guard: when the server binds to 0.0.0.0\n${good}`;
    expect(checkDispatcherWiring(annotated)).toEqual([]);
  });
});
