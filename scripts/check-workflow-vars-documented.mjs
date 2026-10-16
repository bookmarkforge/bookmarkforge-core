#!/usr/bin/env node
/**
 * scripts/check-workflow-vars-documented.mjs
 *
 * Hygiene gate: every `vars.X` / `secrets.X` referenced in any
 * `.github/workflows/*.yml` must be documented in `.env.example` or in at
 * least one `docs/*.md`. An undocumented repo var or secret is an ops gap —
 * whoever inherits the repository cannot know what to configure. `GITHUB_TOKEN`
 * is exempt (a built-in secret, not configured by the repo owner).
 *
 * Usage: node scripts/check-workflow-vars-documented.mjs
 * Exit 0 when everything referenced is documented; exit 1 listing the
 * undocumented refs and the workflow files that use them.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Built-in GitHub-provided secret: always available, nothing to configure.
const BUILT_IN_SECRETS = new Set(["GITHUB_TOKEN"]);

// `vars.NIGHTLY_HUMAN_LIKE_MAX_MINUTES` / `secrets.CODECOV_TOKEN` →
// ["vars.NIGHTLY_HUMAN_LIKE_MAX_MINUTES", "secrets.CODECOV_TOKEN"]
export function extractReferences(ymlText) {
  const refs = new Set();
  for (const match of (ymlText ?? "").matchAll(/\b(vars|secrets)\.([A-Z][A-Z0-9_]*)/g)) {
    refs.add(`${match[1]}.${match[2]}`);
  }
  return [...refs].sort();
}

// References whose name does not appear anywhere in the documentation blob.
export function findUndocumented(refs, docBlob) {
  return refs.filter((ref) => {
    const name = ref.split(".")[1];
    if (BUILT_IN_SECRETS.has(name)) return false;
    return !(docBlob ?? "").includes(name);
  });
}

export async function main(options = {}) {
  const root = options.root ?? process.cwd();
  const out = options.out ?? console;
  const workflowsDir = join(root, ".github", "workflows");
  const workflows = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  if (!workflows.length) {
    out.error(`[check-workflow-vars-documented] FAIL: no workflows found in ${workflowsDir}`);
    return 1;
  }

  const refsByFile = new Map();
  const allRefs = new Set();
  for (const file of workflows) {
    const text = readFileSync(join(workflowsDir, file), "utf8");
    for (const ref of extractReferences(text)) {
      allRefs.add(ref);
      if (!refsByFile.has(ref)) refsByFile.set(ref, []);
      refsByFile.get(ref).push(file);
    }
  }

  const docPaths = [".env.example", ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];
  const docBlob = docPaths
    .map((p) => {
      try {
        return readFileSync(join(root, p), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");

  const undocumented = findUndocumented([...allRefs], docBlob);
  if (undocumented.length) {
    out.error("[check-workflow-vars-documented] FAIL");
    for (const ref of undocumented) {
      out.error(`- ${ref} — used in ${refsByFile.get(ref).join(", ")}; document it in .env.example or docs/`);
    }
    return 1;
  }
  out.log(`[check-workflow-vars-documented] ok: ${allRefs.size} vars/secrets in ${workflows.length} workflows all documented (${docPaths.length} doc sources)`);
  return 0;
}

const IS_CLI = Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
if (IS_CLI) {
  main().then((code) => {
    process.exitCode = code;
  });
}
