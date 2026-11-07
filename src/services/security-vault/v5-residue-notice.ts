/**
 * src/services/security-vault/v5-residue-notice.ts
 *
 * ADR-052 Phase 2 — non-blocking residual-v5 notice.
 *
 * Phase 1 (DiagnosticService exposure report) measures the residual legacy
 * `v5:` corpus AFTER the user unlocks: at that point the per-vault KDF salt
 * is installed and the secret corpus is readable for classification. The
 * notice decision itself is rendered on the LOCKED screen (SecurityManager
 * unlock form), where the sensitive storage is still sealed — so the
 * measurement result is persisted to non-secret localStorage (a bare
 * integer streak; never salt material, never counts tied to a vault) and
 * the UI reads only that integer.
 *
 * Contract (ADR-052 Fase 2):
 *   - The notice appears only when the residual v5 counter has stayed > 0
 *     for N consecutive post-unlock samples (RESIDUE_NOTICE_THRESHOLD).
 *   - It is strictly non-blocking: it never gates unlock or reading. A
 *     `v5:` blob keeps decrypting (legacy read-only path).
 *   - An unreadable storage sample (status "unknown") is NEVER counted as
 *     residue — silence is the fail-quiet direction for a diagnostic.
 *   - A sample with zero residue clears the streak (migration done).
 */

import { reportVaultSecretFormatExposure } from "./kdf-salt";
import { logger } from "../../utils/logger";

/**
 * LocalStorage key for the consecutive-unlock streak. Non-secret by design:
 * it holds a bare integer produced from the Phase 1 exposure report and is
 * never written before the vault is unlocked.
 */
export const V5_RESIDUE_STREAK_KEY = "v5_residue_unlock_streak";

/**
 * Consecutive unlock samples with residual v5 secrets before the notice is
 * shown (ADR-052 Fase 2: "tras N unlocks consecutivos"). A single unlock
 * with residue keeps the UI silent — one transient sample (e.g. the user
 * interrupted a previous unlock mid-migration) must not nag.
 */
export const V5_RESIDUE_NOTICE_THRESHOLD = 2;

/**
 * Reads the persisted consecutive-residue streak. Returns null when no
 * post-unlock sample has been recorded yet (fresh profile, cleared storage)
 * or when the stored value is not an integer — null means "no notice".
 */
export function getV5ResidueStreak(): number | null {
  try {
    const raw = localStorage.getItem(V5_RESIDUE_STREAK_KEY);
    if (raw === null) {
      return null;
    }
    // Digits only — rejects "1.5" (parseInt would truncate it to 1),
    // negatives, signs, whitespace and any other corruption.
    if (!/^\d+$/.test(raw)) {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return parsed;
  } catch (_err) {
    // localStorage unavailable (private mode, storage disabled): no notice.
    return null;
  }
}

/**
 * Phase 2 sampling: re-reads the Phase 1 exposure report and updates the
 * persisted streak. Fire-and-forget from the post-unlock path — every
 * failure mode resolves silently (locked vault races, storage hiccups):
 * a diagnostic must never surface an unlock-flow error.
 */
export async function sampleV5ResidueAfterUnlock(): Promise<void> {
  try {
    const report = await reportVaultSecretFormatExposure();
    if (report.status === "unknown") {
      // Unreadable corpus is not evidence of residue: fail quiet, reset.
      clearV5ResidueStreak();
      return;
    }
    if (report.legacyV5 > 0) {
      const next = (getV5ResidueStreak() ?? 0) + 1;
      localStorage.setItem(V5_RESIDUE_STREAK_KEY, String(next));
    } else {
      clearV5ResidueStreak();
    }
  } catch (error) {
    logger.warn("[v5-residue] post-unlock exposure sample failed", { error });
  }
}

function clearV5ResidueStreak(): void {
  try {
    localStorage.removeItem(V5_RESIDUE_STREAK_KEY);
  } catch (_err) {
    // Best-effort cleanup; the notice simply stays stale-safe (a positive
    // streak below the threshold keeps the UI silent anyway).
  }
}

/**
 * UI decision (ADR-052 Fase 2): show the notice only when the persisted
 * streak has reached the threshold. Non-blocking by definition — the
 * caller renders a passive banner; unlock and reading are never gated.
 */
export function shouldShowV5ResidueNotice(): boolean {
  const streak = getV5ResidueStreak();
  return streak !== null && streak >= V5_RESIDUE_NOTICE_THRESHOLD;
}
