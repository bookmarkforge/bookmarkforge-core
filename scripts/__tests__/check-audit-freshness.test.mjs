// @vitest-environment node
/**
 * Contract tests for scripts/check-audit-freshness.mjs (ADR-064).
 *
 * The gate exists because nothing re-ran docs/audit.md's status table: the
 * typecheck row described a different error census and the chain-size claim
 * counted the wrong gates while the whole chain stayed green. So these tests
 * are as much about the gate's *refusal* properties as its happy path: an
 * unparseable table, an unknown mode, a `self` row whose number the tree
 * contradicts, an exit claim written as an inequality, or a missing ledger in
 * the private tree must all fail — a gate that passes for the wrong reason is
 * the failure mode it was written to end.
 *
 * Most rules are exercised through the pure seam (`checkObservable`,
 * `verifyRow`) and only the CLI wiring spawns processes:
 * this file runs in the fast profile, where a new file at/over 5 s fails the
 * timing guard, and a `npm run` spawn on Windows costs ~1 s on its own.
 *
 * Fixtures are synthetic roots under the OS temp dir (the gate takes
 * BMF_AUDIT_FRESHNESS_ROOT). Every fixture root needs `src/tests/security/`
 * and `scripts/__tests__/` to exist because scripts/test-profiles.mjs walks
 * them at import time when it builds the profile selectors.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  chainGateTokens,
  checkObservable,
  parseAuditStatusTable,
  selfDerivation,
  verifyRow,
} from "../check-audit-freshness.mjs";

const REPO_ROOT = process.cwd();
const GATE = join(REPO_ROOT, "scripts", "check-audit-freshness.mjs");
const realDoc = readFileSync(join(REPO_ROOT, "docs", "audit.md"), "utf8");
const realPackageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const noFlags = { deep: false, allowNetwork: false };

const tempRoots = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot({ doc = null, scripts = {}, privateTree = false, files = {} }) {
  const root = mkdtempSync(join(tmpdir(), "audit-freshness-"));
  tempRoots.push(root);
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "scripts", "__tests__"), { recursive: true });
  mkdirSync(join(root, "src", "tests", "security"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", scripts }, null, 2),
  );
  if (typeof doc === "string") {
    writeFileSync(join(root, "docs", "audit.md"), doc);
  }
  if (privateTree) {
    writeFileSync(join(root, "docs", "docs-state-index.md"), "| Documento | Estado | Nota |\n");
  }
  for (const [path, content] of Object.entries(files)) {
    writeFileSync(join(root, path), content);
  }
  return root;
}

function runGate(root, ...args) {
  return spawnSync(process.execPath, [GATE, ...args], {
    cwd: root,
    env: { ...process.env, BMF_AUDIT_FRESHNESS_ROOT: root, NO_COLOR: "1" },
    encoding: "utf8",
  });
}

const statusDoc = (rows) =>
  [
    "# Auditoría técnica",
    "",
    "## Estado verificado (2026-09-23)",
    "",
    "| Comando | Modo | Observable esperado |",
    "|---|---|---|",
    ...rows,
    "",
    "## Siguiente sección",
    "",
  ].join("\n");

describe("parseAuditStatusTable", () => {
  it("parses command, mode and observable of every row", () => {
    const { rows, errors } = parseAuditStatusTable(
      statusDoc(["| `npm run lint` | `chain` | exit 0 |"]),
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ command: "npm run lint", mode: "chain", observable: "exit 0" }]);
  });

  it("fails closed when the section or its table is missing", () => {
    const noSection = parseAuditStatusTable("# Ledger\n\nno table here\n");
    expect(noSection.rows).toEqual([]);
    expect(noSection.errors[0]).toContain("Estado verificado");

    const noTable = parseAuditStatusTable(
      "## Estado verificado (2026-09-23)\n\n| Comando | Observable |\n|---|---|\n",
    );
    expect(noTable.errors[0]).toContain("| Comando | Modo |");
  });

  it("rejects a row without a Modo column, and an empty table", () => {
    const { rows, errors } = parseAuditStatusTable(statusDoc(["| `npm run lint` | | exit 0 |"]));
    expect(rows).toEqual([]);
    expect(errors[0]).toContain("Modo column");

    expect(parseAuditStatusTable(statusDoc([])).errors[0]).toContain("no rows");
  });
});

describe("verifyRow fails closed before anything runs", () => {
  const packageJson = { scripts: { check: "npm run check:foo && lint", "check:foo": "node -e 0" } };

  it("chain: passes inside the chain, fails outside it or from a node command", () => {
    const inside = verifyRow(
      { command: "npm run check:foo", mode: "chain", observable: "dentro de la cadena" },
      { root: REPO_ROOT, packageJson, ...noFlags },
    );
    expect(inside.ok).toBe(true);

    const outside = verifyRow(
      { command: "npm run check:bar", mode: "chain", observable: "dentro de la cadena" },
      {
        root: REPO_ROOT,
        packageJson: { scripts: { check: "npm run check:foo && lint", "check:bar": "node -e 0" } },
        ...noFlags,
      },
    );
    expect(outside.detail).toContain("not in the `npm run check` chain");

    const nodeCommand = verifyRow(
      { command: "node scripts/probe.mjs", mode: "chain", observable: "exit 0" },
      { root: makeRoot({ files: { "scripts/probe.mjs": "process.exit(0);\n" } }), packageJson, ...noFlags },
    );
    expect(nodeCommand.detail).toContain("must name the chain script");
  });

  it("rejects unknown modes, unrunnable commands, unknown scripts and audit outside network", () => {
    expect(
      verifyRow({ command: "npm run check:foo", mode: "whatever", observable: "exit 0" }, {
        root: REPO_ROOT,
        packageJson,
        ...noFlags,
      }).detail,
    ).toContain("unknown mode");
    expect(
      verifyRow({ command: "bash -c true", mode: "exec", observable: "exit 0" }, {
        root: REPO_ROOT,
        packageJson,
        ...noFlags,
      }).detail,
    ).toContain("must be `npm run <script>`");
    expect(
      verifyRow({ command: "npm run check:ghost", mode: "exec", observable: "exit 0" }, {
        root: REPO_ROOT,
        packageJson,
        ...noFlags,
      }).detail,
    ).toContain("not declared in package.json");
    expect(
      verifyRow({ command: "npm audit --omit=dev", mode: "exec", observable: "exit 0" }, {
        root: REPO_ROOT,
        packageJson,
        ...noFlags,
      }).detail,
    ).toContain("its row must use `network`");
  });

  it("headless modes: deep and network are skipped, never silently executed", () => {
    const deepRow = { command: "npm run check:foo", mode: "deep", observable: "exit 0" };
    expect(verifyRow(deepRow, { root: REPO_ROOT, packageJson, ...noFlags }).status).toBe("skip");
    const networkRow = { command: "npm audit --omit=dev", mode: "network", observable: "exit 0" };
    expect(verifyRow(networkRow, { root: REPO_ROOT, packageJson, ...noFlags }).status).toBe("skip");
  });
});

describe("exec rows: exit code and observable fragments", () => {
  const fixture = (rows) =>
    makeRoot({
      scripts: {},
      doc: statusDoc(rows),
      files: {
        "scripts/ok.mjs": 'console.log("fixture probe ok");\n',
        "scripts/bad.mjs": 'console.error("fixture probe bad");\nprocess.exit(3);\n',
      },
    });

  it("accepts a matching row and rejects a mismatched exit code or fragment", () => {
    // One run, three verdicts: each case is a row of the same table, so the
    // per-row status comes from --json instead of three process spawns.
    const root = fixture([
      "| `node scripts/ok.mjs` | `exec` | exit 0 · `fixture probe ok` |",
      "| `node scripts/ok.mjs` | `exec` | exit 2 · `fixture probe ok` |",
      "| `node scripts/ok.mjs` | `exec` | `something else` |",
    ]);
    const run = JSON.parse(runGate(root, "--json").stdout);
    expect(run.results[0].status).toBe("ok");
    expect(run.results[1].detail).toContain("exit 0, documented 2");
    expect(run.results[2].detail).toContain("observable fragment not in the output");
    expect(run.ok).toBe(false);
  });

  it("executes deep and network rows only with their flags", () => {
    const root = fixture([
      "| `node scripts/ok.mjs` | `exec` | `fixture probe ok` |",
      "| `node scripts/bad.mjs` | `deep` | **exit 3** · `fixture probe bad` |",
      "| `node scripts/bad.mjs` | `network` | **exit 3** · `fixture probe bad` |",
    ]);
    const shallow = JSON.parse(runGate(root, "--json").stdout);
    expect(shallow.results.map((row) => row.status)).toEqual(["ok", "skip", "skip"]);

    const deep = JSON.parse(runGate(root, "--deep", "--allow-network", "--json").stdout);
    expect(deep.ok).toBe(true);
    expect(deep.results.map((row) => row.status)).toEqual(["ok", "ok", "ok"]);
  });
});

describe("self rows derive their number instead of trusting the document", () => {
  it("derives the chain size and the fast-profile size, and refuses unregistered ones", () => {
    const packageJson = { scripts: { check: "npm run check:a && npm run check:b && lint" } };
    expect(chainGateTokens(packageJson)).toHaveLength(3);
    expect(selfDerivation("npm run check", { packageJson, root: REPO_ROOT }).value).toBe(3);
    expect(selfDerivation("npm run test:fast", { packageJson, root: REPO_ROOT }).value).toBeGreaterThan(0);
    expect(selfDerivation("npm run lint", { packageJson, root: REPO_ROOT })).toBeNull();
  });

  it("passes only when the published number is exactly the derived one", () => {
    const scripts = { check: "npm run check:a && npm run check:b && lint" };
    expect(
      runGate(
        makeRoot({ scripts, doc: statusDoc(["| `npm run check` | `self` | exit 0 · cadena de 3 gates |"]) }),
      ).status,
    ).toBe(0);

    const staleResult = runGate(
      makeRoot({ scripts, doc: statusDoc(["| `npm run check` | `self` | exit 0 · cadena de 2 gates |"]) }),
    );
    expect(staleResult.status).toBe(1);
    expect(staleResult.stderr).toContain("documented 2 but derived 3");
  });

  it("refuses a self command with no derivation, or a row that publishes zero/many numbers", () => {
    const packageJson = {
      scripts: {
        lint: "eslint .",
        check: "npm run lint",
        "test:fast": "node scripts/test-bounded.mjs --profile fast",
      },
    };
    expect(
      verifyRow({ command: "npm run lint", mode: "self", observable: "exit 0 · 1 comando" }, {
        root: REPO_ROOT,
        packageJson,
        ...noFlags,
      }).detail,
    ).toContain("no derivation registered");
    expect(
      verifyRow({ command: "npm run test:fast", mode: "self", observable: "exit 0 · sin números" }, {
        root: REPO_ROOT,
        packageJson,
        ...noFlags,
      }).detail,
    ).toContain("exactly one derived number");
    expect(
      verifyRow({ command: "npm run test:fast", mode: "self", observable: "exit 0 · 7 y 9" }, {
        root: REPO_ROOT,
        packageJson,
        ...noFlags,
      }).detail,
    ).toContain("exactly one derived number");
  });
});

describe("exit claims are pinned, not compared (the pure seam)", () => {
  it("refuses an inequality instead of reading it as the default exit 0", () => {
    // A row that says `exit ≠ 0` documents no verifiable code. Treating it as
    // the silent default (`exit 0`) would flip a red row green, so it must fail.
    const verdict = verifyRow(
      { command: "npm run lint", mode: "exec", observable: "**exit ≠ 0**" },
      { root: REPO_ROOT, packageJson: { scripts: { lint: "eslint ." } }, ...noFlags },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("unsupported exit claim");
    expect(verdict.detail).toContain("exit N");
  });

  it("matches every backticked fragment of the observable in the output", () => {
    const output = "line one\npattern-abc\ntail";
    expect(checkObservable({ observable: "`pattern-abc`", output, status: 0 }).ok).toBe(true);
    const missing = checkObservable({ observable: "`not-there`", output, status: 0 });
    expect(missing.ok).toBe(false);
    expect(missing.detail).toContain("observable fragment not in the output");
  });

  it("walks a deep row end-to-end through the CLI (wiring)", () => {
    const root = makeRoot({
      scripts: { probe: "node scripts/fake-probe.mjs" },
      doc: statusDoc(["| `npm run probe` | `deep` | exit 1 · `probe reported 1` |"]),
      files: {
        "scripts/fake-probe.mjs": 'console.log("probe reported 1");\nprocess.exit(1);\n',
      },
    });
    const result = runGate(root, "--deep");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

describe("export safety and fail-closed doc handling", () => {
  it("fails when the ledger is missing from the private tree", () => {
    const result = runGate(makeRoot({ privateTree: true }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing from the private tree");
  });

  it("reports 'not shipped' in the public export instead of failing", () => {
    const result = runGate(makeRoot({ privateTree: false }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("not shipped in this tree");
  });
});

describe("the real ledger", () => {
  it("is fresh against the real tree (chain-safe modes)", () => {
    const result = runGate(REPO_ROOT);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/row\(s\): \d+ verified/);
  });

  it("fails when a single number in the real table is stale", () => {
    // The `self` row publishes a derived count (the `check` chain gates). The
    // mutation bumps that number so the gate must detect the drift.
    const mutated = realDoc.replace(/(\d+)-gate chain/, (_match, value) =>
      `${Number(value) + 1}-gate chain`,
    );
    expect(mutated).not.toBe(realDoc);
    const root = makeRoot({ doc: mutated });
    writeFileSync(join(root, "package.json"), JSON.stringify(realPackageJson, null, 2));
    const result = runGate(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("but derived");
  });

  it("keeps the real table parseable, with every row mode registered", () => {
    const { rows, errors } = parseAuditStatusTable(realDoc);
    expect(errors).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      expect(["chain", "exec", "deep", "network", "self"]).toContain(row.mode);
    }
  });

  it("has a checked-in gate script and doc (the wiring this test protects)", () => {
    expect(existsSync(GATE)).toBe(true);
  });
});
