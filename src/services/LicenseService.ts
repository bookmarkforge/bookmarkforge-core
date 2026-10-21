// src/services/LicenseService.ts
//
// BookmarkForge Pro license client. The app validates licenses directly with
// Whop's API using a public/restricted API key. Validation responses are cached
// locally in IndexedDB/RxDB for offline-first access.
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
import { firewalledFetch } from "../utils/networkFirewall";
import { logger } from "../utils/logger";
import { auditLog } from "./AuditLogService";
import { secureStorage } from "./SecureStorage";
import { safeGet, safeSet, safeRemove } from "../store/safeStorage";
import { readBoundedResponseJson } from "./ai/utils";

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
  /** Epoch ms of the last successful validation. */
  validatedAt: number;
  /** Epoch ms when the entitlement ends (undefined = lifetime license). */
  expiresAt?: number;
}

/** Persisted license state (no signature - direct Whop validation). */
interface StoredLicenseState {
  deviceId: string;
  validatedAt: number;
  expiresAt?: number;
}

/** Response from Whop API for license validation. */
interface WhopValidationResponse {
  valid: boolean;
  status?: "active" | "expired" | "canceled" | "revoked";
  expires_at?: string;
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

class LicenseService {
  private state: LicenseState | null = null;
  private stateLoaded = false;
  private activationPromise: Promise<LicenseState> | null = null;
  private validationInFlight: Promise<boolean> | null = null;

  private loadState(): LicenseState | null {
    if (this.stateLoaded) {return this.state;}
    this.stateLoaded = true;
    const raw = safeGet(LICENSE_CONFIG.storageKeys.licenseState);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as StoredLicenseState;
        if (
          parsed &&
          typeof parsed.validatedAt === "number" &&
          Number.isFinite(parsed.validatedAt) &&
          parsed.deviceId === this.getDeviceId()
        ) {
          this.state = {
            deviceId: parsed.deviceId,
            validatedAt: parsed.validatedAt,
            expiresAt: parsed.expiresAt,
          };
        } else {
          // Invalid or tampered state - clear it
          this.clearState();
        }
      } catch (error) {
        logger.warn("[License] Corrupted cached license state", { error });
        safeRemove(LICENSE_CONFIG.storageKeys.licenseState);
      }
    }
    return this.state;
  }

  private persistState(state: LicenseState): void {
    this.state = state;
    this.stateLoaded = true;
    const stored: StoredLicenseState = {
      deviceId: state.deviceId!,
      validatedAt: state.validatedAt,
      expiresAt: state.expiresAt,
    };
    safeSet(
      LICENSE_CONFIG.storageKeys.licenseState,
      JSON.stringify(stored),
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

  /** Wait until a cached state is loaded. */
  async verifyCachedState(): Promise<void> {
    this.loadState();
  }

  /**
   * Validate license key directly with Whop API.
   * Uses public/restricted API key from VITE_WHOP_PUBLIC_API_KEY.
   */
  private async validateWithWhop(licenseKey: string): Promise<WhopValidationResponse> {
    const apiKey = import.meta.env.VITE_WHOP_PUBLIC_API_KEY;
    if (!apiKey) {
      throw new LicenseError("Whop public API key not configured", "SERVER");
    }

    const response = await firewalledFetch(
      `https://api.whop.com/api/v1/licenses/${encodeURIComponent(licenseKey)}/validate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({}),
      },
      "LicenseService",
    );

    if (!response.ok) {
      if (response.status === 404 || response.status === 400) {
        return { valid: false, status: "revoked" };
      }
      throw new LicenseError(`Whop API responded ${response.status}`, "NETWORK");
    }

    const data = await readBoundedResponseJson<WhopValidationResponse>(
      response,
      MAX_LICENSE_RESPONSE_CHARS,
    );
    return data;
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

  /** True while the locally cached license is still trusted (offline grace). */
  private isCacheFresh(): boolean {
    const state = this.loadState();
    if (!state) {return false;}
    return Date.now() - state.validatedAt < LICENSE_CONFIG.cacheTtlMs;
  }

  /** Aggregate entitlement: a valid license. */
  getEntitlements(): Entitlements {
    const state = this.loadState();
    if (state && this.isCacheFresh()) {
      return {
        plan: "pro",
        source: "license",
        grace: false,
        ...(state.expiresAt !== undefined
          ? { expiresAt: state.expiresAt }
          : {}),
      };
    }
    if (state) {
      // Cached but stale: still Pro until the background re-validation
      // resolves to an explicit invalid — bounded by the expiry.
      const offlineExpired =
        state.expiresAt !== undefined && Date.now() > state.expiresAt;
      if (!offlineExpired) {
        return {
          plan: "pro",
          source: "license",
          grace: true,
          ...(state.expiresAt !== undefined
            ? { expiresAt: state.expiresAt }
            : {}),
        };
      }
      // Offline expiry reached → no more grace without re-validation.
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
      const validation = await this.validateWithWhop(key);
      if (!validation.valid) {
        throw new LicenseError(
          validation.status === "expired" ? "License key has expired" : "Invalid license key",
          "INVALID_KEY",
        );
      }

      // Parse expiry date from Whop response
      let expiresAt: number | undefined;
      if (validation.expires_at) {
        const parsed = new Date(validation.expires_at).getTime();
        if (Number.isFinite(parsed)) {
          expiresAt = parsed;
        }
      }

      const newState: LicenseState = {
        deviceId: this.getDeviceId(),
        key,
        validatedAt: Date.now(),
        expiresAt,
      };

      this.persistState(newState);
      await this.migrateLegacyKey(key);

      auditLog
        .record({
          action: "license_activated",
          target: "license",
          result: "success",
          origin: "LicenseService",
        })
        .catch((err) => logger.warn("[License] audit failed", err));

      return newState;
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

      let validation: WhopValidationResponse;
      try {
        validation = await this.validateWithWhop(key);
      } catch (error) {
        if (error instanceof LicenseError && error.code === "NETWORK") {
          logger.warn("[License] Re-validation failed (offline grace)", { error });
          return true; // keep cached state
        }
        throw error;
      }

      if (!validation.valid) {
        // Explicit invalid/expired/revoked → downgrade to Free.
        this.clearState();
        auditLog
          .record({
            action: "license_validated",
            target: "license",
            result: "failure",
            origin: "LicenseService",
            context: { status: validation.status ?? "unknown" },
          })
          .catch((err) => logger.warn("[License] audit failed", err));
        return false;
      }

      // Update expiry date if present
      let expiresAt: number | undefined;
      if (validation.expires_at) {
        expiresAt = new Date(validation.expires_at).getTime();
      }

      this.persistState({
        ...state,
        validatedAt: Date.now(),
        expiresAt,
      });

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
