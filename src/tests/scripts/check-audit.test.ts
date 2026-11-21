/**
 * Wiring test for the check:audit gate (`npm audit --omit=dev`).
 *
 * The gate itself resolves the real dependency tree against the npm
 * registry (network + registry-dependent), so it is enforced by the
 * `check` job in CI rather than exercised here — running it in unit
 * tests would be slow and flaky. This test pins the documented wiring:
 * the script must stay `npm audit --omit=dev` (never silently re-pointed
 * to a weaker invocation). The audit-drift gate was retired in aee9de3
 * together with the audit-ledger machinery it policed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("check:audit (wiring)", () => {
  it("is wired as npm audit --omit=dev", () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["check:audit"]).toBe("npm audit --omit=dev");
  });
});
