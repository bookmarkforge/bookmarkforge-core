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

describe("route policy table", () => {
  it("is internally consistent", () => {
    expect(validateRoutePolicies()).toEqual([]);
    expect(PAID_PATH_PREFIXES.length).toBeGreaterThan(0);
  });

  it("gates every generative AI route through the guard", () => {
    const expected: Record<string, string> = {
      "/api/services/ai/session": "proof",
      "/api/services/ai/generate": "session-or-bearer",
      "/api/services/ai/generate-tts": "session-or-bearer",
      "/api/services/ai/generate-image": "session-or-bearer",
    };
    for (const [path, mode] of Object.entries(expected)) {
      const policy = matchRoutePolicy(path);
      expect(policy?.path, path).toBe(path);
      expect(policy?.access, path).toBe("entitlement");
      expect(policy?.guard?.mode, path).toBe(mode);
      expect(planRouteGuard(policy!, "POST")).toMatchObject({ guarded: true, mode });
    }
  });

  it("records an audited exception for the operator-only AI surfaces", () => {
    for (const path of ["/api/services/ai/admin", "/api/services/ai/metrics"]) {
      const policy = matchRoutePolicy(path);
      expect(policy?.access, path).toBe("public");
      expect(policy?.paidException, path).toBeTruthy();
      expect(planRouteGuard(policy!, "GET").guarded, path).toBe(false);
    }
  });

  it("leaves a method the route does not answer to the handler", () => {
    const policy = matchRoutePolicy("/api/services/ai/generate")!;
    expect(policyAllowsMethod(policy, "POST")).toBe(true);
    expect(policyAllowsMethod(policy, "GET")).toBe(false);
    // A wrong method keeps answering 405 from the handler instead of becoming
    // an entitlement denial for a body the request does not carry.
    expect(planRouteGuard(policy, "GET").guarded).toBe(false);
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
      assertRoutePolicies([
        { path: "/api/services/ai/x", methods: ["POST"], access: "public", auth: "none", note: "" },
      ]),
    ).toThrow(/paid namespace/);
    expect(() =>
      assertRoutePolicies([
        { path: "/api/services/ai/x", methods: ["POST"], access: "entitlement", auth: "none", note: "" },
      ]),
    ).toThrow(/requires a guard mode/);
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
          await next({ via: "session", identity: "identity", entitlement: null });
        },
      enforced: true,
      publicKeySpki: "spki",
    };
    return guard as unknown as EntitlementGuard;
  }

  const res = {} as unknown as ServerResponse;

  it("guards a paid route with the mode its policy declares, then dispatches", async () => {
    const calls: Array<{ mode: string; path: string | undefined }> = [];
    const dispatched: string[] = [];
    const dispatcher = createGuardedDispatcher({
      guard: stubGuard(calls),
      dispatch: (req) => {
        dispatched.push(req.url ?? "");
      },
    });

    await dispatcher(fakeRequest("/api/services/ai/generate", "POST"), res);
    expect(calls).toEqual([{ mode: "session-or-bearer", path: "/api/services/ai/generate" }]);
    expect(dispatched).toEqual(["/api/services/ai/generate"]);
  });

  it("does not guard public routes, unknown paths or unhandled methods", async () => {
    const calls: Array<{ mode: string; path: string | undefined }> = [];
    const dispatch = () => {};
    const dispatcher = createGuardedDispatcher({ guard: stubGuard(calls), dispatch });

    await dispatcher(fakeRequest("/health", "GET"), res);
    await dispatcher(fakeRequest("/nope", "GET"), res);
    await dispatcher(fakeRequest("/api/services/ai/generate", "GET"), res);
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

  it("finds the router's routes (anti-vacuity)", () => {
    expect(dispatchedPaths.length).toBeGreaterThan(10);
    expect(dispatchedPaths).toContain("/api/services/ai/session");
    expect(dispatchedPaths).toContain("/api/services/ai/generate");
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
