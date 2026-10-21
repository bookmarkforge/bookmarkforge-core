import { describe, expect, it } from "vitest";
import {
  DISPATCH_FN,
  ROUTE_DISPATCHER,
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
    auth: "fixture",
    note: "fixture",
    ...overrides,
  };
}

/**
 * A stand-in for `server/src/route-table.ts` with the same matching semantics,
 * so these tests exercise the gate's rules without depending on the current
 * contents of the real table (route-table.test.ts asserts the real tree).
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
  return { match };
}

function evaluate({ policies, dispatched, match }) {
  const table = stubTable(policies);
  return evaluateRoutePolicies({
    policies,
    paidPrefixes: PAID,
    dispatchedPaths: dispatched,
    matchPolicy: match ?? table.match,
  });
}

const rules = (violations) => violations.map((entry) => entry.rule);

describe("pro-route gate", () => {
  it("passes a consistent table with no paid route", () => {
    const policies = [
      policy({ path: "/api/fixture/generate" }),
      policy({ path: "/health", methods: ["GET"] }),
      policy({ path: "/api/fixture/admin", methods: ["*"] }),
    ];
    expect(evaluate({ policies, dispatched: policies.map((entry) => entry.path) })).toEqual([]);
  });

  it("fails when the router dispatches a route the table never classified", () => {
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

  it("fails on a policy that declares no method", () => {
    const violations = evaluate({
      policies: [policy({ methods: [] })],
      dispatched: ["/api/paid-fixture/generate"],
    });
    expect(rules(violations)).toContain("empty-methods");
  });

  it("fails when a route appears under a paid prefix without an enforcement point", () => {
    const violations = evaluate({
      policies: [policy({ path: "/api/paid-fixture/generate" })],
      dispatched: ["/api/paid-fixture/generate"],
    });
    expect(rules(violations)).toContain("paid-route-without-enforcement");
    expect(violations[0].detail).toMatch(/re-add an enforcement point/);
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
const dispatchHttpRequest = (req, res) => {
  if (req.url === "/a") { return; }
  if (req.url === "/b" || req.url?.startsWith("/b?")) { return; }
  if (req.url?.startsWith("/c/")) { return; }
};
const settle = createRouteDispatcher({ dispatch: dispatchHttpRequest });
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
const settleHttpRequest = ${ROUTE_DISPATCHER}({
  dispatch: ${DISPATCH_FN},
});
`;

  it("passes the single dispatcher call site", () => {
    expect(checkDispatcherWiring(good)).toEqual([]);
  });

  it("fails when the dispatch gains another caller", () => {
    const mutated = good.replace(
      `const settleHttpRequest = ${ROUTE_DISPATCHER}({`,
      `if (DEV) { ${DISPATCH_FN}(req, res); }\nconst settleHttpRequest = ${ROUTE_DISPATCHER}({`,
    );
    expect(rules(checkDispatcherWiring(mutated))).toContain("dispatch-fanout");
  });

  it("fails when the dispatcher is not wired to the dispatch", () => {
    expect(
      rules(checkDispatcherWiring(good.replace(`dispatch: ${DISPATCH_FN},`, "dispatch: other,"))),
    ).toContain("dispatch-unwired");
  });

  it("fails when the router stops building a dispatcher from the table", () => {
    expect(rules(checkDispatcherWiring("const x = 1;"))).toEqual(
      expect.arrayContaining(["dispatch-fanout", "dispatch-unwired", "dispatch-missing"]),
    );
  });
});
