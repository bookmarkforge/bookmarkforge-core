/**
 * Unit tests for scripts/check-chunk-boundaries.mjs
 *
 * Each test builds a synthetic dist/ in a temp directory, runs the gate
 * script as a subprocess with the temp dir as cwd, and asserts on exit
 * code + output.  All real filesystem work is confined to os.tmpdir().
 *
 * Default synthetic dist passes ALL seven invariants.  Individual tests
 * override specific aspects to trigger targeted failures.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCRIPTS_DIR = join(import.meta.dirname, "..", "..", "..", "scripts");
const GATE = join(SCRIPTS_DIR, "check-chunk-boundaries.mjs");

/** Write a synthetic JS chunk whose static imports match the gate regex. */
function writeChunk(
  assetsDir: string,
  name: string,
  imports: string[] = [],
  extraContent = "",
  forcedBytes = 0,
) {
  let code = "";
  for (const imp of imports) {
    code += `import"./${imp}";\n`;
  }
  code += extraContent;
  if (forcedBytes > Buffer.byteLength(code, "utf8")) {
    const pad = forcedBytes - Buffer.byteLength(code, "utf8") - 6;
    code += "/*" + "x".repeat(Math.max(0, pad)) + "*/";
  }
  writeFileSync(join(assetsDir, name), code, "utf8");
}

/** Run the gate with given args and optional env, in a specific cwd. */
function runGate(
  cwd: string,
  args: string[] = [],
  env: Record<string, string> = {},
) {
  return spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 15_000,
  });
}

// ---- Synthetic dist builder -------------------------------------------------

interface DistConfig {
  /** Static imports for entry (index-X.js). Must produce ≥10 chunk closure. */
  entryImports?: string[];
  /** Forced byte size of the entry chunk. */
  entryBytes?: number;
  /** Extra chunks to create (name → {imports, content, bytes}). */
  extraChunks?: Record<string, { imports?: string[]; content?: string; bytes?: number }>;
  /** sw.js content (null = don't create sw.js). Default: 55-entry valid precache. */
  swContent?: string | null;
  /** Set false to omit the default ui-vendor.js (lucide marker). Default true. */
  includeUiVendor?: boolean;
  /** Set false to omit the default React dispatcher chunk. Default true. */
  includeReact?: boolean;
  /** Set false to omit the default lazy blocknote/recharts chunks (inv 6). Default true. */
  includeLazyVendors?: boolean;
  /** Set false to omit the default 55 precache asset files. Default true. */
  includePrecacheAssets?: boolean;
  /** Entry imports override: if set, replaces the 9 auto-generated chain deps. */
  _entryImportList?: string[];
}

const DEFAULT_CONFIG: Required<Omit<DistConfig, "_entryImportList">> = {
  entryImports: [] as string[],
  entryBytes: 0,
  extraChunks: {},
  swContent: "__DEFAULT__",
  includeUiVendor: true,
  includeReact: true,
  includeLazyVendors: true,
  includePrecacheAssets: true,
};

/**
 * Build a complete synthetic dist/ that PASSES all 7 invariants by default.
 * Tests override specific config fields to trigger targeted failures.
 */
function buildSyntheticDist(baseDir: string, cfg: DistConfig = {}) {
  const c = { ...DEFAULT_CONFIG, ...cfg };
  const assets = join(baseDir, "dist", "assets");
  mkdirSync(assets, { recursive: true });

  const created = new Set<string>();

  // --- Determine entry imports (sanity guard needs ≥10 chunks in closure) ---
  const entryImports = c._entryImportList ?? (() => {
    const list: string[] = [];
    for (let i = 1; i <= 9; i++) list.push(`chain-${i}.js`);
    return list;
  })();

  // --- Entry chunk ---
  writeChunk(assets, "index-X.js", entryImports, "/* entry */", c.entryBytes);
  created.add("index-X.js");
  for (const imp of entryImports) created.add(imp);

  // --- Protected roots ---
  writeChunk(assets, "SecurityManager-A.js", ["sm-dep.js"], "/* security manager */", 0);
  created.add("SecurityManager-A.js");
  created.add("sm-dep.js");
  writeChunk(assets, "sm-dep.js", [], "/* sm dep */", 0);

  writeChunk(assets, "SecurityConfirmation-B.js", ["sc-dep.js"], "/* security confirmation */", 0);
  created.add("SecurityConfirmation-B.js");
  created.add("sc-dep.js");
  writeChunk(assets, "sc-dep.js", [], "/* sc dep */", 0);

  writeChunk(assets, "MainApp-M.js", ["ma-dep.js"], "/* main app */", 0);
  created.add("MainApp-M.js");
  created.add("ma-dep.js");
  writeChunk(assets, "ma-dep.js", [], "/* ma dep */", 0);

  // --- Default ui-vendor (passes invariant 1) ---
  if (c.includeUiVendor) {
    writeChunk(assets, "ui-vendor.js", [], "function createLucideIcon(){/* lucide icon factory */}", 0);
    created.add("ui-vendor.js");
  }

  // --- Default React dispatcher on chain-1 (passes invariant 3) ---
  if (c.includeReact) {
    writeChunk(assets, "chain-1.js", [], "function useX(){readContext:XxXxXx,use:()=>{}}", 0);
    created.add("chain-1.js");
  }

  // --- Default lazy vendors within invariant-6 caps (lazy, not imported) ---
  if (c.includeLazyVendors) {
    writeChunk(
      assets,
      "blocknote-mantine.js",
      [],
      "/* ProseMirror-widget editor core */",
      750 * 1024, // < 887K cap
    );
    created.add("blocknote-mantine.js");
    writeChunk(
      assets,
      "CategoricalChart.js",
      [],
      "/* setLegendSize reducer */",
      285 * 1024, // < 337K cap
    );
    created.add("CategoricalChart.js");
  }

  // --- Extra chunks ---
  for (const [name, opts] of Object.entries(c.extraChunks)) {
    writeChunk(assets, name, opts.imports ?? [], opts.content ?? "", opts.bytes ?? 0);
    created.add(name);
    for (const imp of opts.imports ?? []) created.add(imp);
  }

  // --- Stub any import that wasn't explicitly created ---
  for (const name of created) {
    const p = join(assets, name);
    if (!existsSync(p)) {
      writeFileSync(p, "/* auto stub */", "utf8");
    }
  }

  // --- sw.js ---
  const swContent = c.swContent === "__DEFAULT__" ? buildSwPrecache(55) : c.swContent;
  if (swContent !== null) {
    writeFileSync(join(baseDir, "dist", "sw.js"), swContent, "utf8");
  }

  // --- Precache asset files (for invariant 4 statSync) ---
  if (c.includePrecacheAssets && swContent !== null) {
    for (let i = 0; i < 55; i++) {
      writeFileSync(join(assets, `asset-${i}.js`), "/* precached */", "utf8");
    }
  }
}

function buildSwPrecache(count: number, extraUrls: string[] = []): string {
  const entries: string[] = [];
  for (let i = 0; i < count; i++) {
    entries.push(`{url:"assets/asset-${i}.js",revision:"v${i}"}`);
  }
  for (const u of extraUrls) {
    entries.push(`{url:"${u}",revision:"v1"}`);
  }
  return `self.__WB_MANIFEST;precacheAndRoute([${entries.join(",")}],{cleanURLs:false});`;
}

// ---- Shared temp root ------------------------------------------------------

const TMP = join(tmpdir(), "bmf-gate-test-" + Date.now());

beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* INTENTIONAL SILENCE: test cleanup is best-effort. */
  }
});

function tempDir(label: string) {
  const d = join(TMP, label);
  mkdirSync(d, { recursive: true });
  return d;
}

function fsRead(p: string): string {
  return readFileSync(p, "utf8");
}

// ===========================================================================
// Tests
// ===========================================================================

describe("check-chunk-boundaries", () => {
  // -----------------------------------------------------------------------
  // SKIP / --require-dist
  // -----------------------------------------------------------------------
  it("SKIPs with exit 0 when dist/assets is missing", () => {
    const d = tempDir("skip");
    const r = runGate(d);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("SKIP");
  });

  it("fails with exit 1 when --require-dist and dist/assets is missing", () => {
    const d = tempDir("require-dist");
    const r = runGate(d, ["--require-dist"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FAIL");
  });

  // -----------------------------------------------------------------------
  // --json mode
  // -----------------------------------------------------------------------
  it("emits valid JSON with all invariants when --json is passed (PASS)", () => {
    const d = tempDir("json-pass");
    buildSyntheticDist(d);
    const r = runGate(d, ["--json"]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json.tool).toBe("check-chunk-boundaries");
    expect(json.status).toBe("pass");
    expect(json.invariants.length).toBe(7);
    expect(json.invariants[0].id).toBe(1);
    expect(json.invariants[0].status).toBe("pass");
    expect(json.invariants[1].id).toBe(2);
    expect(json.invariants[2].id).toBe(3);
    // Gate reports ort-wasm (id 7) before the final precache summary (id 4)
    expect(json.invariants[3].id).toBe(7);
    expect(json.invariants[4].id).toBe(4);
    expect(json.invariants[5].id).toBe(5);
    expect(json.invariants[6].id).toBe(6);
    expect(json.metrics).toHaveProperty("entryMB");
    expect(json.metrics).toHaveProperty("reactRuntimeChunks");
    expect(json.metrics).toHaveProperty("precacheEntries");
    expect(json.metrics).toHaveProperty("ortWasmMB");
  });

  it("emits valid JSON when --json and gate fails", () => {
    const d = tempDir("json-fail");
    // Deliberately broken: entry closure < 10 (sanity guard fires at inv1)
    buildSyntheticDist(d, { _entryImportList: [], includeUiVendor: false, includeReact: false, swContent: null, includePrecacheAssets: false });
    const r = runGate(d, ["--json"]);
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout);
    expect(json.status).toBe("fail");
    expect(json.errors.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // GITHUB_STEP_SUMMARY
  // -----------------------------------------------------------------------
  it("writes markdown summary when GITHUB_STEP_SUMMARY env is set", () => {
    const d = tempDir("summary");
    const summaryFile = join(d, "step-summary.md");
    buildSyntheticDist(d);
    const r = runGate(d, [], { GITHUB_STEP_SUMMARY: summaryFile });
    expect(r.status).toBe(0);
    expect(existsSync(summaryFile)).toBe(true);
    const summary = fsRead(summaryFile);
    expect(summary).toContain("P60 chunk-boundary gate");
    expect(summary).toContain("✅");
    expect(summary).toContain("no ui-runtime");
    expect(summary).toContain("single runtime");
    expect(summary).toContain("precache");
  });

  // -----------------------------------------------------------------------
  // Invariant 1 — ui-runtime leak
  // -----------------------------------------------------------------------
  describe("invariant 1 — ui-runtime isolation", () => {
    it("passes when ui-runtime chunk is not imported by any protected root", () => {
      const d = tempDir("inv1-pass");
      buildSyntheticDist(d);
      const r = runGate(d, ["--json"]);
      const json = JSON.parse(r.stdout);
      const inv1 = json.invariants.find((i: any) => i.id === 1);
      expect(inv1!.status).toBe("pass");
    });

    it("fails when no ui-runtime chunk exists at all (fail-closed)", () => {
      const d = tempDir("inv1-fail-none");
      buildSyntheticDist(d, { includeUiVendor: false, includeReact: false, swContent: null, includePrecacheAssets: false });
      const r = runGate(d, ["--json"]);
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout);
      const inv1 = json.invariants.find((i: any) => i.id === 1);
      expect(inv1!.status).toBe("fail");
    });

    it("fails when ui-runtime chunk leaks into the entry chain", () => {
      const d = tempDir("inv1-fail-leak");
      buildSyntheticDist(d, {
        extraChunks: {
          "chain-1.js": {
            imports: ["ui-vendor.js"],
            content: "/* chain that leaks ui-runtime */",
          },
        },
        includeReact: true,
      });
      const r = runGate(d, ["--json"]);
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout);
      const inv1 = json.invariants.find((i: any) => i.id === 1);
      expect(inv1!.status).toBe("fail");
    });
  });

  // -----------------------------------------------------------------------
  // Invariant 2 — size budgets
  // -----------------------------------------------------------------------
  describe("invariant 2 — eager chain budgets", () => {
    it("passes when all chains are within budget", () => {
      const d = tempDir("inv2-pass");
      buildSyntheticDist(d);
      const r = runGate(d, ["--json"]);
      const json = JSON.parse(r.stdout);
      const inv2 = json.invariants.find((i: any) => i.id === 2);
      expect(inv2!.status).toBe("pass");
    });

    it("fails when entry chain exceeds budget", () => {
      const d = tempDir("inv2-fail");
      buildSyntheticDist(d, {
        entryBytes: 1024 * 1024, // 1 MB
        extraChunks: {
          "chain-1.js": { content: "/* big chain dep */", bytes: 600 * 1024 },
        },
        includeReact: false,
      });
      const r = runGate(d, ["--json"]);
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout);
      const inv2 = json.invariants.find((i: any) => i.id === 2);
      expect(inv2!.status).toBe("fail");
    });
  });

  // -----------------------------------------------------------------------
  // Invariant 3 — React dispatcher not duplicated
  // -----------------------------------------------------------------------
  describe("invariant 3 — React runtime uniqueness", () => {
    it("passes when exactly one chunk carries the React dispatcher", () => {
      const d = tempDir("inv3-pass");
      buildSyntheticDist(d);
      const r = runGate(d, ["--json"]);
      const json = JSON.parse(r.stdout);
      const inv3 = json.invariants.find((i: any) => i.id === 3);
      expect(inv3!.status).toBe("pass");
    });

    it("fails when React dispatcher appears in two chunks", () => {
      const d = tempDir("inv3-fail-dup");
      buildSyntheticDist(d, {
        extraChunks: {
          "chain-1.js": { content: "readContext:aaa,use:()=>{}" },
          "chain-2.js": { content: "readContext:bbb,use:()=>{}" },
        },
        includeReact: true,
      });
      const r = runGate(d, ["--json"]);
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout);
      const inv3 = json.invariants.find((i: any) => i.id === 3);
      expect(inv3!.status).toBe("fail");
    });

    it("fails when no chunk carries the React dispatcher (fail-closed)", () => {
      const d = tempDir("inv3-fail-none");
      buildSyntheticDist(d, { includeReact: false });
      const r = runGate(d, ["--json"]);
      expect(r.status).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Invariant 4 — precache heavy vendors
  // -----------------------------------------------------------------------
  describe("invariant 4 — sw.js precache", () => {
    it("passes when precache has no heavy vendor", () => {
      const d = tempDir("inv4-pass");
      buildSyntheticDist(d);
      const r = runGate(d, ["--json"]);
      const json = JSON.parse(r.stdout);
      const inv4 = json.invariants.find((i: any) => i.id === 4);
      expect(inv4!.status).toBe("pass");
    });

    it("fails when precache contains a heavy vendor chunk", () => {
      const d = tempDir("inv4-fail");
      buildSyntheticDist(d, {
        extraChunks: {
          "heavy-editor.js": {
            content: "/* ProseMirror-widget editor core */",
            bytes: 250 * 1024,
          },
        },
        swContent: buildSwPrecache(55, ["assets/heavy-editor.js"]),
      });
      const r = runGate(d, ["--json"]);
      const json = JSON.parse(r.stdout);
      const inv4 = json.invariants.find((i: any) => i.id === 4);
      expect(inv4!.status).toBe("fail");
    });

    it("fails when sw.js has fewer than 50 precache entries (parse broken)", () => {
      const d = tempDir("inv4-too-few");
      buildSyntheticDist(d, { swContent: buildSwPrecache(10), includePrecacheAssets: false });
      const r = runGate(d, ["--json"]);
      expect(r.status).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Invariant 5 — heavy vendors in pre-unlock static chain
  // -----------------------------------------------------------------------
  describe("invariant 5 — pre-unlock heavy vendors", () => {
    it("passes when no blocknote/pdfjs/recharts chunk is statically imported", () => {
      const d = tempDir("inv5-pass");
      buildSyntheticDist(d);
      const r = runGate(d, ["--json"]);
      const json = JSON.parse(r.stdout);
      const inv5 = json.invariants.find((i: any) => i.id === 5);
      expect(inv5!.status).toBe("pass");
    });

    it("fails when blocknote chunk is statically imported by entry", () => {
      const d = tempDir("inv5-fail-blocknote");
      buildSyntheticDist(d, {
        extraChunks: {
          // chain-2.js is part of the default entry closure (keeps the
          // invariant-1 sanity guard ≥10 chunks) and statically pulls the
          // heavy blocknote vendor into the pre-unlock chain.
          "chain-2.js": {
            imports: ["blocknote-editor.js"],
            content: "/* chain that pulls blocknote */",
          },
          "blocknote-editor.js": {
            content: "/* ProseMirror-widget editor core */",
            bytes: 250 * 1024,
          },
        },
      });
      const r = runGate(d, ["--json"]);
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout);
      const inv5 = json.invariants.find((i: any) => i.id === 5);
      expect(inv5!.status).toBe("fail");
    });

    it("fails when recharts chunk is statically imported by SecurityConfirmation", () => {
      const d = tempDir("inv5-fail-recharts");
      buildSyntheticDist(d, {
        extraChunks: {
          "recharts-core.js": {
            content: "/* setLegendSize reducer */",
            bytes: 250 * 1024,
          },
        },
      });
      // Make SecurityConfirmation statically import the recharts chunk.
      writeChunk(join(d, "dist", "assets"), "SecurityConfirmation-B.js", ["recharts-core.js"], "/* sc */", 0);
      const r = runGate(d, ["--json"]);
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout);
      const inv5 = json.invariants.find((i: any) => i.id === 5);
      expect(inv5!.status).toBe("fail");
    });
  });

  // -----------------------------------------------------------------------
  // Invariant 6 — lazy vendor chunk caps
  // -----------------------------------------------------------------------
  describe("invariant 6 — lazy vendor caps", () => {
    it("passes when blocknote/recharts chunks are within caps", () => {
      const d = tempDir("inv6-pass");
      buildSyntheticDist(d);
      const r = runGate(d, ["--json"]);
      const json = JSON.parse(r.stdout);
      const inv6 = json.invariants.find((i: any) => i.id === 6);
      expect(inv6!.status).toBe("pass");
    });

    it("fails when the blocknote chunk grows beyond its cap", () => {
      const d = tempDir("inv6-fail-blocknote");
      buildSyntheticDist(d, {
        extraChunks: {
          // Overrides the default blocknote chunk (same marker, larger size).
          "blocknote-mantine.js": {
            content: "/* ProseMirror-widget editor core */",
            bytes: 900 * 1024, // > 887K cap
          },
        },
      });
      const r = runGate(d, ["--json"]);
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout);
      const inv6 = json.invariants.find((i: any) => i.id === 6);
      expect(inv6!.status).toBe("fail");
    });

    it("fails when the recharts chunk grows beyond its cap", () => {
      const d = tempDir("inv6-fail-recharts");
      buildSyntheticDist(d, {
        extraChunks: {
          "CategoricalChart.js": {
            content: "/* setLegendSize reducer */",
            bytes: 350 * 1024, // > 337K cap
          },
        },
      });
      const r = runGate(d, ["--json"]);
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout);
      const inv6 = json.invariants.find((i: any) => i.id === 6);
      expect(inv6!.status).toBe("fail");
    });

    it("fails when a capped vendor chunk is missing (fail-closed)", () => {
      const d = tempDir("inv6-fail-missing");
      buildSyntheticDist(d, { includeLazyVendors: false });
      const r = runGate(d, ["--json"]);
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout);
      const inv6 = json.invariants.find((i: any) => i.id === 6);
      expect(inv6!.status).toBe("fail");
    });
  });

  // -----------------------------------------------------------------------
  // Full PASS — all 7 invariants green
  // -----------------------------------------------------------------------
  it("exits 0 when all 7 invariants hold", () => {
    const d = tempDir("full-pass");
    buildSyntheticDist(d);
    const r = runGate(d);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("all invariants hold");
  });

  // -----------------------------------------------------------------------
  // Missing key files (fail-closed)
  // -----------------------------------------------------------------------
  it("fails when entry chunk is missing (no index-*.js)", () => {
    const d = tempDir("no-entry");
    const assets = join(d, "dist", "assets");
    mkdirSync(assets, { recursive: true });
    writeChunk(assets, "SecurityManager-A.js", [], "/* sm */", 0);
    writeChunk(assets, "SecurityConfirmation-B.js", [], "/* sc */", 0);
    writeChunk(assets, "MainApp-M.js", [], "/* ma */", 0);
    const r = runGate(d, ["--json"]);
    expect(r.status).toBe(1);
  });
});
