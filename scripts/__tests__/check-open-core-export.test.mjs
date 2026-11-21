/**
 * scripts/__tests__/check-open-core-export.test.mjs
 *
 * Regression pin for the gate that is supposed to stop Pro code from shipping
 * in the public export.
 *
 * C2 (2026-10-20 audit): the no-argument mode decided "private tree" from the
 * mere PRESENCE of Pro implementations. An export checkout that still carried
 * five Pro `.ts` files therefore hit the private-policy branch, printed OK and
 * exited 0 — inside the published repository, whose own CI runs this gate. The
 * leak was invisible to the one check written to find it.
 *
 * The discriminator is now the auditable root `manifest.json` (license MIT),
 * which only an export ships. These tests build both trees and assert the
 * branch is chosen by the tree's identity, not by its contents.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PLACEHOLDER_MARKER, PRO_MODULE_PATHS } from "../pro-boundary.mjs";

const CLI = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "check-open-core-export.mjs",
);

/** Minimal export tree: MIT metadata + one marked placeholder pair. */
function exportTree({ withProImplementation }) {
  const root = mkdtempSync(join(tmpdir(), "bmf-open-core-"));
  // `PRO_MODULE_PATHS` entries are written with the extension (`…/SyncService.ts`).
  const proModule = PRO_MODULE_PATHS[0];
  const proPath = proModule.replace(/\.tsx?$/, "");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({ license: "MIT", model: "open-core" }),
  );
  writeFileSync(join(root, "LICENSE"), "MIT License\n\nCopyright (c) test\n");
  // The gate fails closed when the published classification is missing, and
  // cross-checks every declared Pro path against it.
  writeFileSync(
    join(root, "OPEN-CORE.md"),
    PRO_MODULE_PATHS.map((path) => `| \`${path}\` | Pro | Excluded |`).join("\n") + "\n",
  );
  writeFileSync(join(root, "src", "index.ts"), "export const core = 1;\n");
  // Both halves of the pair must carry the marker string.
  for (const suffix of [".js", ".d.ts"]) {
    const target = join(root, `${proPath}${suffix}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      suffix === ".js"
        ? `// ${PLACEHOLDER_MARKER}\nexport default new Proxy({}, { get: () => () => undefined });\n`
        : `// ${PLACEHOLDER_MARKER}\ndeclare const inert: unknown;\nexport default inert;\n`,
    );
  }
  if (withProImplementation) {
    const implementation = join(root, proPath + ".ts");
    mkdirSync(dirname(implementation), { recursive: true });
    writeFileSync(
      implementation,
      "export class ProFeature { realImplementation() { return 'proprietary'; } }\n",
    );
  }
  return { root, proPath };
}

const trees = [];
afterEach(() => {
  while (trees.length > 0) {
    rmSync(trees.pop(), { recursive: true, force: true });
  }
});

function runGate(root) {
  return spawnSync(process.execPath, [CLI], { cwd: root, encoding: "utf8" });
}

describe("check-open-core-export — export identity beats tree contents", () => {
  it("fails an export that contains a Pro implementation, with no argument", () => {
    const { root, proPath } = exportTree({ withProImplementation: true });
    trees.push(root);

    const run = runGate(root);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Pro implementations found in public export");
    expect(run.stderr).toContain(proPath + ".ts");
  });

  it("passes the same export once only the placeholder pair remains", () => {
    const { root } = exportTree({ withProImplementation: false });
    trees.push(root);

    const run = runGate(root);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("no Pro implementation in the public export");
  });

  it("still registers policy in a tree with no export manifest (the private repo)", () => {
    const { root } = exportTree({ withProImplementation: true });
    trees.push(root);
    // No audit manifest: this is what the private checkout looks like.
    rmSync(join(root, "manifest.json"));

    const run = runGate(root);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Pro policy registered");
  });
});
