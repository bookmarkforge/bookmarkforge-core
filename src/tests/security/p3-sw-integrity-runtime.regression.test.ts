import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * P3 regression — ADR-039: the service worker verifies EVERY asset it
 * serves against the build integrity manifest (lazy chunks included),
 * closing the last integrity gap from the 2026-09-02 audit (finding B-1:
 * chunks fetched via `import()` after boot were never re-hashed — the DOM
 * check only saw the initial document and the MutationObserver only sees
 * <script> elements).
 *
 * Three seams are pinned so the guarantee cannot silently regress:
 *   1. Build seam — vite.config.ts must keep embedding the manifest +
 *      runtime into dist/sw.js (comment-stripped scan).
 *   2. Client seam — main.tsx must keep wiring initSwIntegrityBridge() so
 *      SW notifications land on the bundle-integrity-failed contract.
 *   3. Runtime seam — scripts/sw-integrity-runtime.js must stay a bare
 *      script body and fail closed (504 semantics live in the behavioral
 *      tests: scripts/__tests__/sw-integrity-runtime.test.mjs).
 */
const VITE_CONFIG_SRC = readFileSync(
  path.resolve(__dirname, "../../../vite.config.ts"),
  "utf-8",
);
const MAIN_SRC = readFileSync(
  path.resolve(__dirname, "../../../src/main.tsx"),
  "utf-8",
);
const RUNTIME_PATH = path.resolve(
  __dirname,
  "../../../scripts/sw-integrity-runtime.js",
);
const RUNTIME_SRC = readFileSync(RUNTIME_PATH, "utf-8");

/** Strip comments so prose never satisfies a code assertion (P2 technique). */
function stripComments(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

describe("P3 regression — ADR-039 SW-side integrity verification", () => {
  it("build embeds the integrity manifest + runtime into the service worker", () => {
    const code = stripComments(VITE_CONFIG_SRC);
    // The plugin must write the embed markers around the runtime.
    expect(code).toContain("__BMF_SW_INTEGRITY_EMBED_START__");
    expect(code).toContain("__BMF_SW_INTEGRITY_EMBED_END__");
    expect(code).toContain("__BMF_SW_INTEGRITY_MANIFEST__");
    expect(code).toContain("sw-integrity-runtime.js");
    // The runtime must be installed before Workbox's fetch listeners run:
    // the embed is PREPENDED at byte 0 of the generated sw.js (the runtime
    // wraps FetchEvent.respondWith on the prototype, so prototype-level
    // patching is dispatch-order independent — but the prepend also pins
    // the manifest assignment ahead of any Workbox code). The embed string
    // starts with a `//` marker, which the comment stripper below eats, so
    // assert on the marker body + the prepend write itself.
    expect(code).toContain("__BMF_SW_INTEGRITY_EMBED_START__");
    expect(code).toContain("writeFileSync(swPath, embed + sw)");
  });

  it("main entry wires the SW→window integrity bridge", () => {
    expect(stripComments(MAIN_SRC)).toContain("initSwIntegrityBridge()");
  });

  it("runtime exists, is a bare script body, and fails closed", () => {
    expect(existsSync(RUNTIME_PATH)).toBe(true);
    // Embeddable: no module syntax (verified behaviorally too — see
    // scripts/__tests__/sw-integrity-runtime.test.mjs).
    expect(RUNTIME_SRC).not.toMatch(/^\s*(?:import|export)\b/m);
    // Fail-closed markers: a mismatch produces a 504 and never the body.
    expect(RUNTIME_SRC).toContain("504");
    expect(RUNTIME_SRC).toContain("bundle-integrity-failed");
    // Verification is scoped to same-origin manifest-listed assets.
    expect(RUNTIME_SRC).toContain("self.location.origin");
  });

  it("behavioral tests for the runtime are registered", () => {
    // The runtime ships in the artifact; its behavioral suite must ship in
    // the repo (both live next to each other and are removed together).
    const behavioral = path.resolve(
      __dirname,
      "../../../scripts/__tests__/sw-integrity-runtime.test.mjs",
    );
    expect(existsSync(behavioral)).toBe(true);
  });
});
