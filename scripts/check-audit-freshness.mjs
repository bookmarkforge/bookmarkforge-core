#!/usr/bin/env node
/**
 * scripts/check-audit-freshness.mjs — ADR-064.
 *
 * `docs/audit.md` publishes a "Estado verificado" table of the form
 * "command → observable". The document's own rule is that every claim carries
 * the command that backs it — but nothing re-ran the table, so the ledger
 * drifted from the tree while every gate stayed green: the typecheck row
 * described 3 errors in 2 files while the tree had 14 in 3 loci, and the
 * chain-size claim ("~97 gates") described the scripts declared in
 * package.json instead of the gates the chain actually runs. This gate
 * re-executes the table.
 *
 * Modes — declared per row in the `Modo` column, so the document cannot dodge
 * verification by omitting a column:
 *
 *   chain   — the command is a script in the `npm run check` chain. The gate
 *             asserts it exists in package.json and appears in the chain; the
 *             chain's own green is the execution. No second process.
 *   exec    — the gate runs it now and compares the exit code plus every
 *             backticked fragment of the observable against the real output.
 *   deep    — as exec, but only under --deep: too heavy to run inside every
 *             `npm run check` (typecheck, launch checklist). CI's named step
 *             `npm run check:audit-freshness:deep -- --allow-network` is where
 *             they are enforced.
 *   network — as exec, but only under --allow-network (npm audit reaches the
 *             registry). The chain is offline by contract.
 *   self    — the command contains this gate (or is the suite that runs its
 *             test), so re-running it from here is recursive. The gate instead
 *             DERIVES from the tree the number the cell publishes:
 *               `npm run check`     → gate tokens in the `check` chain
 *               `npm run test:fast` → files the fast profile schedules
 *             (scripts/test-files.mjs is the single owner of that walk).
 *
 * Fail-closed rules — the gate fails, never skips, when: the table is missing
 * or empty; a row lacks the Modo column or carries an unknown mode; a command
 * is neither `npm run <script>` nor `node scripts/<file>.mjs`; an npm script
 * does not exist; a `chain` row names a script outside the chain; a `self`
 * command has no derivation registered here or publishes a number that is not
 * exactly the derived one; an exit claim is an inequality (`exit != 0`)
 * instead of a pinned `exit N`; or any documented exit code disagrees with the
 * real one.
 *
 * Export safety: the public export re-curates `docs/` and does not ship this
 * ledger, while it DOES ship `npm run check` unmodified. A missing audit doc
 * therefore fails in the private tree (identified by the private
 * docs/docs-state-index.md) and is reported as "not shipped" in the export.
 *
 * Usage:
 *   node scripts/check-audit-freshness.mjs                    # chain-safe
 *   node scripts/check-audit-freshness.mjs --deep --allow-network
 *   node scripts/check-audit-freshness.mjs --json
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import process from "node:process";
// `fileURLToPath` decodes the percent-encoding `import.meta.url` carries, so
// the CLI guard below matches even when the checkout lives under a path with
// spaces (D:\Nueva carpeta\...) — a bare string comparison silently skips
// main() there and the gate exits 0 as a no-op.
import { fileURLToPath } from "node:url";

// The chain walk (transitive, leaves only) has a single owner: the freeze gate
// that polices which gates the chain is allowed to run. Re-exported here
// because this gate derives the chain size published in docs/audit.md.
import { chainGateTokens } from "./check-inspector-freeze.mjs";
import { fastProfileFiles } from "./test-files.mjs";

export { chainGateTokens };

export const AUDIT_DOC = "docs/audit.md";
/** Private-only document: its presence means this tree is the private one. */
const PRIVATE_TREE_MARKER = join("docs", "docs-state-index.md");
const VALID_MODES = new Set(["chain", "exec", "deep", "network", "self"]);
const SECTION_RE = /^##\s+Estado verificado/;
const HEADER_RE = /^\|\s*Comando\s*\|\s*Modo\s*\|/;
/**
 * Derivations for `self` rows. A `self` command that is not registered here
 * fails the gate: there is no honest way to verify it from inside itself, and
 * silently skipping is the failure mode this gate exists to remove.
 */
export function selfDerivation(command, { packageJson, root }) {
  if (command === "npm run check") {
    return {
      value: chainGateTokens(packageJson).length,
      label: "gate token(s) in the `check` chain",
    };
  }
  if (command === "npm run test:fast") {
    return {
      value: fastProfileFiles(root).length,
      label: "test file(s) in the fast profile",
    };
  }
  return null;
}

/**
 * What the `npm run check` row publishes: the gates the chain runs, derived
 * from package.json — never the number written in the document (ADR-064).
 */

/**
 * Parse the "Estado verificado" table. Returns rows plus structural errors;
 * a document that cannot be parsed is a failure, never a silent no-op.
 */
export function parseAuditStatusTable(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => SECTION_RE.test(line.trim()));
  if (start === -1) {
    return { rows: [], errors: ["no `## Estado verificado` section found"] };
  }
  const rows = [];
  const errors = [];
  let inTable = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!inTable) {
      if (HEADER_RE.test(line)) {
        inTable = true;
        continue;
      }
      if (line.startsWith("## ")) {
        errors.push("`## Estado verificado` has no `| Comando | Modo |` table");
        return { rows: [], errors };
      }
      continue;
    }
    if (/^\|\s*-+/.test(line)) continue; // separator
    if (!line.startsWith("|")) {
      if (line === "") continue;
      break; // end of the table
    }
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3 || cells[1] === "") {
      errors.push(`row without a Modo column: ${line}`);
      continue;
    }
    rows.push({
      command: cells[0].replaceAll("`", "").trim(),
      mode: cells[1].replaceAll("`", "").trim().toLowerCase(),
      observable: cells.slice(2).join(" | "),
    });
  }
  if (!inTable) {
    errors.push("`## Estado verificado` has no `| Comando | Modo |` table");
  }
  if (inTable && rows.length === 0) {
    errors.push("the `## Estado verificado` table has no rows");
  }
  return { rows, errors };
}

function commandKind(command) {
  const npmRun = command.match(/^npm run ([a-z0-9:_-]+)$/);
  if (npmRun) return { type: "npm", name: npmRun[1] };
  const nodeRun = command.match(/^node (scripts\/[A-Za-z0-9_./-]+\.mjs)$/);
  if (nodeRun) return { type: "node", name: nodeRun[1] };
  // `npm audit` with flags is the ledger's registry probe. Deliberately the
  // only npm subcommand accepted: it cannot write, and a row that needs the
  // network must say so (asserted below) instead of hiding it in `exec`.
  if (/^npm audit(?:\s+[A-Za-z0-9@=._/-]+)*$/.test(command)) {
    return { type: "npm-audit", name: "npm audit" };
  }
  return null;
}

/**
 * The documented exit claim: `exit N`, the exact code (0 when the row is
 * silent). A row that compares instead of pinning (`exit != 0`) is refused —
 * the gate verifies exact codes, and an inequality is a claim it cannot check.
 * Anything else fails closed at the call site.
 */
function documentedExit(observable) {
  const exact = observable.match(/\bexit\s+(-?\d+)\b/i);
  if (exact) return { kind: "exact", value: Number(exact[1]) };
  const compared = observable.match(/\bexit\s*(?:!=|\u2260|<>)\s*(-?\d+)\b/);
  if (compared) return { kind: "invalid", text: compared[0] };
  return null;
}

function fragments(observable) {
  return [...observable.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function runCommand(command, root) {
  const result = spawnSync(command, {
    shell: true,
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

/** Verify one parsed row. Returns `{ ok, mode, status, detail }`. */
export function verifyRow(row, { root, packageJson, deep, allowNetwork }) {
  const fail = (detail) => ({ ok: false, status: "fail", detail });
  const pass = (detail) => ({ ok: true, status: "ok", detail });

  if (!VALID_MODES.has(row.mode)) {
    return fail(
      `unknown mode "${row.mode}" (expected ${[...VALID_MODES].join(" | ")})`,
    );
  }
  const kind = commandKind(row.command);
  if (kind === null) {
    return fail(
      "command must be `npm run <script>`, `npm audit [flags]` or " +
        "`node scripts/<file>.mjs` (add a mode that can verify it, or drop " +
        "the row)",
    );
  }
  if (kind.type === "npm-audit" && row.mode !== "network") {
    return fail("`npm audit` reaches the registry: its row must use `network`");
  }
  if (kind.type === "npm" && !Object.hasOwn(packageJson?.scripts ?? {}, kind.name)) {
    return fail(`npm run ${kind.name} is not declared in package.json`);
  }
  if (kind.type === "node" && !existsSync(join(root, kind.name))) {
    return fail(`${kind.name} does not exist`);
  }

  const chainTokens = new Set(chainGateTokens(packageJson));
  const exit = documentedExit(row.observable);
  if (exit?.kind === "invalid") {
    return fail(
      `unsupported exit claim ${JSON.stringify(exit.text)} — pin \`exit N\`: ` +
        "the gate verifies exact codes",
    );
  }

  if (row.mode === "chain") {
    if (kind.type !== "npm") {
      return fail("`chain` rows must name the chain script (`npm run <script>`)");
    }
    if (!chainTokens.has(kind.name)) {
      return fail(`npm run ${kind.name} is not in the \`npm run check\` chain`);
    }
    return pass(`in the check chain (${chainTokens.size} gates)`);
  }

  if (row.mode === "self") {
    if (exit !== null && !(exit.kind === "exact" && exit.value === 0)) {
      return fail("a `self` row cannot document a non-zero exit — it is not run");
    }
    const derived = selfDerivation(row.command, { packageJson, root });
    if (!derived) {
      return fail(
        "no derivation registered for this `self` command — a row that is " +
          "never re-derived is exactly the drift this gate exists to stop",
      );
    }
    // The documented exit code is not a derived number: strip it before
    // counting, so `exit 0 · cadena de 50 gates` publishes exactly one.
    const claim = row.observable.replace(/\bexit\s+-?\d+\b/i, "");
    const numbers = [...claim.matchAll(/\d+/g)].map((match) => Number(match[0]));
    if (numbers.length !== 1) {
      return fail(
        `a \`self\` row must publish exactly one derived number, found ` +
          `${numbers.length} (${numbers.join(", ") || "none"})`,
      );
    }
    if (numbers[0] !== derived.value) {
      return fail(
        `documented ${numbers[0]} but derived ${derived.value} ${derived.label}`,
      );
    }
    return pass(`derived ${derived.value} ${derived.label}`);
  }

  const flagged = { deep, network: allowNetwork };
  if (row.mode === "deep" && !deep) {
    return { ok: true, status: "skip", detail: "needs --deep (CI's named step)" };
  }
  if (row.mode === "network" && !allowNetwork) {
    return { ok: true, status: "skip", detail: "needs --allow-network" };
  }
  if (!flagged[row.mode] && row.mode !== "exec") {
    return fail(`mode "${row.mode}" has no execution path`);
  }

  const expectedExit = exit?.kind === "exact" ? exit.value : 0;
  const result = runCommand(row.command, root);
  if (result.status !== expectedExit) {
    return fail(
      `exit ${result.status}, documented ${expectedExit}` +
        `\n--- output tail ---\n${result.output.trim().split(/\r?\n/).slice(-8).join("\n")}`,
    );
  }
  const verdict = checkObservable({
    observable: row.observable,
    output: result.output,
    status: result.status,
  });
  return verdict.ok ? pass(verdict.detail) : fail(verdict.detail);
}

/**
 * The pure verification seam: compare a command's real output against its
 * row's observable. Exported so the contract tests can exercise the rule
 * (every backticked fragment must appear) without spawning a process per
 * case — the CLI wiring is covered separately.
 */
export function checkObservable({ observable, output, status }) {
  const normalized = normalize(output);
  for (const fragment of fragments(observable)) {
    if (!normalized.includes(normalize(fragment))) {
      return {
        ok: false,
        detail:
          `observable fragment not in the output: ${JSON.stringify(fragment)}` +
          `\n--- output tail ---\n${output.trim().split(/\r?\n/).slice(-8).join("\n")}`,
      };
    }
  }
  return { ok: true, detail: `exit ${status}` };
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const deep = argv.includes("--deep");
  const allowNetwork = argv.includes("--allow-network");
  const root = resolve(process.env.BMF_AUDIT_FRESHNESS_ROOT ?? process.cwd());
  const docPath = join(root, AUDIT_DOC);

  if (!existsSync(docPath)) {
    const privateTree = existsSync(join(root, PRIVATE_TREE_MARKER));
    if (privateTree) {
      console.error(
        `[check:audit-freshness] FAIL ${AUDIT_DOC} is missing from the private ` +
          "tree (the ledger is versioned here; ADR-064)",
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `[check:audit-freshness] ok: ${AUDIT_DOC} is not shipped in this tree ` +
        "(the public export re-curates docs/) — nothing to verify",
    );
    return;
  }

  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const { rows, errors } = parseAuditStatusTable(readFileSync(docPath, "utf8"));
  // A missing chain only matters if a row depends on it: a table of `exec`
  // rows in a fixture-like tree is still fully verifiable.
  const needsChain = rows.some((row) => row.mode === "chain" || row.mode === "self");
  if (needsChain && typeof packageJson?.scripts?.check !== "string") {
    errors.push(
      "package.json declares no `npm run check` chain — the table's `chain` " +
        "and `self` rows cannot be verified against anything",
    );
  }
  const results = rows.map((row) => ({
    ...row,
    ...verifyRow(row, { root, packageJson, deep, allowNetwork }),
  }));
  const failures = [
    ...errors,
    ...results.filter((result) => !result.ok).map((result) => `${result.command}: ${result.detail}`),
  ];
  const skipped = results.filter((result) => result.status === "skip");

  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: failures.length === 0,
          root,
          deep,
          allowNetwork,
          counts: {
            rows: rows.length,
            ok: results.filter((result) => result.status === "ok").length,
            skipped: skipped.length,
            failed: failures.length,
          },
          results,
          failures,
        },
        null,
        2,
      ),
    );
  } else {
    for (const result of results) {
      const label =
        result.status === "ok" ? "ok  " : result.status === "skip" ? "SKIP" : "FAIL";
      console.log(
        `[check:audit-freshness] ${label} ${result.command} (${result.mode}) — ${result.detail}`,
      );
    }
    for (const error of errors) {
      console.error(`[check:audit-freshness] FAIL ${error}`);
    }
    if (failures.length > 0) {
      for (const failure of results.filter((result) => !result.ok)) {
        console.error(`[check:audit-freshness] FAIL ${failure.command}: ${failure.detail}`);
      }
    }
    const modes = [...new Set(results.map((result) => result.mode))].join(" · ");
    console.log(
      `[check:audit-freshness] ${results.length} row(s): ` +
        `${results.filter((r) => r.status === "ok").length} verified` +
        `${skipped.length > 0 ? `, ${skipped.length} skipped (${[...new Set(skipped.map((s) => s.mode))].join(", ")})` : ""}` +
        `${failures.length > 0 ? `, ${failures.length} failed` : ""} [${modes}]`,
    );
  }
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
