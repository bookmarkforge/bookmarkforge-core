// src/services/LicenseService.ts
//
// BookmarkForge Pro license client. Activation/validation/deactivation go to
// the license signing service (`/api/license/*` same-origin by default, or
// `VITE_LICENSE_SIGNING_URL` for self-hosted deployments). The service calls
// the payment provider server-side and returns a {payload, signature} pair;
// this client VERIFIES the RSA-PSS signature against the committed public
// key (licenseKeys.ts) on every boot and before granting Pro, then caches
// the signed record locally for offline-first access.
//
// the previous direct-to-Whop path is gone. It read
// `VITE_WHOP_PUBLIC_API_KEY` (inlined into the public bundle — a credential
// shipped to every user) and persisted an UNSIGNED {deviceId, validatedAt}
// blob in localStorage that anyone could forge into a permanent Pro
// entitlement. The entitlement is now only as strong as the signature: a
// hand-edited cache fails verification and downgrades to Free.
//
// Privacy-first: the license key is NEVER written to the audit log or to any
// log line (targets are sanitized to "license"). New persistence uses the
// encrypted SecureStorage layer; only legacy installations may briefly expose
// the key in localStorage during one-time migration. The seat token
// (deactivation credential) is stored in SecureStorage, never in the
// signed-state record.
//
// Offline-first design (SupportKnowledge): after a successful handshake the
// app trusts the locally cached SIGNED state for LICENSE_CONFIG.cacheTtlMs
// and only re-validates in the background; a network failure during
// re-validation keeps the cached state (grace), an explicit invalid/expired
// answer downgrades to Free.

import { LICENSE_CONFIG, FREE_LIMITS } from "../constants/license";
import { firewalledFetch } from "../utils/networkFirewall";
import { logger } from "../utils/logger";
import { auditLog } from "./AuditLogService";
import { secureStorage } from "./SecureStorage";
import { safeGet, safeSet, safeRemove } from "../store/safeStorage";
import { readBoundedResponseJson } from "./ai/utils";
import {
  verifyLicensePayload,
  type LicensePayload,
} from "./licenseSigning";

// ── Types ────────────────────────────────────────────────────────────

type LicensePlan = "free" | "pro";
type LicenseSource = "none" | "license";

export interface Entitlements {
  plan: LicensePlan;
  source: LicenseSource;
  /** Epoch ms when the entitlement ends (undefined = lifetime license). */
  expiresAt?: number;
  /** True while the locally cached license is still trusted (offline grace). */
  grace?: boolean;
}

interface LicenseState {
  /** Device id for this installation. */
  deviceId?: string;
  /** License key held in memory only; persisted separately in SecureStorage. */
  key?: string;
  /** Epoch ms of the last successful validation (from the signed payload). */
  validatedAt: number;
  /** Epoch ms when the entitlement ends (undefined = lifetime license). */
  expiresAt?: number;
  /**
   * Monotonic "last seen" floor: max(Date.now(), previous value) persisted
   * with the record. Freshness/expiry are evaluated against
   * max(Date.now(), lastSeenAt) so rolling the clock BACK cannot extend a
   * cached entitlement past the newest time ever observed.
   */
  lastSeenAt: number;
}

/**
 * Persisted license record: the SIGNED payload + signature issued by the
 * license service. Anything that does not verify against the committed
 * public key is discarded on load — there is no unsigned fast path.
 */
interface StoredLicenseRecord {
  v: 1;
  payload: LicensePayload;
  signature: string;
  /**
   * Local-only monotonic clock floor (NOT part of the signed payload —
   * tampering with it can only make the floor LARGER, which fails closed).
   * Missing on records written before the anti-rollback hardening.
   */
  lastSeenAt?: number;
}

/** Response body of the license service for activate/validate. */
interface LicenseServiceResponse {
  payload?: LicensePayload;
  signature?: string;
  seatToken?: string;
  /** Present only when /activate redeemed an AppSumo deal code: the minted BMF- key. */
  license_key?: string;
  error?: { code?: string; message?: string };
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
const SECURE_SEAT_TOKEN = "bf_license_seat_token_secure";
const MAX_LICENSE_RESPONSE_CHARS = 256 * 1024;
/**
 * Hard bound on offline trust: a cached license may grant Pro for at most
 * this long after the last successful validation without re-contacting the
 * license service. Bounds lifetime licenses (expiresAt undefined) and
 * clock-rollback abuse of expiresAt. Sits next to LICENSE_CONFIG.cacheTtlMs
 * (48h fresh window) — this is the outer grace ceiling.
 */
const MAX_OFFLINE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
type LicenseAction = "activate" | "validate" | "deactivate";

class LicenseService {
  private state: LicenseState | null = null;
  private stateLoaded = false;
  private activationPromise: Promise<LicenseState> | null = null;
  private validationInFlight: Promise<boolean> | null = null;
  /**
   * Signature verification of the persisted record. `null` = not attempted;
   * a stored record grants Pro only after this resolves true. Verification
   * is local (RSA-PSS against the committed public key) so it also works
   * fully offline.
   */
  private signatureCheck: Promise<boolean> | null = null;
  private signatureVerified = false;

  /** Base URL of the license service: same-origin `/api/license` by default. */
  private licenseBaseUrl(): string {
    const override = import.meta.env.VITE_LICENSE_SIGNING_URL?.trim();
    if (override) {
      try {
        const parsed = new URL(override);
        // https: anywhere; http: only for loopback (local dev / the
        // companion license mock). A plaintext remote endpoint would let a
        // network attacker serve forged license responses.
        const host = parsed.hostname.toLowerCase();
        const loopback =
          host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
        if (parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback)) {
          return `${parsed.origin}/api/license`;
        }
      } catch {
        /* INTENTIONAL SILENCE: malformed override falls back to same-origin. */
      }
    }
    return "/api/license";
  }

  private async callLicenseService(
    action: LicenseAction,
    body: Record<string, string>,
  ): Promise<LicenseServiceResponse> {
    let response: Response;
    try {
      response = await firewalledFetch(
        `${this.licenseBaseUrl()}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        "LicenseService",
      );
    } catch (error) {
      throw new LicenseError(
        error instanceof Error ? error.message : "network error",
        "NETWORK",
      );
    }

    const data = await readBoundedResponseJson<LicenseServiceResponse>(
      response,
      MAX_LICENSE_RESPONSE_CHARS,
    );
    if (!response.ok) {
      const code = data?.error?.code;
      if (code === "INVALID_KEY" || code === "MAX_ACTIVATIONS") {
        throw new LicenseError(
          data.error?.message ?? "license rejected",
          code,
        );
      }
      throw new LicenseError(
        data?.error?.message ?? `license service responded ${response.status}`,
        response.status === 429 ? "NETWORK" : "SERVER",
      );
    }
    return data;
  }

  private loadState(): LicenseState | null {
    if (this.stateLoaded) {return this.state;}
    this.stateLoaded = true;
    const raw = safeGet(LICENSE_CONFIG.storageKeys.licenseState);
    if (!raw) {return null;}
    try {
      const parsed = JSON.parse(raw) as StoredLicenseRecord;
      const payload = parsed?.payload;
      const signature = parsed?.signature;
      if (
        parsed?.v !== 1 ||
        !payload ||
        typeof signature !== "string" ||
        payload.deviceId !== this.getDeviceId()
      ) {
        // Legacy unsigned state or a record bound to another install —
        // neither can prove entitlement, so drop it.
        this.clearState();
        return null;
      }
      const storedLastSeenAt =
        typeof parsed.lastSeenAt === "number" && Number.isFinite(parsed.lastSeenAt)
          ? parsed.lastSeenAt
          : undefined;
      const validatedAtFloor =
        typeof payload.validatedAt === "number" && Number.isFinite(payload.validatedAt)
          ? payload.validatedAt
          : 0;
      // Backward compat: records predating lastSeenAt initialize the floor
      // from validatedAt (or now, whichever is newer).
      const lastSeenAt = Math.max(Date.now(), storedLastSeenAt ?? 0, validatedAtFloor);
      this.state = {
        deviceId: payload.deviceId,
        validatedAt: payload.validatedAt,
        expiresAt: payload.expiresAt,
        lastSeenAt,
      };
      // Persist the monotonic floor so it survives reloads and cannot be rolled back.
      // This prevents the clock-rollback bypass where Date.now() < validatedAt
      // would pin effectiveNow to validatedAt forever.
      if (lastSeenAt !== storedLastSeenAt) {
        const updatedRecord: StoredLicenseRecord = { v: 1, payload, signature, lastSeenAt };
        safeSet(LICENSE_CONFIG.storageKeys.licenseState, JSON.stringify(updatedRecord));
      }
      // Kick signature verification immediately; entitlements stay Free
      // until it resolves (fail closed — a forged record never grants Pro).
      this.signatureCheck = verifyLicensePayload(payload, signature).then(
        (ok) => {
          this.signatureVerified = ok;
          if (!ok) {
            logger.warn("[License] Cached license signature invalid — downgrading to Free");
            this.clearState();
          }
          return ok;
        },
        (error) => {
          logger.warn("[License] Cached license verification failed", { error });
          this.clearState();
          return false;
        },
      );
    } catch (error) {
      logger.warn("[License] Corrupted cached license state", { error });
      safeRemove(LICENSE_CONFIG.storageKeys.licenseState);
    }
    return this.state;
  }

  private persistState(state: LicenseState, record: StoredLicenseRecord): void {
    this.state = state;
    this.stateLoaded = true;
    this.signatureVerified = true;
    this.signatureCheck = Promise.resolve(true);
    safeSet(
      LICENSE_CONFIG.storageKeys.licenseState,
      JSON.stringify(record),
    );
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

  private async persistSeatToken(seatToken: string | undefined): Promise<void> {
    if (!seatToken) {return;}
    try {
      await secureStorage.setSecret(SECURE_SEAT_TOKEN, seatToken);
    } catch (error) {
      logger.warn("[License] Protected seat-token persistence deferred", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async getSeatToken(): Promise<string | null> {
    try {
      return await secureStorage.getSecret(SECURE_SEAT_TOKEN);
    } catch (error) {
      logger.warn("[License] Protected seat-token read unavailable", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private clearState(): void {
    this.state = null;
    this.stateLoaded = true;
    this.signatureVerified = false;
    this.signatureCheck = Promise.resolve(false);
    safeRemove(LICENSE_CONFIG.storageKeys.licenseState);
    safeRemove(LICENSE_CONFIG.storageKeys.licenseKey);
    void secureStorage.deleteSecret(SECURE_LICENSE_KEY).catch((error: unknown) =>
      logger.warn("[License] Failed to clear protected license key", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    void secureStorage.deleteSecret(SECURE_SEAT_TOKEN).catch((error: unknown) =>
      logger.warn("[License] Failed to clear protected seat token", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  /**
   * Wait until the cached state is loaded AND its signature has been
   * verified against the committed public key. Resolves false when the
   * record is absent or fails verification.
   */
  async verifyCachedState(): Promise<boolean> {
    this.loadState();
    if (!this.state) {return false;}
    if (this.signatureCheck) {
      return this.signatureCheck;
    }
    return this.signatureVerified;
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
    return this.loadState() !== null;
  }

  /** Time basis for freshness/expiry: never earlier than the last seen floor. */
  private effectiveNow(state: LicenseState): number {
    return Math.max(Date.now(), state.lastSeenAt);
  }

  /** True while the locally cached license is still trusted (offline grace). */
  private isCacheFresh(): boolean {
    const state = this.loadState();
    if (!state) {return false;}
    return this.effectiveNow(state) - state.validatedAt < LICENSE_CONFIG.cacheTtlMs;
  }

  /**
   * Aggregate entitlement: a valid license. Requires the persisted record's
   * signature to have verified — an unsigned or forged cache grants nothing.
   */
  getEntitlements(): Entitlements {
    const state = this.loadState();
    if (state && this.signatureVerified) {
      // Detect clock rollback: if Date.now() < lastSeenAt, the system clock
      // has been rolled back. This is a sign of tampering and we should
      // require revalidation rather than trusting the cached state.
      const rawNow = Date.now();
      if (rawNow < state.lastSeenAt) {
        // Clock rollback detected — treat as tampering, require revalidation.
        return { plan: "free", source: "none" };
      }
      const now = this.effectiveNow(state);
      // expiresAt is checked in BOTH the fresh and grace branches, and the
      // monotonic floor means a rolled-back clock cannot push `now` below
      // the newest time ever observed.
      const expired =
        state.expiresAt !== undefined && now > state.expiresAt;
      // Hard offline ceiling: beyond MAX_OFFLINE_GRACE_MS since the last
      // successful validation the cached state stops granting Pro until the
      // service re-validates (the state is kept so revalidation can recover
      // it — only an explicit invalid answer or expiry clears it).
      const offlineTooLong = now - state.validatedAt > MAX_OFFLINE_GRACE_MS;
      if (!expired && !offlineTooLong) {
        return {
          plan: "pro",
          source: "license",
          grace: now - state.validatedAt >= LICENSE_CONFIG.cacheTtlMs,
          ...(state.expiresAt !== undefined
            ? { expiresAt: state.expiresAt }
            : {}),
        };
      }
      if (expired) {
        // Offline expiry reached → no more grace without re-validation.
        this.clearState();
      }
      return { plan: "free", source: "none" };
    }
    if (state && !this.signatureVerified && this.signatureCheck === null) {
      // Unreachable in practice (loadState always starts the check), but
      // fail closed if a future refactor skips it.
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
   * Adopt a signed {payload, signature} pair from the license service:
   * verify it, bind it to this device, and persist it. Shared by activate
   * and validate.
   */
  private async adoptSignedResponse(
    response: LicenseServiceResponse,
    key: string,
  ): Promise<LicenseState> {
    const payload = response.payload;
    const signature = response.signature;
    if (
      !payload ||
      typeof signature !== "string" ||
      payload.v !== 1 ||
      payload.deviceId !== this.getDeviceId()
    ) {
      throw new LicenseError("license service returned an invalid payload", "SERVER");
    }
    const verified = await verifyLicensePayload(payload, signature);
    if (!verified) {
      // The service answered 200 with an unverifiable signature — treat as
      // a server fault, never as an entitlement.
      throw new LicenseError("license signature verification failed", "SERVER");
    }

    const lastSeenAt = Math.max(
      Date.now(),
      Number.isFinite(payload.validatedAt) ? payload.validatedAt : 0,
      this.state?.lastSeenAt ?? 0,
    );
    const newState: LicenseState = {
      deviceId: payload.deviceId,
      key,
      validatedAt: payload.validatedAt,
      expiresAt: payload.expiresAt,
      lastSeenAt,
    };
    const record: StoredLicenseRecord = { v: 1, payload, signature, lastSeenAt };
    this.persistState(newState, record);
    await this.migrateLegacyKey(key);
    await this.persistSeatToken(response.seatToken);
    return newState;
  }

  /**
   * License key minted by the last deal-code activation, exposed once so the
   * UI can tell the user to save it (the AppSumo code cannot be reused).
   */
  private pendingRedeemedKey: string | null = null;

  /** Returns and clears the one-time redeemed license key, if any. */
  consumeRedeemedLicenseKey(): string | null {
    const key = this.pendingRedeemedKey;
    this.pendingRedeemedKey = null;
    return key;
  }

  /** Activate a license key on this device. Throws LicenseError on failure. */
  async activate(licenseKey: string): Promise<Entitlements> {
    const key = licenseKey.trim();
    if (!key) {throw new LicenseError("License key is empty", "INVALID_KEY");}
    // SECURITY: Existing activation in flight - wait for it to complete.
    // The finally block clears activationPromise, so concurrent calls
    // will wait for the previous one before starting a new one.
    if (this.activationPromise) {
      await this.activationPromise.catch(() => {
        /* INTENTIONAL SILENCE: the first activation attempt owns the result; the caller retries explicitly if it failed. */
      });
    }

    this.activationPromise = (async () => {
      const response = await this.callLicenseService("activate", {
        license_key: key,
        instance_name: this.getDeviceId(),
      });
      // When the server redeemed an AppSumo deal code it returns the minted
      // BMF- key: that is the credential to persist, not the deal code.
      const mintedKey =
        typeof response.license_key === "string" && response.license_key.length > 0
          ? response.license_key
          : null;
      await this.adoptSignedResponse(response, mintedKey ?? key);
      this.pendingRedeemedKey = mintedKey;

      auditLog
        .record({
          action: "license_activated",
          target: "license",
          result: "success",
          origin: "LicenseService",
        })
        .catch((err) => logger.warn("[License] audit failed", err));

      return this.state!;
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

      let response: LicenseServiceResponse;
      try {
        const seatToken = await this.getSeatToken();
        response = await this.callLicenseService("validate", {
          license_key: key,
          instance_name: this.getDeviceId(),
          ...(seatToken ? { seat_token: seatToken } : {}),
        });
      } catch (error) {
        if (error instanceof LicenseError && error.code === "NETWORK") {
          logger.warn("[License] Re-validation failed (offline grace)", { error });
          return true; // keep cached state
        }
        if (error instanceof LicenseError && error.code === "INVALID_KEY") {
          // Explicit invalid/expired/revoked → downgrade to Free.
          this.clearState();
          auditLog
            .record({
              action: "license_validated",
              target: "license",
              result: "failure",
              origin: "LicenseService",
              context: { status: "invalid" },
            })
            .catch((err) => logger.warn("[License] audit failed", err));
          return false;
        }
        throw error;
      }

      // The service answered 200 — adopt the freshly signed payload.
      try {
        await this.adoptSignedResponse(response, key);
      } catch (adoptError) {
        logger.warn("[License] Re-validation response rejected", {
          error: adoptError instanceof Error ? adoptError.message : String(adoptError),
        });
        return true; // keep the still-valid cached state
      }

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

  /** Deactivate this device's license. Clears local state. */
  async deactivate(): Promise<void> {
    const key = await this.getStoredLicenseKeyAsync();
    if (key) {
      try {
        const seatToken = await this.getSeatToken();
        await this.callLicenseService("deactivate", {
          license_key: key,
          instance_name: this.getDeviceId(),
          ...(seatToken ? { seat_token: seatToken } : {}),
        });
      } catch (error) {
        // Local deactivation still proceeds: the user asked to leave, and a
        // provider outage must not trap the license on this device.
        logger.warn("[License] Remote deactivation failed; clearing locally", {
          error: error instanceof Error ? error.message : String(error),
        });
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

  /** Check whether a new item insert would exceed the free-tier cap. */
  async canAddBookmarks(currentCount: number, incoming = 1): Promise<boolean> {
    if (this.hasProAccess()) {return true;}
    return currentCount + incoming <= FREE_LIMITS.maxBookmarks;
  }
}

export const licenseService = new LicenseService();
