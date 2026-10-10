// @vitest-environment node
/**
 * scripts/__tests__/pro-boundary.test.mjs
 *
 * Tests for the Open Core compile-time boundary (scripts/pro-boundary.mjs), the
 * machinery that lets the MIT export resolve the imports the private Core aims
 * at proprietary modules:
 *   - the Pro path policy, including the placeholder variants the exact-path
 *     form used to miss (a leftover `BackupService.ts` passed the gate),
 *   - specifier resolution (extensionless, explicit `.ts`, Vite dev URLs),
 *   - the in-place rewrite rules, including the line-drop rule — silent
 *     deletion of a source line is the one thing here that can lose code, so it
 *     is pinned: only a line that is *nothing but* a quoted Pro path goes,
 *   - `verifyProBoundary` on synthetic exports: a covered tree passes, and each
 *     way of half-doing the boundary fails closed.
 *
 * Fixture paths are assembled with `pathOf(...)` rather than written out. This
 * file is shipped in the public export and the gate under test scans trees for
 * literal Pro module paths: a fixture that spelled one out would be reported as
 * an uncovered reference by the code it is testing.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLACEHOLDER_MARKER,
  PRO_MODULE_PATHS,
  applyFileRewrites,
  candidatesFor,
  declarationOf,
  isProModulePath,
  placeholderSource,
  resolveProReference,
  runtimeOf,
  splitSpecifier,
  verifyProBoundary,
} from "../pro-boundary.mjs";

/** Build a repo-relative path without ever spelling a Pro path out in source. */
const pathOf = (...parts) => parts.join("/");

// The AI directory itself is Core now (policy: exact Pro file list); build the
// path so fixtures reference sibling files without spelling Pro paths out.
const AI_DIR = pathOf("src", "services", "ai") + "/";
const PRO_MODULE = pathOf("src", "services", "ai", "WebLLMService");
const PRO_BACKUP = PRO_MODULE_PATHS.find((proPath) => proPath.endsWith("BackupService.ts"));
if (!PRO_BACKUP) throw new Error("PRO_MODULE_PATHS no longer declares BackupService.ts — update this test.");

// ── Policy ───────────────────────────────────────────────────────────────────
describe("isProModulePath", () => {
  it("matches every declared implementation and its placeholder variants", () => {
    for (const proPath of PRO_MODULE_PATHS) {
      const base = proPath.replace(/\.tsx?$/, "");
      for (const candidate of [proPath, base, `${base}.d.ts`, `${base}.js`]) {
        expect(isProModulePath(candidate), candidate).toBe(true);
      }
    }
  });

  it("matches exact Pro files but keeps AI-tree siblings Core", () => {
    // The local-model runtime is Pro…
    expect(isProModulePath(`${AI_DIR}WebLLMService.ts`)).toBe(true);
    expect(isProModulePath(`${AI_DIR}WebLLMService.d.ts`)).toBe(true);
    // …while the rest of the AI tree (BYOK cloud, semantic search, the
    // embedding engine) is Core MIT — only the exact list is Pro.
    expect(isProModulePath(`${AI_DIR}RAGEngine.ts`)).toBe(false);
    expect(isProModulePath(`${AI_DIR}providers/OllamaProvider.ts`)).toBe(false);
  });

  it("keeps near-misses out", () => {
    expect(isProModulePath(`${AI_DIR.replace(/\/$/, "-utils")}.ts`)).toBe(false);
    for (const suffix of [".spec.ts", ".test.ts", "Factory.ts"]) {
      expect(isProModulePath(PRO_BACKUP.replace(/\.ts$/, suffix)), suffix).toBe(false);
    }
    expect(isProModulePath(pathOf("server", "src", "entitlement-guard.ts"))).toBe(false);
    expect(isProModulePath(pathOf("docs", "manual-de-usuario-es.md"))).toBe(false);
  });

  it("normalizes Windows separators", () => {
    expect(isProModulePath(`${PRO_MODULE}.ts`.split("/").join("\\"))).toBe(true);
  });
});

// ── Specifiers ───────────────────────────────────────────────────────────────
describe("splitSpecifier / declarationOf / runtimeOf", () => {
  it("separates a query or hash suffix from the path", () => {
    expect(splitSpecifier("../ai/WebLLMService?worker")).toEqual({
      path: "../ai/WebLLMService",
      suffix: "?worker",
    });
    expect(splitSpecifier("../ai/WebLLMService.ts#x")).toEqual({
      path: "../ai/WebLLMService.ts",
      suffix: "#x",
    });
    expect(splitSpecifier("../ai/WebLLMService")).toEqual({
      path: "../ai/WebLLMService",
      suffix: "",
    });
  });

  it("names the placeholder pair for either spelling of a Pro module", () => {
    expect(declarationOf(`${PRO_BACKUP}`)).toBe(`${PRO_BACKUP.replace(/\.ts$/, "")}.d.ts`);
    expect(declarationOf(PRO_BACKUP)).toBe(`${PRO_BACKUP.replace(/\.ts$/, "")}.d.ts`);
    expect(runtimeOf(PRO_BACKUP)).toBe(`${PRO_BACKUP.replace(/\.ts$/, "")}.js`);
  });

  it("offers the bare base, extensions and index files", () => {
    const candidates = candidatesFor(PRO_MODULE);
    expect(candidates[0]).toBe(PRO_MODULE);
    expect(candidates).toContain(`${PRO_MODULE}.ts`);
    expect(candidates).toContain(`${PRO_MODULE}/index.tsx`);
  });
});

describe("resolveProReference", () => {
  const exists = (rel) => [`${PRO_MODULE}.ts`, pathOf("src", "services", "SyncService.ts")].includes(rel);

  it("resolves relative, absolute-style and extensionless specifiers", () => {
    expect(resolveProReference(pathOf("src", "components", "Foo.tsx"), "../services/ai/WebLLMService", exists)).toMatchObject({
      modulePath: `${PRO_MODULE}.ts`,
    });
    expect(resolveProReference(pathOf("src", "workers", "voy.worker.ts"), `/${PRO_MODULE}.ts`, exists)).toMatchObject({
      modulePath: `${PRO_MODULE}.ts`,
    });
  });

  it("ignores package imports and Core modules", () => {
    expect(resolveProReference("src/A.ts", "react", exists)).toBeNull();
    expect(resolveProReference("src/A.ts", "../services/SyncService", exists)).toBeNull();
  });

  it("does not accept a directory as a module", () => {
    // `src/services/ai` is a real directory; a resolver without the isFile()
    // guard treated it as a module and generated a placeholder for it.
    const dirOnly = (rel) => rel === AI_DIR.replace(/\/$/, "");
    expect(resolveProReference("src/A.ts", "../services/ai/providers", dirOnly)).toBeNull();
  });
});

// ── Rewrite rules ────────────────────────────────────────────────────────────
describe("applyFileRewrites", () => {
  const specifiersFor = (importPath, modulePath, pathOnly = false) =>
    new Map([[importPath, { modulePath, suffix: "", pathOnly }]]);

  it("drops the extension so the import reaches the placeholder pair", () => {
    const source = 'import { WebLLMService } from "../services/ai/WebLLMService.ts";\n';
    const specifiers = specifiersFor("../services/ai/WebLLMService.ts", `${PRO_MODULE}.ts`);
    const result = applyFileRewrites(source, specifiers, pathOf("src", "workers", "voy.worker.ts"));
    expect(result.source).toBe('import { WebLLMService } from "../services/ai/WebLLMService";\n');
    expect(result.rewrittenSpecifiers).toBe(1);
  });

  it("keeps a query suffix when dropping the extension", () => {
    const source = 'new Worker(new URL("../services/ai/embedding.worker.ts?worker", import.meta.url));';
    const specifiers = specifiersFor(
      "../services/ai/embedding.worker.ts?worker",
      `${pathOf("src", "services", "ai", "embedding.worker")}.ts`,
    );
    expect(applyFileRewrites(source, specifiers, "src/x.ts").source).toBe(
      'new Worker(new URL("../services/ai/embedding.worker?worker", import.meta.url));',
    );
  });

  it("drops a line that is nothing but a quoted Pro path", () => {
    const source = [
      "      exclude: [",
      '        "src/workers/**",',
      `        "${AI_DIR}embedding.worker.ts",`,
      '        "src/db/__tests__/**",',
      "      ],",
      "",
    ].join("\n");
    const specifiers = specifiersFor(
      `${AI_DIR}embedding.worker.ts`,
      `${AI_DIR}embedding.worker.ts`,
      true,
    );
    const result = applyFileRewrites(source, specifiers, "vitest.config.ts");
    expect(result.source).toBe(
      ["      exclude: [", '        "src/workers/**",', '        "src/db/__tests__/**",', "      ],", ""].join("\n"),
    );
  });

  it("never drops a line that carries code around the quoted path", () => {
    const source = `const target = path.resolve(__dirname, "../../services/WebRTCSyncService.ts");\n`;
    const specifiers = specifiersFor(
      "../../services/WebRTCSyncService.ts",
      pathOf("src", "services", "WebRTCSyncService.ts"),
      true,
    );
    const result = applyFileRewrites(source, specifiers, pathOf("src", "tests", "x.test.ts"));
    expect(result.source).toBe(source);
    expect(result.changed).toBe(false);
  });

  it("leaves unrelated files byte-identical", () => {
    const source = 'import { getDB } from "../db/database";\n';
    const result = applyFileRewrites(source, new Map(), "src/x.ts");
    expect(result.source).toBe(source);
    expect(result.changed).toBe(false);
  });
});

// ── Verification on a synthetic export ───────────────────────────────────────
const dirs = [];
const makeExport = (files) => {
  const root = mkdtempSync(join(tmpdir(), "pro-boundary-"));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const markedDeclaration = `/* ${PLACEHOLDER_MARKER}: generated type surface */\nexport declare class WebLLMService {}\n`;
const markedRuntime = `/** ${PLACEHOLDER_MARKER} */\nexport const WebLLMService = placeholder;\n`;

describe("verifyProBoundary", () => {
  it("accepts a covered export", () => {
    const root = makeExport({
      [`${PRO_MODULE}.d.ts`]: markedDeclaration,
      [`${PRO_MODULE}.js`]: markedRuntime,
      "src/app.ts": 'import { WebLLMService } from "./services/ai/WebLLMService";\n',
    });
    expect(verifyProBoundary(root).violations).toEqual([]);
  });

  it("reports a Pro implementation left in the export", () => {
    const root = makeExport({ [`${PRO_MODULE}.ts`]: "export class WebLLMService {}\n" });
    expect(verifyProBoundary(root).violations.join("\n")).toContain("is a Pro implementation");
  });

  it("reports an import whose placeholder pair is missing", () => {
    const root = makeExport({
      "src/app.ts": 'import { WebLLMService } from "./services/ai/WebLLMService";\n',
    });
    expect(verifyProBoundary(root).violations.join("\n")).toContain("without a placeholder pair");
  });

  it("reports a placeholder that is not marked", () => {
    const root = makeExport({
      [`${PRO_MODULE}.d.ts`]: "export declare class WebLLMService {}\n",
      [`${PRO_MODULE}.js`]: "export const WebLLMService = undefined;\n",
    });
    expect(verifyProBoundary(root).violations.join("\n")).toContain("is not a marked placeholder");
  });

  it("reports an import that keeps an explicit extension", () => {
    const root = makeExport({
      [`${PRO_MODULE}.d.ts`]: markedDeclaration,
      [`${PRO_MODULE}.js`]: markedRuntime,
      "src/worker.ts": 'import { WebLLMService } from "./services/ai/WebLLMService.ts";\n',
    });
    expect(verifyProBoundary(root).violations.join("\n")).toContain("with an explicit extension");
  });

  it("reports a Pro path named outside an import", () => {
    const root = makeExport({
      [`${PRO_MODULE}.d.ts`]: markedDeclaration,
      [`${PRO_MODULE}.js`]: markedRuntime,
      "vitest.config.ts": `export default { test: { exclude: ["${PRO_MODULE}.ts"] } };\n`,
    });
    expect(verifyProBoundary(root).violations.join("\n")).toContain("outside an import");
  });

  it("does not require a marker on ordinary declarations", () => {
    const root = makeExport({ "src/types/globals.d.ts": "declare const __APP_VERSION__: string;\n" });
    expect(verifyProBoundary(root).violations).toEqual([]);
  });
});

// ── Generated runtime ────────────────────────────────────────────────────────
describe("placeholderSource", () => {
  it("re-exports every declared name and imports the shared helper", () => {
    const source = placeholderSource(`${PRO_MODULE}.ts`, {
      values: new Set(["WebLLMService", "loadModel", "default"]),
      reexports: [],
    });
    // The extension is required: plain Node ESM (the self-hosted server tree)
    // does not resolve an extensionless relative specifier.
    expect(source).toContain('import { placeholderFor } from "../../../_open-core-placeholder.js";');
    expect(source).toContain("export const WebLLMService = placeholder;");
    expect(source).toContain("export const loadModel = placeholder;");
    expect(source).toContain("export default placeholder;");
    expect(source).toContain(PLACEHOLDER_MARKER);
  });

  it("imports the helper relatively, from any depth", () => {
    const root = placeholderSource(`${pathOf("server", "src", "proxy-utils")}.ts`, {
      values: new Set(["default"]),
      reexports: [],
    });
    expect(root).toContain('from "../../_open-core-placeholder.js"');
    const deep = placeholderSource(`${pathOf("src", "services", "ai", "adapters", "RoutingOptimizer")}.ts`, {
      values: new Set(["default"]),
      reexports: [],
    });
    expect(deep).toContain('from "../../../../_open-core-placeholder.js"');
  });

  it("carries a re-export through, so type-only barrels keep working", () => {
    const source = placeholderSource(`${pathOf("src", "services", "ai", "RAGEngine")}.ts`, {
      values: new Set(),
      reexports: [{ specifier: "./ChunkingService", names: [] }],
    });
    expect(source).toContain('export * from "./ChunkingService";');
  });
});
