import { describe, expect, it } from "vitest";

// Importa el script como módulo ESM (side-effect free en import) y expone las
// funciones puras que orquestan el drill.
const script = await import("../../scripts/drill-backup-restore.mjs");

describe("drill-backup-restore: gate RTO", () => {
  it("accepts restore times under the RTO gate", () => {
    const result = script.isRestoreWithinRto(99_000, 120_000);
    expect(result).toBe(true);
  });

  it("rejects restore times at or above the RTO gate", () => {
    expect(script.isRestoreWithinRto(120_000, 120_000)).toBe(false);
    expect(script.isRestoreWithinRto(180_000, 120_000)).toBe(false);
  });

  it("treats a missing mark as a failed gate (restore never measured)", () => {
    expect(script.isRestoreWithinRto(undefined, 120_000)).toBe(false);
  });
});