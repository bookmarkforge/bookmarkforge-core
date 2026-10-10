/**
 * E2E diagnostics publisher — deliberately a LEAF module (no imports, no
 * app graph). Utilities that live at the bottom of the dependency graph
 * (argon2-kdf is consumed by main-thread chunks AND workers) must not pull
 * heavyweight modules (database → RxDB) in just to publish a diagnostic:
 * that inverts the dependency direction and multiplies the worker bundles.
 *
 * Published hooks (window keys the E2E suite reads):
 *   __bmf_active_kdf_params__ — resolved Argon2id profile { m, t, p }
 *
 * Gating: never ships in real production builds. In dev/test builds the
 * hooks always publish (like the storage-backend diagnostic); in production
 * builds only when explicitly built for E2E (VITE_E2E_KDF_DIAGNOSTICS=true,
 * see src/env.config.ts and scripts/run-mobile-smoke.mjs).
 */

/** Window key the mobile-device E2E profile reads (playwright.mobile.config.ts). */
const E2E_KDF_PARAMS_KEY = "__bmf_active_kdf_params__";

type E2eKdfParams = { m: number; t: number; p: number };

export function publishKdfParams(params: E2eKdfParams): void {
  if (
    import.meta.env.PROD &&
    import.meta.env.VITE_E2E_KDF_DIAGNOSTICS !== "true"
  ) {
    return;
  }
  try {
    (globalThis as unknown as Record<string, unknown>)[E2E_KDF_PARAMS_KEY] = {
      ...params,
    };
  } catch {
    /* Non-configurable globalThis — diagnostics only. */
  }
}
