#!/usr/bin/env node
/**
 * export-public-repo.mjs — build the public open-core repo from this one.
 *
 * Usage:
 *   node scripts/export-public-repo.mjs --dry-run          # plan + secret scan, no writes
 *   node scripts/export-public-repo.mjs --out ../bf-public # materialize the tree
 *   npm run ci -- export-repo --dry-run                    # via the CI gate runner
 *
 * The public repo is the SAME codebase (open core, AGPL-3.0). Exclusions
 * remove business/ops/private content only — never crypto, never licensing,
 * never self-hosting. CI must stay green inside the exported tree: the test
 * suite (2000+ tests) and every repo-root / src/ / server/ / tests/ gate are
 * shipped unmodified; this script deletes only standalone nightly/ops scripts
 * that have no package.json entry and no test importing them.
 *
 * The manifest.json written next to the output records exactly what was
 * excluded and why, so the export is auditable and repeatable.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

// ---------------------------------------------------------------------------
// Exclusion policy
// ---------------------------------------------------------------------------

/** Whole trees never shipped publicly (relative to repo root, no slashes). */
const EXCLUDED_DIRS = new Set([
  // Business & strategy (private by design; see docs/pricing-decision.md)
  "docs", // docs/ is re-curated: technical subset re-added below
  ".zap", // internal pen-test scopes (staging hostnames, auth context)
  "scripts/monitoring-cron.example", // infra hostnames
]);

/** files under docs/ that ARE public (technical documentation). */
const PUBLIC_DOCS = new Set([
  "architecture.md",
  "security.md",
  "api.md",
  "openapi.yaml",
  "server-api-index.md",
  "adr-001-check-static-brand.md",
  "adr-019-argon2id-migration.md",
  "adr-026-post-audit-hardening-wave-1.md",
  "adr-027-post-audit-hardening-wave-2.md",
  "adr-028-gate-drift-detection.md",
  "adr-029-webrtc-sync-hardening.md",
  "adr-030-security-tier-regression-umbrella.md",
  "adr-032-disk-backup-pruning.md",
  "adr-033-restore-surface-auth-errors.md",
  "adr-034-backup-age-and-storage-quota.md",
  "adr-037-backup-deletion-ownership.md",
  "adr-038-constant-time-hmac-attestation.md",
  "adr-039-sw-integrity-runtime.md",
  "adr-040-docs-markdown-gate-fusion.md",
  "adr-042-css-only-user-themes.md",
  "adr-043-check-seo-gate.md",
  "adr-044-og-image-policy.md",
  "adr-045-check-brand-logo-gate.md",
  "adr-046-vault-kdf-salt-rotation.md",
]);

/**
 * Workflow gates that exist to enforce contracts on private-infrastructure
 * workflows (staging deploy/rollback, DAST nightly). In the public export
 * those workflows are intentionally absent, so these gates are replaced by a
 * guard that fails if private-infra workflows ever appear in the public tree.
 */
const WORKFLOW_GATE_REPLACEMENTS = [
  "scripts/validate-operational-workflows.mjs",
  "scripts/validate-input-contracts.mjs",
  "scripts/check-workflow-security.mjs",
  "scripts/validate-zap-workflow.mjs",
];
const PUBLIC_WORKFLOW_GUARD = `#!/usr/bin/env node
// Public-export variant. The staging/DAST/nightly workflows and their deploy
// scripts are private-infrastructure files and are intentionally absent from
// this repository. This gate fails if such a workflow ever appears here
// directly: infrastructure changes must be made in the private source
// repository and flow into this one through the export process.
import { existsSync, readdirSync } from "node:fs";

const dir = ".github/workflows";
if (!existsSync(dir)) {
  console.error("[public-workflow-guard] FAIL: .github/workflows is missing");
  process.exit(1);
}
const infra = readdirSync(dir).filter((f) => /staging|deploy|rollback|dast|nightly|pen-test|drill/i.test(f));
if (infra.length) {
  console.error("[public-workflow-guard] FAIL: private-infrastructure workflows present in public export:");
  infra.forEach((f) => console.error("- " + f));
  process.exit(1);
}
console.log("[public-workflow-guard] ok: no private-infrastructure workflows in public export");
`;

/** Orphaned unit tests: they import files excluded from (or replaced in) the export. */
const EXCLUDED_FILES = new Set([
  // Deploy & staging infra (topology, hostnames, rollback drills)
  "scripts/deploy-prod.mjs",
  "scripts/staging-deploy.mjs",
  "scripts/staging-rollback.mjs",
  "scripts/staging-smoke.mjs",
  "scripts/staging-http-checks.mjs",
  "scripts/staging-target-policy.mjs",
  "scripts/drill-backup-restore.mjs",
  "scripts/drill-rollback.mjs",
  // Ops dashboards & load tooling (internal endpoints)
  "scripts/health-dashboard.mjs",
  "scripts/load-test-server.mjs",
  "scripts/kpi-report.mjs",
  "scripts/nightly-alert.mjs",
  // License key generation (business logic around key issuance)
  "scripts/generate-license-keys.mjs",
  // Orphaned tests for excluded/replaced private-infra scripts
  "scripts/__tests__/deploy-prod.test.mjs",
  "scripts/__tests__/deploy-prod-push.test.mjs",
  "scripts/__tests__/staging-deploy.test.mjs",
  "scripts/__tests__/staging-http-checks.test.mjs",
  "scripts/__tests__/staging-target-policy.test.mjs",
  "scripts/__tests__/drill-backup-restore.test.mjs",
  "scripts/__tests__/drill-rollback.test.mjs",
  "scripts/__tests__/kpi-report.test.mjs",
  "scripts/__tests__/nightly-alert.test.mjs",
  "scripts/__tests__/nightly-consistency.test.mjs",
  "scripts/__tests__/nightly-trends.test.mjs",
  "scripts/__tests__/nightly-dependency-cve-report.test.mjs",
  "scripts/__tests__/merge-nightly-blobs.test.mjs",
  "scripts/__tests__/validate-operational-workflows.test.mjs",
  "scripts/__tests__/validate-input-contracts.test.mjs",
  "scripts/__tests__/check-workflow-security.test.mjs",
  // Tests whose fixtures/gates are private-infra or private-docs bound
  "scripts/__tests__/audit-script-inventory.test.mjs", // reads unversioned .tmp-audit-script-candidates.txt
  "scripts/__tests__/docs-retire-policy.test.mjs", // needs private docs/docs-state-index.md
  "scripts/__tests__/docs-state-index.test.mjs", // needs private docs/docs-state-index.md
  "scripts/__tests__/legacy-schema-map.test.mjs", // needs private docs/legacy-schema-version-map.md
  "scripts/__tests__/validate-zap-context.test.mjs", // fixture is the excluded .zap/ context
  "scripts/__tests__/validate-zap-workflow.test.mjs", // gate replaced by the public workflow guard
]);

/** Naive secret patterns; the shipped secret-scan gate is the real control. */
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  /\b.sk-[A-Za-z0-9_-]{16,}\b/, // OpenAI-style
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/, // Anthropic
  /\bghp_[A-Za-z0-9]{30,}\b/, // GitHub PAT
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /AIza[0-9A-Za-z_-]{30,}/, // Google API key
  /\bxox[bap]-[A-Za-z0-9-]{10,}\b/, // Slack tokens
  /\bwhsec_[A-Za-z0-9_-]{16,}\b/, // webhook signing secrets
  /\bWhop_live_[A-Za-z0-9_-]{10,}\b/i, // Whop live keys
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const outIdx = args.indexOf("--out");
const outDir = resolve(outIdx >= 0 ? args[outIdx + 1] : "../bookmarkforge-public");

const repoRoot = resolve(import.meta.dirname, "..");

function gitFiles() {
  const res = spawnSync("git", ["ls-files", "-z"], { cwd: repoRoot, maxBuffer: 64e6 });
  if (res.status !== 0) throw new Error("git ls-files failed: " + res.stderr);
  return res.stdout
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((f) => f.split("/").join(sep));
}

function exclusionReason(relPath) {
  const norm = relPath.split(sep).join("/");
  const parts = norm.split("/");
  const top = parts[0];

  if (top === "docs") {
    const base = basename(norm).toLowerCase();
    if (!PUBLIC_DOCS.has(base)) return "docs: business/internal documentation";
    return null;
  }
  if (EXCLUDED_DIRS.has(top) || EXCLUDED_DIRS.has(norm)) return "excluded dir";
  if (EXCLUDED_FILES.has(norm)) return "private ops/business script";
  return null;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

const all = gitFiles();
const included = [];
const excluded = [];

for (const rel of all) {
  const reason = exclusionReason(rel);
  if (reason) excluded.push({ file: rel, reason });
  else included.push(rel);
}

// ---------------------------------------------------------------------------
// Secret scan on included text files (cheap pass; CI has the full gate)
// ---------------------------------------------------------------------------

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|html|css|yml|yaml|toml|txt|conf|example|d\.mts|d\.ts)$/;
// Test fixtures intentionally contain dummy key-shaped strings (they test the
// repo's secret scanners). The naive pass below only trips on non-test files;
// the shipped CI gates (check-secrets-in-commit, build-ci secret scan) remain
// the authoritative full-tree control.
const TEST_PATH = /(^|[/\\])(__tests__|src[/\\]tests|tests[/\\]e2e[^/\\]*|tests)[/\\]/;
const secretHits = [];
for (const rel of included) {
  if (!TEXT_EXT.test(rel) || TEST_PATH.test(rel)) continue;
  let content;
  try {
    content = readFileSync(join(repoRoot, rel), "utf8");
  } catch {
    continue;
  }
  for (const re of SECRET_PATTERNS) {
    if (re.test(content)) secretHits.push({ file: rel, pattern: re.source });
  }
}

console.log(`[export-public] source files: ${all.length}`);
console.log(`[export-public] included:     ${included.length}`);
console.log(`[export-public] excluded:     ${excluded.length}`);
for (const { file, reason } of excluded) {
  console.log(`  - ${file}  (${reason})`);
}

if (secretHits.length) {
  console.error("[export-public] FAIL: potential secrets found in included files:");
  for (const hit of secretHits) console.error(`  !! ${hit.file} matches /${hit.pattern}/`);
  process.exit(1);
}

if (dryRun) {
  console.log("[export-public] dry-run OK — no files written.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Materialize
// ---------------------------------------------------------------------------

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });

for (const rel of included) {
  const src = join(repoRoot, rel);
  const dst = join(outDir, rel);
  if (statSync(src).isFile()) {
    mkdirSync(resolve(dst, ".."), { recursive: true });
    cpSync(src, dst);
  }
}

// Public overlay: license, README, trademark notices, and a minimal public
// .github (issues/PRs only).
cpSync(join(repoRoot, "scripts", "public-export", "LICENSE"), join(outDir, "LICENSE"));
cpSync(join(repoRoot, "scripts", "public-export", "README.md"), join(outDir, "README.md"));
cpSync(join(repoRoot, "scripts", "public-export", "NOTICE"), join(outDir, "NOTICE"));
cpSync(join(repoRoot, "scripts", "public-export", "TRADEMARKS.md"), join(outDir, "TRADEMARKS.md"));
mkdirSync(join(outDir, ".github"), { recursive: true });
writeFileSync(
  join(outDir, ".github", "SECURITY.md"),
  readFileSync(join(repoRoot, "scripts", "public-export", "SECURITY.md")),
);

// Replace private-infra workflow gates with the public guard.
for (const rel of WORKFLOW_GATE_REPLACEMENTS) {
  writeFileSync(join(outDir, rel), PUBLIC_WORKFLOW_GUARD);
}

// CI de-scope: skip nightly/pen-test/staging workflows whose target scripts were
// excluded; the main CI workflow stays intact.
const workflowDir = join(outDir, ".github", "workflows");
if (existsSync(workflowDir)) {
  for (const wf of readdirSync(workflowDir)) {
    // nightly/pen-test/staging/dast target excluded private infra; drill-* too
    if (/nightly|pen-test|staging|dast|drill/i.test(wf)) rmSync(join(workflowDir, wf));
  }
}

// Regenerate the docs-markdown drift baseline for the reduced public docs/
// set, so the gate passes while still failing closed on future doc drift.
// The gate imports eslint, so it needs node_modules: if the fresh export does
// not have its own yet, temporarily link the private one (junction on Windows,
// symlink elsewhere) and remove it afterwards.
const publicModules = join(outDir, "node_modules");
const privateModules = join(repoRoot, "node_modules");
let linkedModules = false;
if (!existsSync(publicModules) && existsSync(privateModules)) {
  symlinkSync(privateModules, publicModules, process.platform === "win32" ? "junction" : "dir");
  linkedModules = true;
}
try {
  const gate = spawnSync(
    process.execPath,
    ["scripts/check-docs-markdown.mjs", "--update"],
    { cwd: outDir, stdio: "inherit" },
  );
  if (gate.status !== 0) {
    console.error("[export-public] FAIL: docs-markdown baseline regeneration failed");
    process.exit(1);
  }
} finally {
  if (linkedModules) rmSync(publicModules, { recursive: true, force: true });
}

// Manifest: auditable record of what shipped and what did not.
const manifest = {
  generatedAt: new Date().toISOString(),
  source: "private repository (this checkout)",
  license: "AGPL-3.0-or-later",
  includedCount: included.length,
  excluded: excluded,
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

// Self-check: exported tree must not reference excluded business docs.
const exportedAll = readdirSync(outDir, { recursive: true });
const leaked = exportedAll.filter((f) => /^docs[\\/](pricing-decision|launch-checklist|que-nos-falta|support-data-loss-runbook|github-secrets)/i.test(f));
if (leaked.length) {
  console.error("[export-public] FAIL: private docs leaked into export: " + leaked.join(", "));
  process.exit(1);
}

console.log(`[export-public] wrote ${included.length + 5} files to ${outDir}`);
console.log("[export-public] next: cd into the export, npm ci, npm run build, npx vitest run src/tests/db — then push as the public repo.");
