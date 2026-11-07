/**
 * ADR-052 Fase 2 — v5 residue notice unit tests.
 *
 * Pins the notice contract: consecutive-unlock streak semantics, the
 * threshold decision, and the fail-quiet handling of the "unknown" sample
 * (unreadable corpus is never counted as residue).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  V5_RESIDUE_NOTICE_THRESHOLD,
  V5_RESIDUE_STREAK_KEY,
  getV5ResidueStreak,
  sampleV5ResidueAfterUnlock,
  shouldShowV5ResidueNotice,
} from "../../../services/security-vault/v5-residue-notice";

const reportMock = vi.fn();

vi.mock("../../../services/security-vault/kdf-salt", () => ({
  reportVaultSecretFormatExposure: () => reportMock(),
}));

describe("v5-residue-notice (ADR-052 Fase 2)", () => {
  beforeEach(() => {
    localStorage.clear();
    reportMock.mockReset();
  });

  it("has no streak and no notice on a fresh profile", () => {
    expect(getV5ResidueStreak()).toBeNull();
    expect(shouldShowV5ResidueNotice()).toBe(false);
  });

  it("ignores a stored value that is not a non-negative integer", () => {
    for (const raw of ["-1", "abc", "1.5", ""]) {
      localStorage.setItem(V5_RESIDUE_STREAK_KEY, raw);
      expect(getV5ResidueStreak()).toBeNull();
    }
  });

  it("increments the streak per unlock while residue persists, and notices at the threshold", async () => {
    reportMock.mockResolvedValue({ status: "ok", inspected: 3, legacyV5: 1, saltedV6: 2, legacyKeys: [] });

    await sampleV5ResidueAfterUnlock();
    expect(getV5ResidueStreak()).toBe(1);
    expect(shouldShowV5ResidueNotice()).toBe(false);

    await sampleV5ResidueAfterUnlock();
    expect(getV5ResidueStreak()).toBe(2);
    expect(shouldShowV5ResidueNotice()).toBe(true);
  });

  it("clears the streak when a sample reports zero residue (migration done)", async () => {
    localStorage.setItem(V5_RESIDUE_STREAK_KEY, "3");
    reportMock.mockResolvedValue({ status: "ok", inspected: 3, legacyV5: 0, saltedV6: 3, legacyKeys: [] });

    await sampleV5ResidueAfterUnlock();
    expect(getV5ResidueStreak()).toBeNull();
    expect(shouldShowV5ResidueNotice()).toBe(false);
  });

  it("treats an unknown sample as no-residue (fail quiet) and resets the streak", async () => {
    localStorage.setItem(V5_RESIDUE_STREAK_KEY, "1");
    reportMock.mockResolvedValue({ status: "unknown", inspected: 0, legacyV5: 0, saltedV6: 0, legacyKeys: [] });

    await sampleV5ResidueAfterUnlock();
    expect(getV5ResidueStreak()).toBeNull();
    expect(shouldShowV5ResidueNotice()).toBe(false);
  });

  it("samples resolve silently when the exposure report rejects", async () => {
    reportMock.mockRejectedValue(new Error("storage hiccup"));
    await expect(sampleV5ResidueAfterUnlock()).resolves.toBeUndefined();
    expect(getV5ResidueStreak()).toBeNull();
  });

  it("keeps the threshold at 2 (ADR-052 Fase 2: N consecutive unlocks)", () => {
    expect(V5_RESIDUE_NOTICE_THRESHOLD).toBe(2);
  });
});
