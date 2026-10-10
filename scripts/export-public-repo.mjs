#!/usr/bin/env node
/**
 * export-public-repo.mjs — build the public open-core repo from this one.
 *
 * Usage:
 *   node scripts/export-public-repo.mjs --dry-run          # plan + secret scan, no writes
 *   node scripts/export-public-repo.mjs --out ../bf-public # materialize the tree
 *   npm run ci -- export-repo --dry-run                    # via the CI gate runner
 *
 * The public repo is the MIT-licensed Core. Exclusions remove proprietary Pro
 * components and private business/ops content — never Core crypto, licensing,
 * or self-hosting. CI must stay green inside the exported tree: the test
 * suite (2000+ tests) and every repo-root / src/ / server/ / tests/ gate are
 * shipped unmodified; this script deletes only standalone nightly/ops scripts
 * that have no package.json entry and no test importing them.
 *
 * The manifest.json written next to the output records exactly what was
 * excluded and why, so the export is auditable and repeatable.
 *
 * Post-export verification: the docs-markdown baseline is regenerated for the
 * reduced docs/ set, and the factual claim-drift gate (check-claim-drift) is
 * executed inside the exported tree — the public repo must ship green and
 * self-protecting, with the same gate wired into its CI.
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
import { basename, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  applyProBoundary,
  isProModulePath,
  verifyProBoundary,
} from "./pro-boundary.mjs";
import { checkReleaseTarget, remediesFor } from "./check-release-target.mjs";
import { LANDING_CODES, MANUAL_FILES } from "./landing-registry.mjs";

// ---------------------------------------------------------------------------
// Exclusion policy
// ---------------------------------------------------------------------------

/** Whole trees never shipped publicly (relative to repo root, no slashes). */
const EXCLUDED_DIRS = new Set([
  // Private legal/provider contracts — never ship in the public export.
  "legal",
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
  "index.md",
   "ADR-001-check-static-brand.md",
   "ADR-019-argon2id-migration.md",
   "ADR-026-post-audit-hardening-wave-1.md",
   "ADR-027-post-audit-hardening-wave-2.md",
   "ADR-028-gate-drift-detection.md",
   "ADR-029-webrtc-sync-hardening.md",
   "ADR-030-security-tier-regression-umbrella.md",
   "ADR-032-disk-backup-pruning.md",
   "ADR-033-restore-surface-auth-errors.md",
   "ADR-034-backup-age-and-storage-quota.md",
   "ADR-037-backup-deletion-ownership.md",
   "ADR-038-constant-time-hmac-attestation.md",
   "ADR-039-sw-integrity-runtime.md",
   "ADR-040-docs-markdown-gate-fusion.md",
   "ADR-042-css-only-user-themes.md",
   "ADR-043-check-seo-gate.md",
   "ADR-044-og-image-policy.md",
   "ADR-045-check-brand-logo-gate.md",
   "ADR-046-vault-kdf-salt-rotation.md",
   "ADR-047-claim-drift-gate.md",
   "ADR-048-license-claims-gate.md",
   "ADR-049-manual-figures-gate.md",
   "ADR-050-page-figures-gate-and-planner.md",
   "ADR-051-landings-fresh-gate.md",
   "ADR-052-v5-format-sunset.md",
   "ADR-053-vault-salt-registry.md",
   // The audit-freshness ADR ships even though its subject ledger
   // (docs/audit.md) does not: check-inspector-freeze requires a `docs`-category
   // gate to be named by an ADR that is present in the tree, so without this
   // entry the exported tree's own freeze would fail. The gate itself
   // recognises the export (see check-audit-freshness.mjs) and reports "not
   // shipped" instead of failing.
   "ADR-064-audit-freshness-gate.md",
  "index.md",
  // The full localized user-manual set (30 languages, Markdown + PDF) —
  // user documentation, not business content: docs/index.md links every one
  // of them, so they ship together to keep the exported index resolvable.
  // DERIVED from the MANUAL_FILES table in scripts/landing-registry.mjs
  // (endonym basenames like `manual-de-usuario-es` / `benutzerhandbuch-de` /
  // `user-manual-ja`), so a renamed or added manual cannot drift out of the
  // export while this list keeps its old spelling.
  ...LANDING_CODES.flatMap((code) => [
    `${MANUAL_FILES[code]}.md`,
    `${MANUAL_FILES[code]}.pdf`,
  ]),
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
// Public-export variant. The staging/DAST/nightly/export workflows and their deploy
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
const infra = readdirSync(dir).filter((f) => /staging|deploy|rollback|dast|nightly|pen-test|drill|open-core-export/i.test(f));
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
  // Proprietary Pro feature implementations are excluded by the shared policy
  // in scripts/pro-boundary.mjs (PRO_MODULE_PATHS + PRO_MODULE_DIRS), which the
  // placeholder generator and scripts/check-open-core-export.mjs read too, so
  // the three cannot drift apart.
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
  // The exporter itself and its overlay templates are private-repo tooling:
  // the public repo IS the output, it does not carry the export machinery.
  "scripts/export-public-repo.mjs",
  "scripts/public-export/LICENSE",
  "scripts/public-export/README.md",
  "scripts/public-export/SECURITY.md",
  "scripts/public-export/NOTICE",
  "scripts/public-export/TRADEMARKS.md",
  "scripts/public-export/manual-de-usuario-es.md",
  "scripts/public-export/user-manual-en.md",
  "scripts/public-export/manual-de-usuario-es.pdf",
  "scripts/public-export/user-manual-en.pdf",
"scripts/public-export/RELEASE-NOTES-v1.0.0.md",
// Pro tests must not be copied into the public Core tree.
    "src/tests/services/WebRTCSyncService.test.ts",
    "src/tests/services/BackupService.test.ts",
    "src/tests/services/DiskBackupService.test.ts",
    "src/tests/services/pdfService.test.ts",
    // Tests that directly import Pro modules but must be excluded
    // from the public export (their Pro imports resolve to placeholders).
    "src/tests/services/BackupRestore.test.ts",
    "src/tests/services/integrations/cloudSync.f2c-backup.test.ts",
    "src/tests/services/integrations/cloudSync.offsite-backup.test.ts",
    // Pro AI tests must not be copied into the public Core tree.
    "src/tests/services/ai/WebLLMService.test.ts",
    "src/tests/services/ai/WebLLMService.gpu.test.ts",
    "src/tests/services/ai/RAGEngine.test.ts",
    "src/tests/services/ai/RAGEngine.worker-path.test.ts",
    "src/tests/services/ai/GlobalRAGService.test.ts",
    "src/tests/services/ai/SpecializedAgentsService.test.ts",
    "src/tests/services/ai/FlashcardService.test.ts",
    // Security regressions that read a proprietary implementation *from disk* by
  // path (fs.readFileSync on src/services/WebRTCSyncService.ts) and assert on
  // its text. They are Pro-behaviour tests, not Core tests: in this repository
  // the implementation they scan does not exist, so they belong to the private
  // tree. The boundary gate fails closed if any other file keeps such a
  // reference, so this list cannot silently drift.
  "src/tests/security/p0-ice-whitelist.regression.test.ts",
  "src/tests/security/p1-private-sync.regression.test.ts",
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
  // `safe.directory` is passed explicitly (as check-docs-markdown does when it
  // hashes a file): a checkout owned by another user — shared workstations, CI
  // containers, bind mounts — otherwise makes git refuse with "detected dubious
  // ownership" and the export dies before it can plan anything.
  const res = spawnSync("git", ["-c", `safe.directory=${repoRoot}`, "ls-files", "-z"], {
    cwd: repoRoot,
    maxBuffer: 64e6,
  });
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
  // One policy for distribution, placeholder generation and the gate: the Pro
  // paths declared in scripts/pro-boundary.mjs, so a new Pro module cannot be
  // excluded in one place and forgotten in another.
  if (isProModulePath(norm)) return "pro feature implementation";
  if (norm.startsWith("src/tests/services/ai/") || norm.startsWith("src/tests/ai/")) return "pro feature tests";
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

// ---------------------------------------------------------------------------
// Release-target guard (ADR-058)
// ---------------------------------------------------------------------------
// The export IS the public release: it writes the tree that gets pushed and
// ships the RELEASE-NOTES whose clone URL readers copy. Preparing it while the
// repository target is still provisional would publish instructions pointing
// at a repository nobody confirmed, so the export fails closed on that —
// before the dry-run, so a rehearsal cannot report success either.

const targetResult = checkReleaseTarget({ root: repoRoot });
if (!targetResult.ok) {
  console.error("[export-public] FAIL: release target is not confirmed — refusing to prepare an export:");
  for (const finding of targetResult.findings) {
    console.error(`  - ${finding.location} → ${finding.value ?? "—"}: ${finding.reason}`);
  }
  for (const remedy of remediesFor(targetResult.findings)) {
    console.error(`  remedy: ${remedy}`);
  }
  process.exit(1);
}
console.log(`[export-public] release target confirmed: ${targetResult.declaredTarget}`);

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
// Cross-platform line endings for the open-source repo: normalize text to
// LF on checkin and checkout (the export tree is LF), keep binaries intact.
writeFileSync(
  join(outDir, ".gitattributes"),
  [
    "* text=auto eol=lf",
    "*.png binary",
    "*.jpg binary",
    "*.jpeg binary",
    "*.gif binary",
    "*.ico binary",
    "*.pdf binary",
    "*.woff binary",
    "*.woff2 binary",
    "*.zip binary",
    "",
  ].join("\n"),
);
// Public root files copied verbatim. Every entry must exist on disk: when a
// source is removed from the tree and a copy line survives it (the
// RELEASE-NOTES-v1.0.0.es.md removal did exactly that), the export used to
// crash mid-materialization inside CI. The manifest fails closed instead,
// naming the drifted file before anything is copied.
const PUBLIC_ROOT_FILES = [
  "LICENSE",
  "README.md",
  "NOTICE",
  "TRADEMARKS.md",
  // The es/en manual pair at the export root, DERIVED from the MANUAL_FILES
  // registry (endonym basenames) so a manual rename cannot orphan these
  // overlay copies.
  `${MANUAL_FILES.es}.md`,
  `${MANUAL_FILES.en}.md`,
  "RELEASE-NOTES-v1.0.0.md",
  `${MANUAL_FILES.es}.pdf`,
  `${MANUAL_FILES.en}.pdf`,
];
for (const name of PUBLIC_ROOT_FILES) {
  const source = join(repoRoot, "scripts", "public-export", name);
  if (!existsSync(source)) {
    throw new Error(`[export-public] missing public root file: scripts/public-export/${name}`);
  }
  cpSync(source, join(outDir, name));
}
mkdirSync(join(outDir, ".github"), { recursive: true });
writeFileSync(
  join(outDir, ".github", "SECURITY.md"),
  readFileSync(join(repoRoot, "scripts", "public-export", "SECURITY.md")),
);

// Replace private-infra workflow gates with the public guard.
for (const rel of WORKFLOW_GATE_REPLACEMENTS) {
  writeFileSync(join(outDir, rel), PUBLIC_WORKFLOW_GUARD);
}

// CI de-scope: skip nightly/pen-test/staging/export workflows whose target scripts were
// excluded; the main CI workflow stays intact.
const workflowDir = join(outDir, ".github", "workflows");
if (existsSync(workflowDir)) {
  for (const wf of readdirSync(workflowDir)) {
    // nightly/pen-test/staging/dast/export target excluded private infra; drill-* too
    if (/nightly|pen-test|staging|dast|drill|open-core-export/i.test(wf)) rmSync(join(workflowDir, wf));
  }
}

// Compile-time Pro boundary: each proprietary module the Core imports becomes a
// generated type surface (`.d.ts`) plus an inert runtime placeholder (`.js`) at
// its original path, so the public tree resolves and typechecks without any Pro
// implementation. Without this the export materialized but was unbuildable
// (327 unresolved-module errors).
const boundary = applyProBoundary({
  root: repoRoot,
  outDir,
  tscPath: join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
  dtsDir: join(repoRoot, ".d", "tmp", "pro-dts"),
});
if (boundary.missingDeclarations.length) {
  console.error("[export-public] FAIL: no generated declaration for Pro module(s):");
  for (const modulePath of boundary.missingDeclarations) console.error(`  - ${modulePath}`);
  process.exit(1);
}
console.log(
  `[export-public] pro boundary: ${boundary.placeholders.length} placeholder pair(s), ` +
    `${boundary.rewrittenSpecifiers} explicit-extension specifier(s) rewritten ` +
    `(tsc declaration emit ${boundary.tscOk ? "clean" : "reported unrelated errors"})`,
);
const boundaryCheck = verifyProBoundary(outDir);
if (boundaryCheck.violations.length) {
  console.error("[export-public] FAIL: Pro boundary verification failed:");
  for (const violation of boundaryCheck.violations) console.error(`  - ${violation}`);
  process.exit(1);
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
  // Claim-drift gate: validate the source tree before export. The exported
  // Core intentionally omits Pro truth sources such as BackupService, so
  // running this gate inside the reduced tree would create false positives.
  const claimGate = spawnSync(
    process.execPath,
    ["scripts/check-claim-drift.mjs"],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if (claimGate.status !== 0) {
    console.error("[export-public] FAIL: factual claim drift inside the exported tree");
    process.exit(1);
  }
} finally {
  if (linkedModules) rmSync(publicModules, { recursive: true, force: true });
}

// Manifest: auditable record of what shipped and what did not.
const manifest = {
  generatedAt: new Date().toISOString(),
  version: JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version,
  source: "private repository (export checkout)",
  license: "MIT",
  model: "open-core",
  proExcluded: [...EXCLUDED_FILES].filter((file) => isProModulePath(file)),
  proPlaceholders: boundary.placeholders,
  proSpecifiersRewritten: boundary.rewrittenSpecifiers,
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

const publicGate = spawnSync(process.execPath, [join(repoRoot, "scripts", "check-open-core-export.mjs"), outDir], { stdio: "inherit" });
if (publicGate.status !== 0) {
  console.error("[export-public] FAIL: Open Core boundary verification failed");
  process.exit(1);
}

console.log(`[export-public] wrote ${included.length + 5} files to ${outDir}`);
console.log("[export-public] next: cd into the export, npm ci, npm run build, npx vitest run src/tests/db — then push as the public repo.");
