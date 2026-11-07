import { describe, expect, it } from "vitest";
import { LAYERS, RULES, scan } from "../check-context-boundaries.cjs";

describe("check-context-boundaries gate", () => {
  it("keeps the tree free of cross-layer violations", () => {
    expect(scan()).toEqual([]);
  });

  it("exempts test files in src/container from the layer rules", () => {
    const flagged = scan().map((v) => v.file);
    // The container test suite deliberately imports across layers:
    // src/container/database.test.ts -> ../db/database and
    // src/container/AppContainer.test.ts -> ../services/*. walk() skips
    // *.test.* files, so the gate must never flag them — a regression in
    // the test-file exemption would surface right here.
    expect(flagged).not.toContain("src/container/database.test.ts");
    expect(flagged).not.toContain("src/container/AppContainer.test.ts");
    expect(flagged.filter((f) => f.startsWith("src/container/"))).toEqual([]);
  });

  it("declares a components -> db rule pointing at the container gate", () => {
    const rule = RULES.find((r) => r.from === "components" && r.to === "db");
    expect(rule).toBeDefined();
    expect(rule?.label).toContain("src/container/database.ts");
    // src/container itself is intentionally not a layer: it is the
    // sanctioned gate, so its own files are never rule participants.
    expect(LAYERS).not.toHaveProperty("container");
  });
});