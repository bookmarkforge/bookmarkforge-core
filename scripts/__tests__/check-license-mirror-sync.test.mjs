import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assessLicenseMirrors,
  MIRROR_PAIRS,
  normalizeForMirrorCompare,
} from "../license-mirror-contract.mjs";

const BASE = "export function seatCount() {\n  return 1 + 1;\n}\n";

function filesFor(overrides = {}) {
  const files = {};
  for (const pair of MIRROR_PAIRS) {
    files[pair.apiPath] = overrides[pair.apiPath] ?? `// api header\n${BASE}`;
    files[pair.serverPath] =
      overrides[pair.serverPath] ?? `/** server header */\n${BASE}`;
  }
  return files;
}

describe("license mirror sync gate", () => {
  it("passes when both copies are code-identical modulo comments", () => {
    const results = assessLicenseMirrors(filesFor());
    expect(results.every((r) => r.status === "ok")).toBe(true);
  });

  it("ignores whitespace and comment-only differences", () => {
    const normalized = normalizeForMirrorCompare(
      "// c\nconst a=1;// tail\nconst u='https://x.y';",
    );
    expect(normalized).toBe("const a=1; const u='https://x.y';");
  });

  it("fails on real code drift in either direction", () => {
    const drifted = filesFor({
      "api/license/_license-seats.ts": "// api\nexport function seatCount() {\n  return 2;\n}\n",
    });
    const results = assessLicenseMirrors(drifted);
    const seats = results.find((r) => r.label === "license-seats");
    expect(seats.status).toBe("drift");
    expect(results.find((r) => r.label === "license-signing").status).toBe("ok");
  });

  it("fails when a mirror file is missing", () => {
    const files = filesFor();
    delete files["server/src/license-signing.ts"];
    const results = assessLicenseMirrors(files);
    expect(results.find((r) => r.label === "license-signing").status).toBe(
      "missing",
    );
  });

  it("real repository mirrors are currently in sync", () => {
    const files = {};
    for (const pair of MIRROR_PAIRS) {
      for (const path of [pair.apiPath, pair.serverPath]) {
        files[path] = readFileSync(path, "utf8");
      }
    }
    const results = assessLicenseMirrors(files);
    expect(results.filter((r) => r.status !== "ok")).toEqual([]);
  });
});
