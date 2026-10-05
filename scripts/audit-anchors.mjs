/**
 * scripts/audit-anchors.mjs — regression-anchor gate for the post-audit
 * hardening set (ADR-026 wave 1, ADR-027 wave 2 follow-ups).
 *
 * Fails CI if any of the anchored hardening tests is removed or renames out of
 * its expected location. The anchor catalog is hardcoded (security-critical
 * code paths — adding an anchor is a code change, recorded in the ADR). The
 * committed `scripts/audit-anchors-baseline.json` mirrors the catalog so a
 * newly added anchor cannot silently inflate the gate without an explicit
 * baseline update.
 *
 * Usage:
 *   node scripts/audit-anchors.mjs                  # gate (exit 1 on missing/catalog drift)
 *   node scripts/audit-anchors.mjs --list           # print the anchor catalog
 *   node scripts/audit-anchors.mjs --fix            # refresh baseline metadata/catalog
 *   node scripts/audit-anchors.mjs --strict         # compatibility spelling
 *   node scripts/audit-anchors.mjs --strict-discovery # make discoveries fatal
 *   node scripts/audit-anchors.mjs --json           # machine-readable output
 *
 * Each anchor is a glob (relative to repo root) that must match at least one
 * file under `src/`. Glob syntax is intentionally tiny: `*` (any sequence not
 * containing `/`), `**` (any sequence including `/`), `?` (single char),
 * and the numeric class `[0-9]` used by the security-tier umbrella anchor.
 * Trailing `(ts|tsx|mjs)` is handled by listing parent directories + filter
 * rather than by a multi-extension brace, because Node has no shell here.
 *
 * Designed to be invoked by `scripts/check-audit-drift.mjs` so that
 * `npm run check:audit-drift` (and the broader `npm run check` chain) runs
 * both gates in one command. The anchor gate is also safe to run on its own.
 *
 * By default, the gate also enumerates files matching the canonical
 * shape `src/tests/security/p[0-9]+-*.regression.test.{ts,tsx,mjs}` that
 * are NOT in `ANCHORS[]`. These are surfaced as `NEW ... discovered — not
 * yet anchored` lines (and as `discovered` in `--json`), but they do
 * NOT contribute to the exit code. Promote a discovered file to an
 * anchor via an ADR-level change. Pass `--strict-discovery` to make any
 * discovery a hard failure; `--strict` remains a compatibility alias.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isProSubjectGlob } from "./pro-boundary.mjs";

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, "scripts", "audit-anchors-baseline.json");

/**
 * Canonical list of post-audit hardening regressions and protocol controls.
 *
 * IDs map to an ADR-style decision reference so a removal PR is easy to
 * cross-link. The glob covers both `.test.ts` and `.test.tsx` (and `.mjs`
 * where used) without leaning on shell brace expansion.
 */
export const ANCHORS = [
  {
    id: "p0-ice-whitelist",
    adr: "ADR-026 / ADR-027",
    description:
      "ICE server whitelist — defense against hostile STUN/TURN endpoints.",
    glob: "src/tests/security/p0-ice-whitelist*.regression.test.*",
  },
  {
    id: "p1-private-sync",
    adr: "ADR-026 / ADR-027",
    description:
      "Private records must never be replicated to a peer (vault privacy).",
    glob: "src/tests/security/p1-private-sync*.regression.test.*",
  },
  {
    id: "p2-secure-storage-prod-guard",
    adr: "ADR-026 / ADR-027",
    description:
      "Production guard — refuses to mount unencrypted SecureStorage in prod builds.",
    glob: "src/tests/security/p2-secure-storage-prod-guard*.regression.test.*",
  },
  {
    id: "p3-verify-password-private",
    adr: "ADR-026 / ADR-027",
    description:
      "Unlock surface must not leak whether a vault exists when private-fenced.",
    glob: "src/tests/security/p3-verify-password-private*.regression.test.*",
  },
  {
    id: "p3-constant-time-hmac",
    adr: "ADR-038",
    description:
      "MutationGuard and AttestationChain verify HMAC signatures with the shared constant-time primitive (security-vault/compare) — never ===/!== prefix-oracle comparisons.",
    glob: "src/tests/security/p3-constant-time-hmac*.regression.test.*",
  },
  {
    id: "p3-sw-integrity-runtime",
    adr: "ADR-039",
    description:
      "Service-worker-side integrity verification (lazy chunks included) — the build embeds the manifest + hash-verification runtime into dist/sw.js and the app bridges SW notifications onto bundle-integrity-failed.",
    glob: "src/tests/security/p3-sw-integrity-runtime*.regression.test.*",
  },
  {
    id: "p4-sync-transfer-watchdog",
    adr: "ADR-029 D1",
    description:
      "WebRTCSyncService watchdog clears stalled incoming transfers and releases their session state.",
    glob: "src/tests/services/WebRTCSyncService.test.ts",
  },
  {
    id: "p5-sdp-shape-gate",
    adr: "ADR-029 D2",
    description:
      "WebRTCSyncService rejects malformed, oversized, and role-mismatched SDP before browser handoff.",
    glob: "src/tests/services/WebRTCSyncService.test.ts",
  },
  {
    id: "p4-constant-time-cmp",
    adr: "ADR-029 D5",
    description:
      "Client-side constant-time checksum and HMAC comparison coverage in WebRTCSyncService.",
    glob: "src/tests/services/WebRTCSyncService.test.ts",
  },
  {
    id: "security-tier-4-p-regression-suite",
    adr: "ADR-030 / security tier 4",
    description:
      "Umbrella coverage for every security-tier p[0-9] regression test under src/tests/security.",
    glob: "src/tests/security/p[0-9]-*.regression.test.ts",
  },
  {
    id: "sync-version-comparator",
    adr: "ADR-026 D8 / wave 2",
    description:
      "Numeric revision-height comparator for RxDB LWW (no lexical 9>10 bug).",
    glob: "src/tests/utils/syncVersion.test.*",
  },
  {
    id: "sync-version-comparator-source",
    adr: "ADR-026 D8 / wave 2",
    description:
      "Numeric revision-height comparator source — RxDB LWW dependency for database.core.ts + WebRTCSyncService.ts importers; an attacker (or a refactor) cannot silently regress conflict resolution by deleting the function.",
    glob: "src/utils/syncVersion.ts",
    kind: "source",
  },
  {
    id: "secure-storage-source",
    adr: "ADR-026 / security-critical source",
    description:
      "SecureStorage source remains present so production encryption and device-key locking cannot disappear silently.",
    glob: "src/services/SecureStorage.ts",
    kind: "source",
  },
  {
    id: "webrtc-sync-source",
    adr: "ADR-026 / ADR-029 security-critical source",
    description:
      "WebRTCSyncService source remains present so private-record filtering and bounded authenticated sync cannot disappear silently.",
    glob: "src/services/WebRTCSyncService.ts",
    kind: "source",
  },
  {
    id: "database-core-source",
    adr: "ADR-029 D6 / security-critical source",
    description:
      "database.core.ts source remains present so deterministic RxDB conflict resolution cannot disappear silently.",
    glob: "src/db/database.core.ts",
    kind: "source",
  },
  {
    id: "vault-salt-registry-source",
    adr: "ADR-053 / security-critical source",
    description:
      "salt-registry.ts remains present so the code-level registry of per-vault salt keys (kdf_salt rotation contract, db_salt never-rotate contract, duplicate-slot guard) cannot disappear silently.",
    glob: "src/services/security-vault/salt-registry.ts",
    kind: "source",
  },
  {
    id: "secure-storage-device-key-lock",
    adr: "ADR-026 D2 / wave 2",
    description:
      "Cryptographic device-key generation is serialised across tabs.",
    glob: "src/tests/services/SecureStorage.device-key-lock.test.*",
  },
  {
    id: "signaling-server-bounded-resources",
    adr: "ADR-027 / wave 2",
    description:
      "Self-hosted signaling server: bounded env integers, replay window, constant-time auth, isolated join rate-limit map.",
    glob: "src/tests/sync/signaling-server.test.*",
  },
  {
    id: "disk-backup-pruning-contract",
    adr: "ADR-032 D1 / ADR-037",
    description:
      "DiskBackupService pruning respects MAX_BACKUP_FILES and only removes files with the bookmarkforge-backup- prefix — never foreign files.",
    glob: "src/tests/services/DiskBackupService.test.ts",
  },
  {
    id: "wrong-password-no-restore",
    adr: "ADR-033 D3",
    description:
      "WRONG_PASSWORD and VAULT_LOCKED error classes never offer the restore-from-backup action on the database error screen.",
    glob: "src/tests/app/AppContent.test.tsx",
  },
  {
    id: "manual-export-refreshes-backup-age",
    adr: "ADR-034 D1 / ADR-032",
    description:
      "Manual export from Settings writes LAST_MANUAL_BACKUP_DATE so StorageStatus and the dashboard banner can read the fresh age without a page reload.",
    glob: "src/tests/components/settings/StorageSection.test.tsx",
  },
  {
    id: "p0-vault-kdf-salt",
    adr: "ADR-046",
    description:
      "Per-vault Argon2id salt (A-1): v6 payloads embed their own salt, legacy v5 stays read-only, rotation persists the salt before installing it, and the cross-tab notification is a valueless trigger that re-reads storage.",
    glob: "src/tests/security/p0-vault-kdf-salt*.regression.test.*",
  },
  {
    id: "p0-vault-rotation-rollback-drill",
    adr: "ADR-046 D4",
    description:
      "Rotation-rollback drill: a failure injected at every phase of rotateMasterPassword leaves the vault intact — the old password still unlocks, the KDF salt is restored last, and the rotation promise is cleared.",
    glob: "src/tests/security/p0-vault-rotation-rollback-drill*.test.ts",
  },
  {
    id: "v5-sunset-exposure-counter",
    adr: "ADR-052",
    description:
      "v5 sunset exposure counter (Phase 1): the diagnostic report classifies every password-encrypted secret as legacy v5 or per-vault-salt v6, counts the residual static-salt corpus (the Phase 3 removal gate), and reports unknown — never zero — when storage cannot be read.",
    glob: "src/tests/services/security-vault/kdf-salt-exposure*.test.*",
  },
];

/**
 * Validate the catalog shape before interpreting any glob. Anchor globs are
 * deliberately relative POSIX paths rooted at `src/`; accepting a Windows
 * drive separator or a colon here would make a catalog entry platform-
 * dependent and could otherwise look valid while matching nothing.
 *
 * Exported for unit tests so malformed catalog entries are tested directly,
 * rather than relying on a missing-file failure to expose them indirectly.
 */
export function validateAnchorCatalog(anchors = ANCHORS) {
  const errors = [];
  for (const anchor of anchors) {
    const id = anchor?.id ?? "<missing-id>";
    const glob = anchor?.glob;
    const isRelativeSrcGlob =
      typeof glob === "string" &&
      /^src\/(?:[^/]+\/)*[^/]+$/.test(glob) &&
      !glob.includes(":") &&
      !glob.includes("\\") &&
      !glob.split("/").some((segment) => segment === "." || segment === "..");
    if (!isRelativeSrcGlob) {
      errors.push({
        id,
        glob: typeof glob === "string" ? glob : String(glob),
        reason:
          "anchor glob must be a relative POSIX path rooted at src/ and must not contain ':' or '\\'",
      });
    }
  }
  return errors;
}

/**
 * Convert a tiny glob to a regex. Supports:
 *   **  -> any characters (including '/')
 *   *   -> any characters (excluding '/')
 *   ?   -> single character (excluding '/')
 * Escapes everything else (including `.` and `+`, so the dot in `.test.ts`
 * is literal). Tries to keep the output readable so a faulty glob is obvious
 * when reading test logs.
 */
function globToRegex(glob) {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        pattern += ".*";
        i++;
      } else {
        pattern += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      pattern += "[^/]";
      continue;
    }
    if (glob.slice(i, i + 5) === "[0-9]") {
      pattern += "[0-9]";
      i += 4;
      continue;
    }
    if (/[.+^${}()|[\]\\]/.test(ch)) {
      pattern += "\\" + ch;
      continue;
    }
    pattern += ch;
  }
  return new RegExp("^" + pattern + "$");
}

/**
 * Walk `src/` and yield relative POSIX-style paths. We only need this for
 * patterns the gateway has to interpret; everything else uses `existsSync`
 * for the common exact-path case.
 */
function* walkSrc(root) {
  const srcRoot = join(root, "src");
  if (!existsSync(srcRoot)) return;
  const stack = [srcRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        // Always emit POSIX separators so regexes can match without OS coupling.
        const rel = relative(root, full).split(sep).join("/");
        yield rel;
      }
    }
  }
}

/** Cache: walk the tree once per invocation. */
let _srcIndex = null;
function srcIndex() {
  if (_srcIndex === null) {
    _srcIndex = Array.from(walkSrc(ROOT)).sort();
  }
  return _srcIndex;
}

/**
 * Resolve a glob to the set of matching files. Pure regex — no filesystem
 * walk needed once `srcIndex()` has populated the cache.
 *
 * `*.regression.test.*` would otherwise accept files like
 * `p0-ice-whitelist.regression.test.ts.bak` from a careless rename, so
 * every match is additionally filtered down to known test suffix variants.
 * The suffix list is the same one Vitest's runner would pick up.
 */
const TEST_SUFFIXES = [".test.ts", ".test.tsx", ".test.mjs"];

/**
 * Resolve a glob to the set of matching files. Pure regex — no filesystem
 * walk needed once `srcIndex()` has populated the cache.
 *
 * `*.regression.test.*` would otherwise accept files like
 * `p0-ice-whitelist.regression.test.ts.bak` from a careless rename, so
 * every match is additionally filtered down to known test suffix variants
 * (kind="test", the default). The suffix list is the same one Vitest's
 * runner would pick up.
 *
 * `kind` opt-out: pass `kind: "source"` to bypass the suffix filter so
 * non-test source files (e.g. `src/utils/syncVersion.ts`) are eligible
 * resolution targets. This is the only way to anchor a file outside the
 * `.test.{ts,tsx,mjs}` family.
 */
function resolveGlob(glob, kind = "test") {
  const re = globToRegex(glob);
  return srcIndex().filter((path) => {
    if (!re.test(path)) return false;
    if (kind === "source") return true;
    return TEST_SUFFIXES.some((suffix) => path.endsWith(suffix));
  });
}

/**
 * Canonical shape for a security-tier regression test that the gate
 * watches. Files matching this pattern but absent from the catalog are
 * surfaced as `discovered` (advisory only) so a reviewer notices when
 * somebody adds e.g. `p5-something.regression.test.ts` without wiring
 * it into ANCHORS[]. Mirrors the prefix used by ADR-026 / ADR-027.
 */
const DISCOVERY_REGEX =
  /^src\/tests\/security\/p[0-9]+-[^/]*\.regression\.test\.(ts|tsx|mjs)$/;

/**
 * Run the anchor check. Returns a structured report so callers (including
 * `scripts/check-audit-drift.mjs`) can aggregate failures and update their
 * own baseline metadata.
 */
export function strictDiscoveryRequested(args = []) {
  return args.includes("--strict") || args.includes("--strict-discovery");
}

export function runAuditAnchors({
  fix = false,
  anchors = ANCHORS,
  strictDiscovery = false,
} = {}) {
  const failures = [];
  const present = [];
  const catalogErrors = validateAnchorCatalog(anchors);
  const malformedIds = new Set();
  for (const error of catalogErrors) {
    malformedIds.add(error.id);
    failures.push({
      type: "malformed-catalog",
      id: error.id,
      glob: error.glob,
      description: error.reason,
    });
  }

  // Open Core export: an anchor's subject may be a proprietary module the
  // export replaces with a placeholder pair, or a Pro-behaviour test the
  // export deliberately does not ship. The subject decision is delegated to
  // the shared Pro policy (scripts/pro-boundary.mjs) — the same policy the
  // exporter and the placeholder generator read — so the gate cannot drift
  // from what the export actually does.
  //
  // The skip only arms in a tree that declares itself an Open Core export
  // (manifest.json with model "open-core" exists only there), so synthetic
  // fake-repo fixtures of this very test file — and the private tree — keep
  // the strict semantics: an anchored file missing from any non-export tree
  // fails exactly as before. A marker guard still backs the policy up inside
  // an export: whatever the glob resolves to there must be a marked
  // placeholder, so an unmarked leftover fails even if the policy names it.
  const isExportTree = (() => {
    try {
      return JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")).model === "open-core";
    } catch {
      return false;
    }
  })();
  const proSkipFor = (anchor) => {
    if (!isExportTree) return null;
    if (!isProSubjectGlob(anchor.glob, anchor.kind)) return null;
    for (const path of resolveGlob(anchor.glob, anchor.kind)) {
      try {
        if (!readFileSync(join(ROOT, path.split("/").join(sep)), "utf8").includes("Open Core placeholder")) {
          return null;
        }
      } catch {
        return null;
      }
    }
    return true;
  };

  for (const anchor of anchors) {
    if (malformedIds.has(anchor.id)) continue;
    const matches = resolveGlob(anchor.glob, anchor.kind);
    if (matches.length === 0) {
      if (proSkipFor(anchor)) {
        // The anchor's subject is replaced by the Pro boundary in this tree.
        // Report as an explicit skip, not a silent pass.
        present.push({ id: anchor.id, matches: [], proBoundarySkip: true });
        continue;
      }
      failures.push({
        id: anchor.id,
        adr: anchor.adr,
        description: anchor.description,
        glob: anchor.glob,
      });
    } else {
      present.push({ id: anchor.id, matches });
    }
  }

  let baseline = {
    totalAnchors: 0,
    missingCount: 0,
    updatedAt: null,
    anchors: [],
  };
  if (existsSync(BASELINE_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
      baseline = parsed && typeof parsed === "object"
        ? parsed
        : { totalAnchors: 0, missingCount: 0, updatedAt: null, anchors: [] };
    } catch {
      // A malformed baseline has no catalog entries; the inflation check below
      // fails closed and `--fix` can rewrite it after the intentional change.
      baseline = {
        totalAnchors: 0,
        missingCount: 0,
        updatedAt: null,
        anchors: [],
      };
    }
  }

  // The baseline is also the review acknowledgement for the catalog. A new
  // ANCHORS[] entry must have the same id + glob recorded there; otherwise a
  // catalog-only change could silently weaken the audit surface.
  const baselineEntries = Array.isArray(baseline.anchors)
    ? baseline.anchors
    : [];
  const baselineById = new Map(
    baselineEntries
      .filter((entry) => entry && typeof entry.id === "string")
      .map((entry) => [entry.id, entry]),
  );
  const catalogInflation = [];
  for (const anchor of anchors) {
    const baselineEntry = baselineById.get(anchor.id);
    if (!baselineEntry) {
      catalogInflation.push({
        id: anchor.id,
        glob: anchor.glob,
        reason: "anchor is present in ANCHORS[] but missing from the baseline catalog",
      });
    } else if (
      baselineEntry.glob !== anchor.glob ||
      (baselineEntry.kind ?? "test") !== (anchor.kind ?? "test")
    ) {
      catalogInflation.push({
        id: anchor.id,
        glob: anchor.glob,
        reason:
          `baseline catalog mismatch (baseline: glob=${baselineEntry.glob ?? "<missing>"}, kind=${baselineEntry.kind ?? "test"}; current: glob=${anchor.glob}, kind=${anchor.kind ?? "test"})`,
      });
    }
  }
  for (const inflation of catalogInflation) {
    failures.push({
      type: "catalog-inflation",
      id: inflation.id,
      glob: inflation.glob,
      description: inflation.reason,
    });
  }

  // Build the set of paths that match an anchored glob so we can subtract
  // them from the canonical-shape enumeration below.
  const anchoredPaths = new Set();
  for (const p of present) {
    for (const m of p.matches) anchoredPaths.add(m);
  }
  // Files that follow the canonical naming convention but are not in the
  // anchor catalog. Advisory only — `failures` is the only thing that
  // exits non-zero, so this never blocks CI by itself.
  const discovered = srcIndex()
    .filter(
      (path) =>
        DISCOVERY_REGEX.test(path) && !anchoredPaths.has(path),
    )
    .sort();
  if (strictDiscovery && discovered.length > 0) {
    failures.push({
      type: "strict-discovery",
      id: "discovered",
      glob: DISCOVERY_REGEX.source,
      description: `${discovered.length} canonical regression file(s) are not covered by an anchor`,
      matches: discovered,
    });
  }

  if (fix) {
    const missingCount = failures.filter((failure) => !failure.type).length;
    const next = {
      totalAnchors: anchors.length,
      missingCount,
      presentCount: present.length,
      discoveredCount: discovered.length,
      updatedAt: new Date().toISOString(),
      anchors: anchors.map((a) => ({
        id: a.id,
        adr: a.adr,
        glob: a.glob,
        ...(a.kind ? { kind: a.kind } : {}),
      })),
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(
      `[audit-anchors] baseline refreshed: ${present.length} present, ${failures.length} failure(s), ${discovered.length} discovered, ${anchors.length} total`,
    );
  }

  return {
    failures,
    present,
    discovered,
    baseline,
    catalogErrors,
    catalogInflation,
    strictDiscovery,
    total: anchors.length,
  };
}

/** Print the anchor catalog — useful from `--list`. */
function printCatalog() {
  for (const anchor of ANCHORS) {
    const matches = resolveGlob(anchor.glob, anchor.kind);
    const status = matches.length > 0 ? `ok (${matches.length} match)` : "MISSING";
    console.log(`${status.padEnd(20)} ${anchor.id}`);
    console.log(`  glob:        ${anchor.glob}`);
    console.log(`  description: ${anchor.description}`);
    console.log(`  adr:         ${anchor.adr}`);
  }
  // Discovered (advisory) — re-run the gate so the catalog reflects the
  // same set of files `runAuditAnchors` would report. Costs one extra
  // index walk (already cached on `_srcIndex`), so no measurable overhead.
  const anchoredPaths = new Set();
  for (const anchor of ANCHORS) {
    for (const m of resolveGlob(anchor.glob, anchor.kind)) anchoredPaths.add(m);
  }
  const discovered = srcIndex()
    .filter((p) => DISCOVERY_REGEX.test(p) && !anchoredPaths.has(p))
    .sort();
  if (discovered.length > 0) {
    console.log("");
    console.log("Discovered (not yet in anchor catalog):");
    for (const d of discovered) {
      const basename = d.split("/").pop() ?? d;
      console.log(`  NEW ${basename.padEnd(48)}  ${d}`);
    }
  }
}

/**
 * CLI entry point. Kept tiny so the importer (`runAuditAnchors`) stays
 * independent of argv handling.
 */
function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    printCatalog();
    return;
  }

  const asJson = args.includes("--json");
  const fix = args.includes("--fix");
  const strictDiscovery = strictDiscoveryRequested(args);
  const {
    failures,
    present,
    discovered,
    catalogInflation,
    catalogErrors,
    strictDiscovery: appliedStrictDiscovery,
    total,
  } = runAuditAnchors({ fix, strictDiscovery });
  const missingFailures = failures.filter((failure) => !failure.type);

  if (asJson) {
    const payload = {
      total,
      present: present.length,
      missing: missingFailures.length,
      missingAnchors: missingFailures.map((f) => f.id),
      catalogInflation,
      malformedCatalog: catalogErrors,
      strictDiscovery: appliedStrictDiscovery,
      discovered,
      discoveredCount: discovered.length,
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const anchor of present) {
      const matchLabel =
        anchor.matches.length === 1
          ? anchor.matches[0]
          : `${anchor.matches.length} files`;
      console.log(`[audit-anchors] ok ${anchor.id} — ${matchLabel}`);
    }
    for (const failure of failures) {
      if (failure.type === "malformed-catalog") {
        console.error(
          `[audit-anchors] FAIL malformed catalog ${failure.id} — ${failure.description}: ${failure.glob} (fix: correct the ANCHORS[] entry in scripts/audit-anchors.mjs — the baseline is not the problem)`,
        );
      } else if (failure.type === "catalog-inflation") {
        console.error(
          `[audit-anchors] FAIL catalog inflation ${failure.id} — ${failure.description} (fix: once the anchored file(s) exist on disk, regenerate the catalog with node scripts/audit-anchors.mjs --fix)`,
        );
      } else if (failure.type === "strict-discovery") {
        console.error(
          `[audit-anchors] FAIL strict discovery — ${failure.description}: ${failure.matches.join(", ")} (fix: add the anchor to ANCHORS[] in scripts/audit-anchors.mjs and regenerate with node scripts/audit-anchors.mjs --fix)`,
        );
      } else {
        console.error(
          `[audit-anchors] FAIL ${failure.id} (${failure.adr}) — no file matches ${failure.glob} (${failure.description}) (fix: restore the anchored file or correct the glob — removing/renaming an anchored test is an ADR-level change; afterwards regenerate with node scripts/audit-anchors.mjs --fix)`,
        );
      }
    }
    for (const d of discovered) {
      const basename = d.split("/").pop() ?? d;
      console.log(
        `[audit-anchors] NEW ${basename} discovered — not yet anchored (add to ANCHORS[] to formalize)`,
      );
    }
    const discoveryPolicy = strictDiscovery ? "strict" : "advisory";
    console.log(
      `[audit-anchors] totals: ${present.length}/${total} present, ${failures.length} missing, ${discovered.length} discovered (${discoveryPolicy})`,
    );
  }

  if (failures.length > 0) {
    process.exit(1);
  }
}

// Only run main when invoked directly (so `runAuditAnchors` is reusable).
// `import.meta.url` is a file:// URL; on Windows the URI escapes the
// backslashes. We compare on the basename, which is path-portable.
function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  const entryBase = entry.split(/[\\/]/).pop();
  const moduleBase = import.meta.url.split("/").pop();
  return entryBase === moduleBase;
}

if (isDirectInvocation()) {
  try {
    main();
  } catch (error) {
    console.error(
      `[audit-anchors] FATAL: ${error?.message ?? String(error)}`,
    );
    process.exit(2);
  }
}
