/**
 * Types for scripts/check-pro-routes.mjs.
 *
 * The gate is plain ESM (it runs under both `tsx` and vitest), but the
 * route-table contract test imports its checker to assert the same rules in the
 * unit suite. Without this declaration that import is implicitly `any` and the
 * test would silently stop type-checking the checker's own contract.
 */
import type { RoutePolicy } from "../server/src/route-table";

export interface RouteViolation {
  rule: string;
  route: string;
  detail: string;
}

/** The HTTP dispatch: it must have exactly one caller. */
export const DISPATCH_FN: string;
/** The only function allowed to call `DISPATCH_FN`. */
export const ROUTE_DISPATCHER: string;

export function extractDispatchedRoutePaths(source: string): string[];

export function evaluateRoutePolicies(options: {
  policies: readonly RoutePolicy[];
  paidPrefixes: readonly string[];
  dispatchedPaths: readonly string[];
  matchPolicy: (path: string) => RoutePolicy | undefined;
}): RouteViolation[];

export function checkDispatcherWiring(source: string): RouteViolation[];

export function formatViolations(violations: readonly RouteViolation[]): string;
