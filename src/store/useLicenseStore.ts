// src/store/useLicenseStore.ts
//
// Reactive Pro entitlement state for the UI. The single source of truth is
// licenseService (src/services/LicenseService.ts); this store only mirrors
// the latest Entitlements snapshot so React components re-render on change.

import { create } from "zustand";
import {
  licenseService,
  type Entitlements,
  type LicenseError,
} from "../services/LicenseService";

interface LicenseStoreState {
  entitlements: Entitlements;
  busy: boolean;
  /** User-facing error message from the last failed activation (localized at call site). */
  error: string | null;
  refresh: () => Promise<void>;
  activate: (key: string) => Promise<boolean>;
  startTrial: () => void;
  deactivate: () => Promise<void>;
}

export const useLicenseStore = create<LicenseStoreState>((set) => ({
  entitlements: licenseService.getEntitlements(),
  busy: false,
  error: null,

  refresh: async () => {
    // A cached signed payload is not trusted until WebCrypto verification has
    // completed. The first synchronous store snapshot is intentionally Free;
    // this refresh promotes it only after the async integrity check succeeds.
    await licenseService.verifyCachedState();
    const entitlements = licenseService.getEntitlements();
    set({ entitlements, error: null });
    if (entitlements.plan === "pro" && entitlements.grace) {
      let refreshFailed = false;
      try {
        // Server first: it needs no license key (the vault may still be
        // locked) and produces the authoritative answer, including the
        // downgrade when the proof is expired, revoked or unverifiable.
        const serverVerdict = await licenseService.refreshEntitlementFromServer();
        set({ entitlements: serverVerdict });
        if (serverVerdict.plan === "free") {
          return;
        }
        // Still Pro per the server: refresh the signed evidence itself so the
        // offline grace window starts over from a freshly validated payload.
        await licenseService.validateInBackground();
      } catch (err) {
        // Boot calls this method without awaiting it. Never leak a provider
        // or storage failure as an unhandled rejection; keep offline grace.
        refreshFailed = true;
        set({
          entitlements,
          error: err instanceof Error ? err.message : "License refresh failed",
        });
      } finally {
        if (!refreshFailed) {
          set({ entitlements: licenseService.getEntitlements() });
        }
      }
    }
  },

  activate: async (key: string) => {
    set({ busy: true, error: null });
    try {
      const entitlements = await licenseService.activate(key);
      set({ entitlements, busy: false });
      return true;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Unknown license error";
      set({ error: msg, busy: false });
      return false;
    }
  },

  startTrial: () => {
    set({ entitlements: licenseService.startTrial() });
  },

  deactivate: async () => {
    set({ busy: true, error: null });
    try {
      await licenseService.deactivate();
      set({ entitlements: licenseService.getEntitlements() });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "License deactivation failed",
      });
    } finally {
      set({ busy: false });
    }
  },
}));

/** Boot hook — call once after network firewall/audit setup (main.tsx). */
export const initLicenseStore = (): void => {
  void useLicenseStore.getState().refresh();
};

export type { LicenseError };
