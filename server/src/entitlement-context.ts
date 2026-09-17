/**
 * server/src/entitlement-context.ts — the carrier for one request's resolved
 * entitlement.
 *
 * The entitlement guard answers "what is this request allowed to do?" once, and
 * attaches the answer to the request. Everything downstream reads that same
 * object: the router's dispatcher and the paid handlers themselves.
 *
 * It is a leaf module on purpose. `entitlement-guard.ts` (the policy that fills
 * the context) and `proxy-utils.ts` (the shared utilities) all import this file,
 * and none of them import each other for it, so the
 * server's module graph stays acyclic. The guard re-exports this surface, so
 * callers that already import from there keep working.
 *
 * The context lives under a symbol, non-enumerable and non-writable: no
 * handler can forge or overwrite a verdict, and a client cannot supply one
 * (HTTP headers cannot create symbol properties). `readEntitlementContext()`
 * returning `null` therefore means "nothing resolved this request", never
 * "nothing was proven".
 */
import type { IncomingMessage } from "node:http";
import type { Entitlement } from "./entitlement";

const ENTITLEMENT_CONTEXT = Symbol.for("bookmarkforge.entitlement-context");

/**
 * The resolved answer for one request. `via` is the discriminator: a proof
 * always carries the entitlement it proved.
 */
export type EntitlementContext =
  | {
      via: "proof";
      identity: string;
      entitlement: Entitlement;
      entitlementExpiresAt?: number;
      /** The proof as presented, so a route can echo or re-sign it. */
      proof: unknown;
    }
  | {
      via: "anonymous";
      identity: "anonymous";
      entitlement: null;
      entitlementExpiresAt?: number;
    };

/** The context the guard attached to this request, if any. */
export function readEntitlementContext(req: IncomingMessage): EntitlementContext | null {
  const context = (req as IncomingMessage & { [ENTITLEMENT_CONTEXT]?: EntitlementContext })[
    ENTITLEMENT_CONTEXT
  ];
  return context ?? null;
}

/** Attach the resolved context. Only the guard calls this. */
export function attachEntitlementContext(req: IncomingMessage, context: EntitlementContext): void {
  Object.defineProperty(req, ENTITLEMENT_CONTEXT, {
    value: context,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

export { ENTITLEMENT_CONTEXT };
