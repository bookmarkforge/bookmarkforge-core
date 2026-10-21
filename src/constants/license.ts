// src/constants/license.ts
//
// Licensing config for BookmarkForge Pro (one-time payment, lifetime).
// The app validates licenses directly with Whop's API using a public/restricted
// API key. Validation responses are cached locally for offline-first access.

import { env } from "../env.config";

export const LICENSE_CONFIG = {
  /**
   * Public Whop checkout URLs. These stay empty until deployment configuration
   * provides the concrete product URLs; the UI disables checkout otherwise.
   */
  checkoutUrlProEarly: env.whopCheckoutUrlEarly?.trim() ?? "",
  checkoutUrlProRegular: env.whopCheckoutUrlRegular?.trim() ?? "",

  /**
   * Product name shown in the UI.
   */
  planName: "BookmarkForge Pro",

  /**
   * TTL of the locally cached validated license before re-validating.
   * Offline-first: a Pro user keeps Pro features while offline (grace
   * period covers travel, outages and the license server being
   * unreachable).
   */
  cacheTtlMs: 48 * 60 * 60 * 1000,

  /**
   * The state/device keys are local metadata. `licenseKey` is retained
   * only as a legacy migration key; new activations store the credential in
   * SecureStorage under `bf_license_key_secure`.
   */
  storageKeys: {
    /** Legacy plaintext key retained only for one-time migration/cleanup. */
    licenseKey: "bf_license_key",
    /** Validated license state (see src/services/LicenseService.ts). */
    licenseState: "bf_license_state",
    /** Per-install UUID. */
    deviceId: "bf_device_id",
  },
} as const;

export const isCheckoutConfigured = (): boolean => {
  const early = LICENSE_CONFIG.checkoutUrlProEarly.trim();
  const regular = LICENSE_CONFIG.checkoutUrlProRegular.trim();
  if (!early && !regular) return false;
  const value = early || regular;
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
