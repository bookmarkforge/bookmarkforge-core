// src/constants/license.ts
//
// Licensing config for BookmarkForge Pro (one-time payment, lifetime).
// The app talks to a license signing service (same-origin `/api/license`)
// that validates the activation and signs the resulting license state; the
// app only VERIFIES that signature with its public key (see
// src/services/LicenseService.ts and server/src/license-signing.ts).
// The license key is the only credential and travels over TLS.
//
// Whop entitlement checks run through the server-side adapter; the browser
// never calls Whop or receives its API credential.

import { env } from "../env.config";

export const LICENSE_CONFIG = {
  /**
   * Base URL of the license signing service. Defaults to a same-origin
   * relative path so the app's CSP `connect-src 'self'` and network
   * firewall cover it with no extra policy; self-hosters override with
   * VITE_LICENSE_SIGNING_URL. The service exposes /activate, /validate and
   * /deactivate under this base.
   */
  signingServiceBaseUrl: "/api/license",

  /**
   * Public Whop checkout URL. It stays empty until deployment configuration
   * provides the concrete product URL; the UI disables checkout otherwise.
   */
  checkoutUrlPro: env.whopCheckoutUrl?.trim() ?? "",

  /**
   * Product name shown in the UI.
   */
  planName: "BookmarkForge Pro",

  /**
   * Max device activations per license. Mirrors the activations limit set
   * on the license product; each install consumes one slot. 5 devices
   * (Pro tier, PRICING_CONFIG).
   */
  maxActivationsPerLicense: 5,

  /**
   * TTL of the locally cached validated license before re-validating.
   * Offline-first: a Pro user keeps Pro features while offline (grace
   * period covers travel, outages and the license server being
   * unreachable).
   */
  // How long a signed Pro payload is trusted offline before re-validation.
  // 48h (was 7d): a refunded/revoked license must fall back to Free within
  // two days of normal app use, while a 2-day offline window still covers
  // honest users (vacations, travel). The entitlement endpoint independently
  // rejects proofs older than 30d regardless of this value.
  cacheTtlMs: 48 * 60 * 60 * 1000,

  /**
   * Legacy UI compatibility value. Local trial timestamps never grant Pro;
   * any trial must be issued and signed by the server-side entitlement flow.
   */
  trialDays: 7,

  /**
   * The state/device/trial keys are local metadata. `licenseKey` is retained
   * only as a legacy migration key; new activations store the credential in
   * SecureStorage under `bf_license_key_secure`.
   */
  storageKeys: {
    /** Legacy plaintext key retained only for one-time migration/cleanup. */
    licenseKey: "bf_license_key",
    /** Validated license state (see src/services/LicenseService.ts). */
    licenseState: "bf_license_state",
    /** Per-install UUID consumed as the license server `instance_name`. */
    deviceId: "bf_device_id",
    /** Legacy trial timestamp; retained only so old clients can be cleaned up. */
    trialStartedAt: "bf_trial_started_at",
  },
} as const;

export const isCheckoutConfigured = (): boolean => {
  const value = LICENSE_CONFIG.checkoutUrlPro.trim();
  if (!value || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) &&
      !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

/**
 * Free-tier limits enforced at runtime (mirror PRICING_CONFIG free tier).
 *
 * maxDevices is 0 = unlimited: BookmarkForge has no accounts, so a per-device
 * cap is unenforceable — Free simply installs anywhere, each device holding
 * its own vault. Sync between devices is the Pro entitlement, and the Pro
 * tier's maxDevices (5) is enforced there by the licensing backend.
 */
export const FREE_LIMITS = {
  maxBookmarks: 2500,
  maxDevices: 0,
} as const;
