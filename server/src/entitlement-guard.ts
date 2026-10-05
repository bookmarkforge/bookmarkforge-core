/**
 * server/src/entitlement-guard.ts — the server's single enforcement point for
 * paid (Pro) capability.
 *
 * `entitlement.ts` answers "is this signed proof valid?". This module answers
 * the policy question that sits on top of it: which routes require what, and
 * what a denial looks like on the wire.
 *
 * Before it, every surface that needed an entitlement re-implemented the same
 * three steps — read the proof, verify it, translate the denial into a status
 * code. A route added afterwards could simply never call them and nothing
 * failed; the entitlement was enforceable in principle but optional in practice.
 *
 * Now a request resolves to an `EntitlementContext` through `"proof"` mode:
 * the request body carries `{ payload, signature }`.
 *
 * The resolved context is attached to the request under a symbol, so the router
 * guard and a handler below it share one verification instead of two. Every
 * denial is a single `GuardDenial` object, so status codes and machine-readable
 * reasons cannot drift between surfaces.
 *
 * Which route uses which mode is declared in `route-table.ts`, and
 * `scripts/check-pro-routes.mjs` fails the build when a paid route declared
 * there is not gated here.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "./proxy-utils";
import {
  attachEntitlementContext,
  readEntitlementContext,
  type EntitlementContext,
} from "./entitlement-context";
import {
  resolveLicensePublicKeySpki,
  verifyLicenseProof,
  type EntitlementDenialReason,
} from "./entitlement";

/** Marks a handler produced by `withEntitlement()`. */
const ENTITLEMENT_GUARDED = Symbol.for("bookmarkforge.entitlement-guarded");

/** The default proof-body cap. */
const DEFAULT_MAX_PROOF_BYTES = 32 * 1024;

export type GuardMode = "proof";

/**
 * Denial codes are the contract clients switch on. `LICENSE_*` are entitlement
 * answers; the rest are request-shape failures.
 */
export type GuardDenialCode =
  | "LICENSE_REQUIRED"
  | "LICENSE_EXPIRED"
  | "INVALID_REQUEST"
  | "SIGNING_KEY_INVALID";

export interface GuardDenial {
  status: number;
  code: GuardDenialCode;
  message: string;
  /** The verification reason, when the denial came from a proof. */
  reason?: EntitlementDenialReason;
}

export type GuardDecision =
  | { ok: true; context: EntitlementContext }
  | { ok: false; denial: GuardDenial };

/** A proof decision always yields the entitlement it verified. */
export type ProofGuardDecision =
  | { ok: true; context: Extract<EntitlementContext, { via: "proof" }> }
  | { ok: false; denial: GuardDenial };

export interface GuardRequestOptions {
  /**
   * What the rejected body was, for the message ("license proof is invalid").
   * Kept per route so the wire messages stay identical to the ones each
   * surface shipped before this module existed.
   */
  proofLabel?: string;
}

export interface EntitlementGuardOptions {
  now?: () => number;
  /**
   * Whether a signed proof is required at all. False is the deployment's
   * explicit opt-out; the guard only honors it in `"proof"` mode.
   */
  requireEntitlement?: boolean;
  /** Overrides the committed license public key (tests, key rotation). */
  publicKeySpki?: string;
  maxProofBytes?: number;
}

export interface EntitlementGuard {
  /**
   * Verify a proof already in memory. Used by routes that own their own body
   * handling (the entitlement endpoint answers 413 for an oversized proof,
   * which is a different contract from a 400).
   */
  verifyProof(proof: unknown): ProofGuardDecision;
  /**
   * Resolve the context for a request, attaching it for later readers.
   * Idempotent per request: a second call returns the attached context.
   */
  attach(
    req: IncomingMessage,
    mode: GuardMode,
    options?: GuardRequestOptions,
  ): Promise<GuardDecision>;
  /**
   * Middleware form: resolve, write the denial when refused, otherwise attach
   * the context and call `next`. Never calls `next` on a denial.
   */
  middleware(
    mode: GuardMode,
    options?: GuardRequestOptions,
  ): (
    req: IncomingMessage,
    res: ServerResponse,
    next: (context: EntitlementContext) => void | Promise<void>,
  ) => Promise<void>;
  /** True when this deployment requires a verified license proof. */
  readonly enforced: boolean;
  /** The key the guard verifies against, resolved once at construction. */
  readonly publicKeySpki: string;
}

export function createEntitlementGuard(
  options: EntitlementGuardOptions = {},
): EntitlementGuard {
  const now = options.now ?? Date.now;
  const requireEntitlement = options.requireEntitlement ?? true;
  const publicKeySpki = options.publicKeySpki ?? resolveLicensePublicKeySpki();
  const maxProofBytes = options.maxProofBytes ?? DEFAULT_MAX_PROOF_BYTES;

  const verifyProof = (proof: unknown): ProofGuardDecision => {
    const verification = verifyLicenseProof(proof, { now: now(), publicKeySpki });
    if (verification.ok) {
      const { entitlement } = verification;
      const context: Extract<EntitlementContext, { via: "proof" }> = {
        via: "proof",
        identity: entitlement.identity,
        entitlement,
        proof,
      };
      if (entitlement.expiresAt !== undefined) {
        context.entitlementExpiresAt = entitlement.expiresAt;
      }
      return { ok: true, context };
    }
    // An unusable signing key is an operator problem, not a customer problem:
    // it answers 503 so a client never downgrades a paying user on our
    // misconfiguration. Everything else is an entitlement denial.
    if (verification.reason === "SIGNING_KEY_INVALID") {
      return {
        ok: false,
        denial: {
          status: 503,
          code: "SIGNING_KEY_INVALID",
          message: verification.message,
          reason: verification.reason,
        },
      };
    }
    return {
      ok: false,
      denial: {
        status: 401,
        code: verification.reason === "EXPIRED" ? "LICENSE_EXPIRED" : "LICENSE_REQUIRED",
        message: verification.message,
        reason: verification.reason,
      },
    };
  };

  const invalidBody = (label: string): GuardDenial => ({
    status: 400,
    code: "INVALID_REQUEST",
    message: `${label} is invalid`,
  });

  const readProofBody = async (
    req: IncomingMessage,
    label: string,
  ): Promise<{ ok: true; proof: unknown } | { ok: false; denial: GuardDenial }> => {
    let raw: string;
    try {
      raw = await readBody(req);
    } catch {
      // A body that outgrew the transport cap is a malformed proof here: the
      // guard has always answered 400 (not 413) for both cases.
      return { ok: false, denial: invalidBody(label) };
    }
    if (raw.length > maxProofBytes) {
      return { ok: false, denial: invalidBody(label) };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, denial: invalidBody(label) };
    }
    // A JSON array, `null` or a scalar is not a proof *object*; it is an empty
    // proof, so it fails as MISSING_PROOF rather than as malformed JSON.
    return {
      ok: true,
      proof:
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {},
    };
  };

  const anonymousContext = (): EntitlementContext => ({
    via: "anonymous",
    identity: "anonymous",
    entitlement: null,
  });

  const attach = async (
    req: IncomingMessage,
    _mode: GuardMode,
    requestOptions: GuardRequestOptions = {},
  ): Promise<GuardDecision> => {
    const existing = readEntitlementContext(req);
    if (existing) return { ok: true, context: existing };

    const label = requestOptions.proofLabel ?? "license proof";
    // The body is parsed whether or not the deployment enforces licenses: the
    // guard answered 400 for garbage before its existence, and an anonymous
    // deployment must not start minting sessions for it.
    const body = await readProofBody(req, label);
    if (!body.ok) return body;
    if (!requireEntitlement) return { ok: true, context: anonymousContext() };
    const decision = verifyProof(body.proof);
    if (decision.ok) attachEntitlementContext(req, decision.context);
    return decision;
  };

  const middleware =
    (mode: GuardMode, requestOptions: GuardRequestOptions = {}) =>
    async (
      req: IncomingMessage,
      res: ServerResponse,
      next: (context: EntitlementContext) => void | Promise<void>,
    ): Promise<void> => {
      const decision = await attach(req, mode, requestOptions);
      if (!decision.ok) {
        writeGuardDenial(res, decision.denial);
        return;
      }
      await next(decision.context);
    };

  return {
    verifyProof,
    attach,
    middleware,
    enforced: requireEntitlement,
    publicKeySpki,
  };
}

/**
 * Resolve the context for a request that may or may not have already passed
 * through the router guard. A route mounted behind the guard reuses the
 * attached context (and never re-reads the body, which is already consumed);
 * a standalone caller falls through to the same enforcement path.
 */
export async function resolveEntitlementContext(
  req: IncomingMessage,
  guard: EntitlementGuard,
  mode: GuardMode,
  options?: GuardRequestOptions,
): Promise<GuardDecision> {
  const existing = readEntitlementContext(req);
  return existing ? { ok: true, context: existing } : guard.attach(req, mode, options);
}

/** Write a denial with the shared JSON error envelope. */
export function writeGuardDenial(res: ServerResponse, denial: GuardDenial): void {
  sendJson(res, denial.status, {
    error: {
      code: denial.code,
      message: denial.message,
      ...(denial.reason !== undefined ? { reason: denial.reason } : {}),
    },
  });
}

export type EntitlementGuardedHandler = ((
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>) & { [ENTITLEMENT_GUARDED]?: { mode: GuardMode } };

/**
 * Wrap a handler that needs the resolved entitlement. The wrapped handler only
 * ever runs with a context (it is never invoked on a denial), which is what
 * makes "forgot to check" impossible for a route that uses it.
 */
export function withEntitlement(
  guard: EntitlementGuard,
  mode: GuardMode,
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
    context: EntitlementContext,
  ) => void | Promise<void>,
  options?: GuardRequestOptions,
): EntitlementGuardedHandler {
  const wrapped: EntitlementGuardedHandler = (req, res) =>
    guard.middleware(mode, options)(req, res, (context) => handler(req, res, context));
  Object.defineProperty(wrapped, ENTITLEMENT_GUARDED, {
    value: { mode },
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return wrapped;
}

/** True when a handler is guaranteed to receive a resolved entitlement. */
export function isEntitlementGuarded(handler: unknown): boolean {
  return (
    typeof handler === "function" &&
    (handler as EntitlementGuardedHandler)[ENTITLEMENT_GUARDED] !== undefined
  );
}

export { ENTITLEMENT_GUARDED };
/**
 * The context carrier is a leaf module (`entitlement-context.ts`) so the paid
 * handlers can read the resolved context without importing this file — which
 * imports them. The read surface is re-exported here because this module is the
 * public surface for everything entitlement-related; the attach function is
 * deliberately NOT re-exported, because a context attached by anything other
 * than this guard would be a verdict nobody verified.
 */
export {
  ENTITLEMENT_CONTEXT,
  readEntitlementContext,
  type EntitlementContext,
} from "./entitlement-context";
