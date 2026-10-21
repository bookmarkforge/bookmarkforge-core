import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectOverridePins,
  evaluateOverridePins,
  pinMatch,
  resolvePinInstances,
  runCheck,
} from "../check-override-cve.mjs";

/** Lockfile skeleton: `node_modules/<key>` → version. */
function lockOf(entries) {
  return {
    packages: Object.fromEntries(
      Object.entries(entries).map(([key, version]) => [key, { version }]),
    ),
  };
}

/** Audit skeleton: `pkg` → severity/range/advisories. */
function auditOf(entries) {
  return {
    vulnerabilities: Object.fromEntries(
      Object.entries(entries).map(([name, spec]) => [
        name,
        {
          severity: spec.severity ?? "high",
          range: spec.range ?? "*",
          via: spec.via ?? [
            {
              title: `${name} advisory`,
              url: `https://github.com/advisories/${name}`,
              severity: spec.severity ?? "high",
            },
          ],
          fixAvailable: spec.fixAvailable ?? false,
        },
      ]),
    ),
  };
}

/** Write a parsed audit payload to a throwaway file for runCheck(). */
function writeAuditFixture(payload) {
  const dir = mkdtempSync(join(tmpdir(), "check-override-cve-"));
  const path = join(dir, "audit.json");
  writeFileSync(path, JSON.stringify(payload));
  return path;
}

describe("collectOverridePins", () => {
  it("flattens both override shapes and records the JSON path", () => {
    const pins = collectOverridePins({
      rxdb: { ws: "8.21.2", ajv: "8.20.0" },
      "@huggingface/transformers": { sharp: "^0.35.4" },
      "adm-zip": "0.6.1",
    });
    expect(pins).toEqual([
      { name: "ws", spec: "8.21.2", path: "rxdb.ws" },
      { name: "ajv", spec: "8.20.0", path: "rxdb.ajv" },
      { name: "sharp", spec: "^0.35.4", path: "@huggingface/transformers.sharp" },
      { name: "adm-zip", spec: "0.6.1", path: "adm-zip" },
    ]);
  });

  it("returns nothing for an absent or malformed overrides block", () => {
    expect(collectOverridePins(undefined)).toEqual([]);
    expect(collectOverridePins([])).toEqual([]);
    expect(collectOverridePins({ rxdb: { ws: ["8.21.2"] } })).toEqual([]);
  });
});

describe("pinMatch", () => {
  it("accepts and rejects exact pins", () => {
    expect(pinMatch("0.6.1", "0.6.1")).toBe("ok");
    expect(pinMatch("0.6.1", "0.6.0")).toBe("mismatch");
    expect(pinMatch("0.6.1", "0.6.2")).toBe("mismatch");
  });

  it("understands caret and tilde, including the major-0 rule", () => {
    expect(pinMatch("^0.35.4", "0.35.4")).toBe("ok");
    expect(pinMatch("^0.35.4", "0.36.0")).toBe("mismatch");
    expect(pinMatch("^0.35.4", "0.35.3")).toBe("mismatch");
    expect(pinMatch("^0.35.4", "1.0.0")).toBe("mismatch");
    expect(pinMatch("^1.2.3", "2.0.0")).toBe("mismatch");
    expect(pinMatch("^1.2.3", "1.9.0")).toBe("ok");
    expect(pinMatch("~1.2.3", "1.2.9")).toBe("ok");
    expect(pinMatch("~1.2.3", "1.3.0")).toBe("mismatch");
  });

  it("never guesses on a spec it does not fully understand", () => {
    for (const spec of [">=1.2.3", "1.x", "*", "latest", "1.2.3 || 2.0.0", "file:../pkg"]) {
      expect(pinMatch(spec, "9.9.9")).toBe("unknown");
    }
    expect(pinMatch("1.2.3", "not-a-version")).toBe("unknown");
  });
});

describe("resolvePinInstances", () => {
  const lock = lockOf({
    "node_modules/ajv": "6.15.0",
    "node_modules/rxdb/node_modules/ajv": "8.20.0",
    "node_modules/sharp": "0.35.4",
  });

  it("a nested pin governs its parent's subtree, not the whole tree", () => {
    expect(
      resolvePinInstances({ name: "ajv", spec: "8.20.0", path: "rxdb.ajv" }, lock),
    ).toEqual([{ key: "node_modules/rxdb/node_modules/ajv", version: "8.20.0" }]);
  });

  it("a nested pin falls back to the hoisted copy when npm did not nest one", () => {
    expect(
      resolvePinInstances(
        { name: "sharp", spec: "^0.35.4", path: "@huggingface/transformers.sharp" },
        lock,
      ),
    ).toEqual([{ key: "node_modules/sharp", version: "0.35.4" }]);
  });

  it("a top-level pin governs every instance, nested copies included", () => {
    expect(resolvePinInstances({ name: "ajv", spec: "8.20.0", path: "ajv" }, lock)).toEqual([
      { key: "node_modules/ajv", version: "6.15.0" },
      { key: "node_modules/rxdb/node_modules/ajv", version: "8.20.0" },
    ]);
  });
});

describe("evaluateOverridePins", () => {
  const pins = [
    { name: "adm-zip", spec: "0.6.1", path: "onnxruntime-node.adm-zip" },
    { name: "sharp", spec: "^0.35.4", path: "@huggingface/transformers.sharp" },
  ];
  const lock = lockOf({
    "node_modules/adm-zip": "0.6.1",
    "node_modules/sharp": "0.35.4",
  });

  it("passes clean pins with no advisories", () => {
    expect(evaluateOverridePins({ pins, lock, audit: auditOf({}) })).toEqual([]);
  });

  it("ignores advisories owned by packages we do not pin", () => {
    const audit = auditOf({ "some-transitive-dep": { severity: "moderate" } });
    expect(evaluateOverridePins({ pins, lock, audit })).toEqual([]);
  });

  it("fails when a pinned package is still reported vulnerable", () => {
    const audit = auditOf({ sharp: { severity: "high", range: "<0.35.4" } });
    const failures = evaluateOverridePins({ pins, lock, audit });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("pin A");
    expect(failures[0]).toContain('@huggingface/transformers.sharp="^0.35.4"');
    expect(failures[0]).toContain("HIGH");
    expect(failures[0]).toContain("no fix published by npm audit");
  });

  it("prints the published fix so the pin can be corrected in one edit", () => {
    const audit = auditOf({
      sharp: { range: "<0.35.4", fixAvailable: { name: "sharp", version: "0.35.4" } },
    });
    expect(evaluateOverridePins({ pins, lock, audit })[0]).toContain("fix available: 0.35.4");
  });

  it("fails when the override never took effect in the lockfile", () => {
    const stale = lockOf({ "node_modules/adm-zip": "0.6.0", "node_modules/sharp": "0.35.3" });
    const failures = evaluateOverridePins({ pins, lock: stale, audit: auditOf({}) });
    expect(failures).toHaveLength(2);
    expect(failures.every((f) => f.includes("pin B"))).toBe(true);
    expect(failures[0]).toContain("installs adm-zip@0.6.0");
  });

  it("fails on a stale pin that matches nothing installed", () => {
    const failures = evaluateOverridePins({
      pins: [{ name: "left-pad", spec: "1.3.0", path: "left-pad" }],
      lock,
      audit: auditOf({}),
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("pin C");
    expect(failures[0]).toContain("stale pin");
  });
});

describe("check-override-cve gate against the real repo", () => {
  it("raises no failure for the committed package.json + package-lock.json", () => {
    // The audit payload is injected so the test stays offline; the pin
    // application and staleness contracts still run against the real files.
    const auditPath = writeAuditFixture({ vulnerabilities: {} });
    expect(runCheck({ auditJsonPath: auditPath })).toEqual([]);
  });

  it("keeps the sharp pin at or above the libheif fix (GHSA-rgj7-g3m4-5g8c)", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(process.cwd(), "package-lock.json"), "utf8"));
    const pin = collectOverridePins(pkg.overrides).find((p) => p.name === "sharp");
    expect(pin, "package.json must keep an override pin for sharp").toBeDefined();
    const [major, minor, patch] = resolvePinInstances(pin, lock)[0].version
      .split(".")
      .map(Number);
    // 0.35.4 is the first release carrying the libheif fixes; 0.35.3 (the
    // version this repo shipped while the override was already bumped, because
    // the lockfile had not been refreshed) must never come back.
    expect(major === 0 && (minor > 35 || (minor === 35 && patch >= 4))).toBe(true);
  });
});
