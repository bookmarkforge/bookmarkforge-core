/**
 * Share-based vault unlock, extracted from SecurityVault.unlockFromShare.
 * The vault injects its private state through ShareUnlockContext so this
 * module stays free of `this` — same delegation pattern as auth.ts,
 * secrets.ts and rotation.ts.
 */
import { logger } from "../../utils/logger";
import { useRateLimitStore } from "../../store/rateLimitStore";
import { constantTimeCompare } from "./compare";
import { deriveShareCredential, parseShareSalt } from "./share";

export interface ShareUnlockContext {
  getRateLimitLockoutUntil: () => number;
  recordFailedAttempt: () => void;
  hasExistingVaultState: (emptyLocalDatabase?: boolean) => Promise<boolean>;
  getMasterPasswordBytes: () => Uint8Array | null;
  /** Clears any previous credential, then installs the derived share credential. */
  installShareCredential: (bytes: Uint8Array) => void;
  clearShareCredential: () => void;
  recordAudit: (params: {
    action: string;
    result: string;
    origin: string;
  }) => void;
  setUnlocked: () => void;
  generateSessionToken: () => Promise<void>;
  startSessionRotation: () => void;
  stopSessionRotation: () => void;
  notifyUnlockListeners: () => void;
  clearSession: () => void;
}

export async function unlockVaultFromShare(
  ctx: ShareUnlockContext,
  shareSecret: string,
  saltJson: string,
  options: {
    allowFreshDevice?: boolean;
    /** Set only after the caller has verified the local RxDB is empty. */
    emptyLocalDatabase?: boolean;
  } = {},
): Promise<boolean> {
  const lockoutUntil = ctx.getRateLimitLockoutUntil();
  if (Date.now() < lockoutUntil) {
    const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
    logger.warn("[SecurityVault] unlockFromShare rate limited", {
      remainingSeconds: remaining,
    });
    return false;
  }

  if (!/^[0-9a-f]{64}$/i.test(shareSecret)) {
    ctx.recordFailedAttempt();
    return false;
  }

  const allowFreshDevice = options.allowFreshDevice === true;
  const salt = parseShareSalt(saltJson, allowFreshDevice ? 16 : 1);
  if (!salt) {
    logger.error("[SecurityVault] unlockFromShare HKDF derivation failed", {
      error: new Error("Invalid share salt"),
    });
    ctx.recordFailedAttempt();
    return false;
  }

  // A configured or otherwise populated vault is never converted into a
  // shared session. This protects legacy installations whose setup flag is
  // missing but still contain encrypted state.
  const emptyLocalDatabase = options.emptyLocalDatabase === true;
  const existingVault = await ctx.hasExistingVaultState(emptyLocalDatabase);

  try {
    if (existingVault) {
      const masterPasswordBytes = ctx.getMasterPasswordBytes();
      if (!masterPasswordBytes) {
        ctx.recordFailedAttempt();
        return false;
      }

      const baseKey = await crypto.subtle.importKey(
        "raw",
        masterPasswordBytes as Uint8Array<ArrayBuffer>,
        { name: "HKDF" },
        false,
        ["deriveBits"],
      );
      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          salt: salt as Uint8Array<ArrayBuffer>,
          info: new TextEncoder().encode("bookmarkforge-share"),
          hash: "SHA-256",
        },
        baseKey,
        256,
      );
      const expected = Array.from(new Uint8Array(derivedBits), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");

      if (!constantTimeCompare(expected, shareSecret)) {
        ctx.recordFailedAttempt();
        return false;
      }
    } else if (allowFreshDevice && emptyLocalDatabase) {
      // Fresh-device bootstrap: the caller has already authenticated the
      // share secret by decrypting the AES-GCM payload with sharePassword.
      // Requiring an explicit empty-database attestation prevents a direct
      // caller from turning an unconfigured but populated legacy vault into
      // a share session.
      // Derive a separate credential so the raw payload secret is never
      // retained as the session's operational key.
      const derivedCredential = await deriveShareCredential(
        shareSecret,
        salt,
      );
      ctx.installShareCredential(derivedCredential);
    } else {
      // Legacy payloads, and v2 payloads without an explicit empty-device
      // attestation, are never allowed to bootstrap a new device. This
      // preserves the old password-bound behavior while current v2 payloads
      // opt into the explicit fresh-device flow.
      ctx.recordFailedAttempt();
      return false;
    }
  } catch (error) {
    logger.error("[SecurityVault] unlockFromShare HKDF derivation failed", {
      error,
    });
    ctx.recordFailedAttempt();
    return false;
  }

  try {
    useRateLimitStore.getState().resetAttempts();
    ctx.recordAudit({
      action: "vault_unlock_from_share",
      result: "success",
      origin: "SecurityVault",
    });

    // SECURITY: derive a fresh session token instead of reusing the share
    // secret. The share secret is known to the remote peer that generated it;
    // reusing it as the session token would give the sharing peer a valid
    // credential for this vault session (cross-session linkability + access).
    ctx.setUnlocked();
    await ctx.generateSessionToken();
    ctx.startSessionRotation();
    ctx.notifyUnlockListeners();
    return true;
  } catch (error) {
    ctx.clearShareCredential();
    ctx.clearSession();
    ctx.stopSessionRotation();
    logger.error("[SecurityVault] Share session activation failed", { error });
    return false;
  }
}
