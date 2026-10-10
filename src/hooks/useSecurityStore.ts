import { create } from "zustand";
import { encryptionService } from "../services/EncryptionService";
import { securityVault } from "../services/SecurityVault";
import { logger } from "../utils/logger";

interface SecurityState {
  isLocked: boolean;
  forceSetup: boolean;
  unlock: () => void;
  /** UI-only lock transition: flips the shell to the unlock screen.
   *  The crypto layer must be locked separately (securityVault.lock()). */
  lock: () => void;
  setForceSetup: (force: boolean) => void;
}

export const useSecurityStore = create<SecurityState>((set) => ({
  isLocked: true,
  forceSetup: false,
  unlock: () => set({ isLocked: false, forceSetup: false }),
  lock: () => set({ isLocked: true }),
  setForceSetup: (force) => {
    if (force) {
      encryptionService.destroy().catch((err) => {
        logger.warn("[SecurityStore] Failed to destroy encryption service", {
          error: err,
        });
      });
      // SECURITY (S9): the Header lock button and AutoLockManager both route
      // through setForceSetup(true). It MUST also lock the vault itself —
      // otherwise the master-password bytes and the decrypted AI API key stay
      // in memory, securityVault.isLocked() returns false, and cloud AI keeps
      // working after the user "locks" the vault (guard bypass). The UI state
      // change alone only hides the app behind the lock screen.
      //
      // Note: setForceSetup(true) is ALSO the entry to first-time vault
      // creation (SecurityConfirmation → "Set up password"). The vault is
      // already locked on that path; calling lock() anyway would emit an
      // asynchronous audit write and clear crypto state while setup is
      // starting, racing device-key materialization. Only perform the lock
      // transition when an unlocked session actually needs to be closed.
      if (!securityVault.isLocked()) {
        void securityVault.lock().catch((err) =>
          logger.warn("[SecurityStore] Failed to finalize vault lock", {
            error: err,
          }),
        );
      }
    }
    set({ forceSetup: force, isLocked: !!force });
  },
}));
