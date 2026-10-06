// src/services/LicenseService.ts
//
// BookmarkForge Pro license client. The app talks to the license SIGNING
// SERVICE (same-origin /api/license by default, overridable with
// VITE_LICENSE_SIGNING_URL) which validates the activation and signs the
// resulting license state with its server-held private key. The app only
// VERIFIES that signature with its committed public key — it never holds a
// signing key, so a modified bundle cannot forge Pro.
//
// The server-side signing service delegates entitlement checks to the
// configured Whop adapter; the browser never calls Whop or receives its API
// credential. The wire contract is signed `{ payload, signature }`.
//
// Privacy-first: the license key is NEVER written to the audit log or to any
// log line (targets are sanitized to "license"). New persistence uses the
// encrypted SecureStorage layer; only legacy installations may briefly expose
// the key in localStorage during one-time migration.
//
// Offline-first design (SupportKnowledge): after a successful handshake the
// app trusts the locally cached validated state for LICENSE_CONFIG.cacheTtlMs
// and only re-validates in the background; a network failure during
// re-validation keeps the cached state (grace), an explicit invalid/expired
// answer downgrades to Free.

import { LICENSE_CONFIG, FREE_LIMITS } from "../constants/license";
import { env } from "../env.config";
import { firewalledFetch } from "../utils/networkFirewall";
import { logger } from "../utils/logger";
import { auditLog } from "./AuditLogService";
import { secureStorage } from "./SecureStorage";
import { safeGet, safeSet, safeRemove } from "../store/safeStorage";
import { cancelResponseBody, readBoundedResponseJson } from "./ai/utils";
import {
  verifyLicensePayload,
  type LicensePayload,
} from "./licenseSigning";

// ── Types ────────────────────────────────────────────────────────────

type LicensePlan = "free" | "pro";
type LicenseSource = "none" | "license" | "trial";

export interface Entitlements {
  plan: LicensePlan;
  source: LicenseSource;
  /** Epoch ms when the entitlement ends (undefined = lifetime license). */
  expiresAt?: number;
  /** True while the locally cached license is still trusted (offline grace). */
  grace?: boolean;
  /** Remaining activations reported by the license server (display only). */
  activationsLeft?: number;
  /**
   * Days left in the server-signed trial (display only). Only present while
   * `source === "trial"`; computed from the signed trial expiry, never from a
   * client-controlled timestamp.
   */
  trialDaysRemaining?: number;
  /** Epoch ms when the provider trial began (only for server-signed trials). */
  trialStartedAt?: number;
  /** Epoch ms when the provider trial ends; bounds the entitlement. */
  trialExpiresAt?: number;
}

interface LicenseState {
  /** Device id bound into the server-signed payload. */
  deviceId?: string;
  /** License key held in memory only; persisted separately in SecureStorage. */
  key?: string;
  /** License server instance id returned by activate() — used by validate/deactivate. */
  instanceId?: string;
  /** Epoch ms of the last successful validation. */
  validatedAt: number;
  /** Epoch ms when the entitlement ends (undefined = lifetime license). */
  expiresAt?: number;
  /** Remaining activations reported by the license server (display only). */
  activationsLeft?: number;
  /** Epoch ms when the provider trial began (only for server-signed trials). */
  trialStartedAt?: number;
  /** Epoch ms when the provider trial ends; bounds the entitlement. */
  trialExpiresAt?: number;
}

/** Persisted wrapper: the signed payload plus its signature. */
interface StoredLicenseState {
  payload: LicensePayload;
  signature: string;
}

/** Response of the license signing service (same-origin /api/license). */
interface SigningServiceResponse {
  payload?: LicensePayload;
  signature?: string;
  ok?: boolean;
  error?: { code: string; message: string };
}

/** Server-authoritative answer of /api/license/entitlement. */
interface EntitlementServiceResponse {
  plan?: "pro" | "free";
  source?: string;
  /** Why the plan is free (EXPIRED, INVALID_SIGNATURE, VALIDATION_WINDOW…). */
  reason?: string;
  message?: string;
  expiresAt?: number;
  activationsLeft?: number;
  /** Whether the verified proof is a provider trial window. */
  isInTrial?: boolean;
  /** Days left in the trial as computed by the server; null when not trialing. */
  trialDaysRemaining?: number | null;
  error?: { code: string; message: string; reason?: string };
}

export class LicenseError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_KEY"
      | "MAX_ACTIVATIONS"
      | "FREE_LIMIT_REACHED"
      | "NETWORK"
      | "SERVER"
      | "CANCELLED",
  ) {
    super(message);
    this.name = "LicenseError";
  }
}

/**
 * True when an error is the free-tier wall (the RxDB preInsert hook's
 * FREE_LIMIT_REACHED LicenseError). UI surfaces use this to replace generic
 * failure copy with the honest "Free holds 1,000 — new saves pause" message.
 */
export function isFreeLimitError(error: unknown): boolean {
  return (
    error instanceof LicenseError && error.code === "FREE_LIMIT_REACHED"
  );
}

// ── Service ──────────────────────────────────────────────────────────

const SECURE_LICENSE_KEY = "bf_license_key_secure";
const MAX_LICENSE_RESPONSE_CHARS = 256 * 1024;

/** Base URL of the signing service: same-origin by default, overridable. */
function signingBase(): string {
  const override = env.licenseSigningUrl?.trim();
  return override && override.length > 0
    ? override
    : LICENSE_CONFIG.signingServiceBaseUrl;
}

class LicenseService {
  private state: LicenseState | null = null;
  private stateLoaded = false;
  private activationPromise: Promise<LicenseState> | null = null;
  private validationInFlight: Promise<boolean> | null = null;
  /** null = not verified yet; true/false after the async check resolves. */
  private signatureValid: boolean | null = null;
  private signatureVerificationInFlight: Promise<void> | null = null;

  private loadState(): LicenseState | null {
    if (this.stateLoaded) {return this.state;}
    this.stateLoaded = true;
    const raw = safeGet(LICENSE_CONFIG.storageKeys.licenseState);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as
          | StoredLicenseState
          | (LicenseState & { key?: string });
        const stored = parsed as StoredLicenseState;
        if (
          stored?.payload &&
          typeof stored.payload.validatedAt === "number" &&
          Number.isFinite(stored.payload.validatedAt) &&
          typeof stored.signature === "string" &&
          stored.signature.length > 0
        ) {
          // Signed format. Cryptographic verification is asynchronous, so the
          // entitlement path remains Free until this promise resolves true.
          this.state = {
            deviceId: stored.payload.deviceId,
            instanceId: stored.payload.instanceId,
            validatedAt: stored.payload.validatedAt,
            expiresAt: stored.payload.expiresAt,
            activationsLeft: stored.payload.activationsLeft,
            trialStartedAt: stored.payload.trialStartedAt,
            trialExpiresAt: stored.payload.trialExpiresAt,
          };
          this.signatureValid = null;
          const verification = this.verifyCachedSignature(
            stored.payload,
            stored.signature,
          );
          this.signatureVerificationInFlight = verification.finally(() => {
            this.signatureVerificationInFlight = null;
          });
        } else if (
          parsed &&
          typeof (parsed as LicenseState).validatedAt === "number" &&
          Number.isFinite((parsed as LicenseState).validatedAt)
        ) {
          // Legacy or unsigned state is never an entitlement. Clear it rather
          // than granting Pro from editable localStorage; the user must
          // activate again through the signing service.
          this.rejectUntrustedCachedState();
        }
      } catch (error) {
        logger.warn("[License] Corrupted cached license state", { error });
        safeRemove(LICENSE_CONFIG.storageKeys.licenseState);
      }
    }
    return this.state;
  }

  private rejectUntrustedCachedState(): void {
    this.clearState();
    this.signatureValid = false;
    auditLog
      .record({
        action: "license_state_tampered",
        target: "license",
        result: "failure",
        origin: "LicenseService",
      })
      .catch((err) => logger.warn("[License] audit failed", err));
  }

  private isPayloadBoundToDevice(payload: LicensePayload): boolean {
    return payload.deviceId === this.getDeviceId();
  }

  /**
   * Async tamper check: a state persisted with a signature whose payload was
   * edited (validatedAt/expiresAt/…) or moved to another install fails
   * verification, downgrades to Free and records an audit entry.
   */
  private async verifyCachedSignature(
    payload: LicensePayload,
    signature: string | undefined,
  ): Promise<void> {
    if (!signature) {
      this.rejectUntrustedCachedState();
      return;
    }
    try {
      const valid = await verifyLicensePayload(payload, signature);
      this.signatureValid = valid;
      if (!valid || !this.isPayloadBoundToDevice(payload)) {
        logger.warn("[License] Cached license state failed signature or device binding verification");
        this.rejectUntrustedCachedState();
      }
    } catch (error) {
      // Crypto unavailable (vault locked on cold start): keep the cached
      // trust until a later validation re-checks — offline-first.
      logger.warn("[License] Signature verification deferred", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.signatureValid = null;
    }
  }

  /**
   * Verify a service-signed payload with the committed public key, then
   * persist it. Throws LicenseError(SERVER) and clears state on a signature
   * mismatch — a bad signature means the service's key does not match the
   * committed public key (misconfiguration or tampering), so the state must
   * never be trusted.
   */
  private async persistVerified(
    payload: LicensePayload,
    signature: string,
  ): Promise<void> {
    const valid = await verifyLicensePayload(payload, signature);
    if (!valid || !this.isPayloadBoundToDevice(payload)) {
      logger.warn("[License] Rejected license state with an invalid signature or device binding");
      this.clearState();
      auditLog
        .record({
          action: "license_signature_invalid",
          target: "license",
          result: "failure",
          origin: "LicenseService",
        })
        .catch((err) => logger.warn("[License] audit failed", err));
      throw new LicenseError(
        "Signed license state failed verification",
        "SERVER",
      );
    }
    this.state = {
      deviceId: payload.deviceId,
      key: this.state?.key,
      instanceId: payload.instanceId,
      validatedAt: payload.validatedAt,
      expiresAt: payload.expiresAt,
      activationsLeft: payload.activationsLeft,
      trialStartedAt: payload.trialStartedAt,
      trialExpiresAt: payload.trialExpiresAt,
    };
    this.stateLoaded = true;
    const stored: StoredLicenseState = { payload, signature };
    safeSet(
      LICENSE_CONFIG.storageKeys.licenseState,
      JSON.stringify(stored),
    );
    this.signatureValid = true;
  }

  private async migrateLegacyKey(key: string): Promise<void> {
    try {
      await secureStorage.setSecret(SECURE_LICENSE_KEY, key);
      safeRemove(LICENSE_CONFIG.storageKeys.licenseKey);
    } catch (error) {
      // Keep the in-memory key for the current session. Do not copy it to a
      // new plaintext location if protected storage is temporarily blocked.
      logger.warn("[License] Protected license-key migration deferred", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private clearState(): void {
    this.state = null;
    this.stateLoaded = true;
    safeRemove(LICENSE_CONFIG.storageKeys.licenseState);
    safeRemove(LICENSE_CONFIG.storageKeys.licenseKey);
    void secureStorage.deleteSecret(SECURE_LICENSE_KEY).catch((error: unknown) =>
      logger.warn("[License] Failed to clear protected license key", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  /** Wait until a cached signed state has been cryptographically verified. */
  async verifyCachedState(): Promise<void> {
    this.loadState();
    if (this.signatureVerificationInFlight) {
      await this.signatureVerificationInFlight;
    }
  }

  /** Return the already-signed entitlement proof without exposing the license key. */
  async getAiSessionProof(): Promise<StoredLicenseState | null> {
    await this.verifyCachedState();
    if (!this.hasProAccess()) return null;
    const raw = safeGet(LICENSE_CONFIG.storageKeys.licenseState);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredLicenseState;
      return parsed?.payload && typeof parsed.signature === "string"
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Ask the DEPLOYMENT (not the browser) to resolve the entitlement.
   *
   * Pro has been a local conclusion so far: the client verified the signed
   * payload it cached and decided on its own. This hands the same proof to
   * the server, which verifies it with the committed public key and answers
   * with the plan. It needs no license key (SecureStorage may still be locked)
   * and no signing key, so every deployment can enforce it.
   *
   * Semantics — deliberately asymmetric:
   *   - explicit `plan: "free"` (expired, revoked, unverifiable) → the local
   *     state is cleared: this is what makes revocation bite;
   *   - `plan: "pro"` → the signed payload remains the evidence, so nothing
   *     local changes (a positive answer cannot promote an unverified cache);
   *   - unreachable server or a 503 (the deployment's own key is unusable) →
   *     the verified offline state is kept. A misconfigured server must never
   *     revoke a paying user, and a network blip must not either.
   *
   * Throws LicenseError on transport/misconfiguration; callers keep grace.
   */
  async refreshEntitlementFromServer(): Promise<Entitlements> {
    const proof = await this.getAiSessionProof();
    if (!proof) {return this.getEntitlements();}

    let response: Response;
    try {
      response = await firewalledFetch(
        `${signingBase()}/entitlement`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(proof),
        },
        "LicenseService",
      );
    } catch (error) {
      throw new LicenseError(
        error instanceof Error ? error.message : "Network error",
        "NETWORK",
      );
    }

    let parsed: EntitlementServiceResponse | null = null;
    try {
      parsed = await readBoundedResponseJson<EntitlementServiceResponse>(
        response,
        MAX_LICENSE_RESPONSE_CHARS,
      );
    } catch (_error) {
      await cancelResponseBody(response);
      throw new LicenseError(
        `Entitlement service responded ${response.status}`,
        response.status === 503 ? "SERVER" : "NETWORK",
      );
    }
    if (!response.ok) {
      throw new LicenseError(
        parsed?.error?.message ??
          `Entitlement service responded ${response.status}`,
        response.status === 503 ? "SERVER" : "NETWORK",
      );
    }
    if (parsed?.plan === "pro") {
      const local = this.getEntitlements();
      // The server computes the trial verdict on its own clock from the same
      // verified proof, so its answer wins for display purposes (the signed
      // payload remains the evidence either way).
      if (typeof parsed.isInTrial === "boolean") {
        return {
          ...local,
          source: parsed.isInTrial ? "trial" : "license",
          ...(typeof parsed.trialDaysRemaining === "number"
            ? { trialDaysRemaining: parsed.trialDaysRemaining }
            : {}),
        };
      }
      return local;
    }
    if (parsed?.plan === "free") {
      this.clearState();
      auditLog
        .record({
          action: "license_validated",
          target: "license",
          result: "failure",
          origin: "LicenseService",
          context: { status: parsed.reason ?? "server_reported_free" },
        })
        .catch((err) => logger.warn("[License] audit failed", err));
      return this.getEntitlements();
    }
    throw new LicenseError("Malformed entitlement response", "SERVER");
  }

  /** Per-install UUID consumed as the license server `instance_name`. Stable across reloads. */
  getDeviceId(): string {
    const key = LICENSE_CONFIG.storageKeys.deviceId;
    let id = safeGet(key);
    if (!id) {
      id = crypto.randomUUID();
      safeSet(key, id);
    }
    return id;
  }

  getStoredLicenseKey(): string | null {
    // Synchronous callers can only see the in-memory key. The persisted key
    // is intentionally asynchronous and protected by SecureStorage.
    return this.loadState()?.key ?? null;
  }

  async getStoredLicenseKeyAsync(): Promise<string | null> {
    const state = this.loadState();
    if (state?.key) {return state.key;}
    try {
      const protectedKey = await secureStorage.getSecret(SECURE_LICENSE_KEY);
      if (protectedKey && this.state) {
        this.state.key = protectedKey;
        return protectedKey;
      }
    } catch (error) {
      logger.warn("[License] Protected license-key read unavailable", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }

  hasLicense(): boolean {
    return this.loadState() !== null && this.signatureValid === true;
  }

  /** True while the locally cached license is still trusted (offline grace). */
  private isCacheFresh(): boolean {
    const state = this.loadState();
    if (!state) {return false;}
    return Date.now() - state.validatedAt < LICENSE_CONFIG.cacheTtlMs;
  }

  /**
   * Trials are minted by the license signing service as a signed payload
   * window (`trialExpiresAt`); a client-local timestamp is user-editable and
   * establishes nothing. This API therefore never starts a trial on its own —
   * keep it for UI compatibility, but it only reports what the signed state
   * already grants (fail closed).
   */
  startTrial(): Entitlements {
    safeRemove(LICENSE_CONFIG.storageKeys.trialStartedAt);
    return this.getEntitlements();
  }

  isTrialActive(): boolean {
    return this.getEntitlements().source === "trial";
  }

  /**
   * The earliest entitlement bound the signed state carries: a provider trial
   * window can only shorten a license, never extend it.
   */
  private effectiveExpiresAt(state: LicenseState): number | undefined {
    const bounds = [state.expiresAt, state.trialExpiresAt].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    return bounds.length > 0 ? Math.min(...bounds) : undefined;
  }

  /**
   * Days left in the signed trial window, or null when the state is not a
   * live trial. `trialExpiresAt` is server-signed, so the remaining days are
   * display data derived from verified bytes at most one clock skew off.
   */
  private trialDaysRemaining(state: LicenseState, nowMs: number): number | null {
    if (state.trialExpiresAt === undefined || state.trialExpiresAt <= nowMs) return null;
    return Math.max(
      0,
      Math.ceil((state.trialExpiresAt - nowMs) / (24 * 60 * 60 * 1000)),
    );
  }

  /** Aggregate entitlement: a valid license OR an active trial. */
  getEntitlements(): Entitlements {
    const state = this.loadState();
    // A state whose signature failed verification was already cleared
    // asynchronously; this re-check makes the downgrade effective for
    // callers that resolved during the verification window.
    // WebCrypto verification is asynchronous. Never grant from a pending,
    // unavailable, legacy, or failed signature state.
    if (state && this.signatureValid !== true) {
      return { plan: "free", source: "none" };
    }
    if (state) {
      const nowMs = Date.now();
      const fresh = this.isCacheFresh();
      const expiresAt = this.effectiveExpiresAt(state);
      // Cached but stale: still Pro until the background re-validation
      // resolves to an explicit invalid — bounded by the earliest signed
      // expiry (license and/or trial window).
      // NOTE: reaching this branch requires signatureValid === true (the
      // branch above returns Free for null/false), so a pending or failed
      // verification NEVER grants — only a positively verified signature
      // keeps the offline grace. Do not "relax" this to trust null.
      const offlineExpired = expiresAt !== undefined && nowMs > expiresAt;
      if (!offlineExpired) {
        const trialDays = this.trialDaysRemaining(state, nowMs);
        return {
          plan: "pro",
          source: trialDays !== null ? "trial" : "license",
          grace: !fresh,
          ...(expiresAt !== undefined ? { expiresAt } : {}),
          activationsLeft: state.activationsLeft,
          ...(trialDays !== null ? { trialDaysRemaining: trialDays } : {}),
        };
      }
      // Signed offline expiry reached → no more grace without re-validation.
      this.clearState();
      return { plan: "free", source: "none" };
    }
    return { plan: "free", source: "none" };
  }

  /** Synchronous cheap check used by UI and enforcement points. */
  hasProAccess(): boolean {
    const e = this.getEntitlements();
    return e.plan === "pro";
  }

  /**
   * Transport to the signing service. Throws NETWORK on connection failure
   * and SERVER on malformed/transport errors; a structured `error` from the
   * service (INVALID_KEY / MAX_ACTIVATIONS / INVALID / SERVER) is returned
   * in the response for the caller to interpret.
   */
  private async signingRequest(
    action: "activate" | "validate" | "deactivate",
    params: Record<string, string>,
  ): Promise<SigningServiceResponse> {
    let response: Response;
    try {
      response = await firewalledFetch(`${signingBase()}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      }, "LicenseService");
    } catch (error) {
      throw new LicenseError(
        error instanceof Error ? error.message : "Network error",
        "NETWORK",
      );
    }
    let parsed: SigningServiceResponse | null = null;
    try {
      parsed = await readBoundedResponseJson<SigningServiceResponse>(
        response,
        MAX_LICENSE_RESPONSE_CHARS,
      );
    } catch (_error) {
      await cancelResponseBody(response);
      if (!response.ok) {
        throw new LicenseError(`License signing service responded ${response.status}`, "SERVER");
      }
      throw new LicenseError("Malformed license service response", "SERVER");
    }
    if (!response.ok && !parsed?.error?.code) {
      throw new LicenseError(`License signing service responded ${response.status}`, "SERVER");
    }
    return parsed;
  }

  private mapSigningError(code: string, message: string): LicenseError {
    const msg = message || "License server error";
    if (code === "INVALID_KEY") {return new LicenseError(msg, "INVALID_KEY");}
    if (code === "MAX_ACTIVATIONS") {return new LicenseError(msg, "MAX_ACTIVATIONS");}
    return new LicenseError(msg, "SERVER");
  }

  /** Activate a license key on this device. Throws LicenseError on failure. */
  async activate(licenseKey: string): Promise<Entitlements> {
    const key = licenseKey.trim();
    if (!key) {throw new LicenseError("License key is empty", "INVALID_KEY");}

    if (this.activationPromise) {
      await this.activationPromise.catch(() => {
        /* INTENTIONAL SILENCE: the first activation attempt owns the result; the caller retries explicitly if it failed. */
      });
    }

    this.activationPromise = (async () => {
      const res = await this.signingRequest("activate", {
        license_key: key,
        instance_name: this.getDeviceId(),
      });
      if (res.error) {
        throw this.mapSigningError(res.error.code, res.error.message);
      }
      if (!res.payload || !res.signature) {
        throw new LicenseError("Malformed license service response", "SERVER");
      }
      await this.persistVerified(res.payload, res.signature);
      // The license key is kept in memory + SecureStorage only (never in the
      // signed payload, never in the audit log).
      if (this.state) {this.state.key = key;}
      await this.migrateLegacyKey(key);
      auditLog
        .record({
          action: "license_activated",
          target: "license",
          result: "success",
          origin: "LicenseService",
        })
        .catch((err) => logger.warn("[License] audit failed", err));
      // persistVerified() just populated this.state, so it is non-null here.
      return this.state as LicenseState;
    })();

    try {
      await this.activationPromise;
      return this.getEntitlements();
    } catch (error) {
      if (error instanceof LicenseError) {throw error;}
      throw new LicenseError("Activation failed", "SERVER");
    } finally {
      this.activationPromise = null;
    }
  }

  /**
   * Re-validate the cached license in the background. Returns false only on
   * an EXPLICIT invalid answer (expired/revoked/disabled) — network errors
   * keep the cached state (offline grace). Idempotent per call round.
   */
  async validateInBackground(): Promise<boolean> {
    const state = this.loadState();
    if (!state) {return false;}
    if (this.isCacheFresh()) {return true;}
    if (this.validationInFlight) {return this.validationInFlight;}

    this.validationInFlight = (async () => {
      const key = await this.getStoredLicenseKeyAsync();
      if (!key) {
        // The vault may still be locked on a cold start. Preserve offline
        // grace rather than sending an empty credential or downgrading.
        return true;
      }
      let res: SigningServiceResponse;
      try {
        res = await this.signingRequest("validate", {
          license_key: key,
          instance_name: this.getDeviceId(),
          ...(state.instanceId ? { instance_id: state.instanceId } : {}),
        });
      } catch (error) {
        if (error instanceof LicenseError && error.code === "NETWORK") {
          logger.warn("[License] Re-validation failed (offline grace)", { error });
          return true; // keep cached state
        }
        throw error;
      }

      if (res.error) {
        if (res.error.code === "INVALID") {
          // Explicit invalid/expired/revoked → downgrade to Free.
          this.clearState();
          auditLog
            .record({
              action: "license_validated",
              target: "license",
              result: "failure",
              origin: "LicenseService",
              context: { status: res.error.message },
            })
            .catch((err) => logger.warn("[License] audit failed", err));
          return false;
        }
        throw this.mapSigningError(res.error.code, res.error.message);
      }
      if (!res.payload || !res.signature) {
        throw new LicenseError("Malformed license service response", "SERVER");
      }
      await this.persistVerified(res.payload, res.signature);
      auditLog
        .record({
          action: "license_validated",
          target: "license",
          result: "success",
          origin: "LicenseService",
        })
        .catch((err) => logger.warn("[License] audit failed", err));
      return true;
    })();

    try {
      return await this.validationInFlight;
    } finally {
      this.validationInFlight = null;
    }
  }

  /** Deactivate this device's license instance. Clears local state regardless. */
  async deactivate(): Promise<void> {
    const state = this.loadState();
    const key = await this.getStoredLicenseKeyAsync();
    if (state?.instanceId && key) {
      try {
        await this.signingRequest("deactivate", {
          license_key: key,
          instance_id: state.instanceId,
        });
      } catch (error) {
        logger.warn("[License] Deactivation call failed (local state cleared anyway)", { error });
      }
    }
    this.clearState();
    auditLog
      .record({
        action: "license_deactivated",
        target: "license",
        result: "success",
        origin: "LicenseService",
      })
      .catch((err) => logger.warn("[License] audit failed", err));
  }

  /** Check whether a new bookmark insert would exceed the free-tier cap. */
  async canAddBookmarks(currentCount: number, incoming = 1): Promise<boolean> {
    if (this.hasProAccess()) {return true;}
    return currentCount + incoming <= FREE_LIMITS.maxBookmarks;
  }
}

export const licenseService = new LicenseService();
