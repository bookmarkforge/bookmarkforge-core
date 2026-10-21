// @vitest-environment node
/**
 * Tests for the Pro-import erosion gate (scripts/check-pro-imports.mjs).
 *
 * Each case materializes a synthetic repo (real files on disk — the scanner
 * resolves specifiers with fs.existsSync) exercising exactly one allowance
 * or one violation class:
 *
 *   - a Core file statically importing a non-AI Pro module → violation;
 *   - the same import through the pro-access seam → allowed;
 *   - Pro-to-Pro imports (inside the Pro tree and the AI directory) → allowed;
 *   - server-internal Pro imports → allowed;
 *   - test files → allowed;
 *   - type-only imports → allowed, but a specifier that also has a value
 *     usage in the same file → violation;
 *   - imports of AI modules from Core → plain Core imports, no special zone
 *       (the old pending-AI tolerance was removed when the migration landed).
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkProImports,
  isTypeOnlyUsage,
  PRO_ACCESS_SEAM,
  BOUNDARY_GENERATOR,
} from "../check-pro-imports.mjs";

/** Build a synthetic repo; `files` maps repo-relative paths to content. */
function fakeRepoSafe(files) {
  const root = mkdtempSync(join(tmpdir(), "pro-imports-"));
  for (const [rel, content] of Object.entries(files)) {
    const parts = rel.split("/");
    const dir = parts.slice(0, -1).join("/");
    if (dir) {mkdirSync(join(root, dir), { recursive: true });}
    writeFileSync(join(root, parts.join("/")), content);
  }
  return root;
}

const PRO_STUB = "export class BackupService {}\n";
const AI_STUB = "export const providerManager = {};\n";

describe("check-pro-imports", () => {
  it("flags a Core file statically importing a non-AI Pro module", () => {
    const root = fakeRepoSafe({
      "src/services/BackupService.ts": PRO_STUB,
      "src/components/Foo.tsx": `import { BackupService } from "../services/BackupService";\nexport const foo = BackupService;\n`,
    });
    try {
      const result = checkProImports(root);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].file).toBe("src/components/Foo.tsx");
      expect(result.violations[0].specifier).toBe("../services/BackupService");
      expect(result.violations[0].modulePath).toBe("src/services/BackupService.ts");
      expect(result.violations[0].line).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows the pro-access seam itself", () => {
    const root = fakeRepoSafe({
      "src/services/BackupService.ts": PRO_STUB,
      [PRO_ACCESS_SEAM]: `import { BackupService } from "./BackupService";\nexport const seam = BackupService;\n`,
    });
    try {
      const result = checkProImports(root);
      expect(result.violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows the boundary generator to name Pro paths (machinery, not coupling)", () => {
    const root = fakeRepoSafe({
      "src/services/BackupService.ts": PRO_STUB,
      [BOUNDARY_GENERATOR]: `import { isProModulePath } from "./x";\nexport const target = "src/services/BackupService.ts";\n`,
    });
    try {
      // pro-boundary.mjs references Pro by path strings, resolved through the
      // scanner; the allowance must keep it out of violations.
      const result = checkProImports(root);
      expect(result.violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows Pro-to-Pro imports and AI-tree Core internals", () => {
    const root = fakeRepoSafe({
      "src/services/BackupService.ts": PRO_STUB,
      "src/services/DiskBackupService.ts": "export const disk = 1;\n",
      "src/services/ai/ProviderManager.ts": AI_STUB,
      // AI-tree modules that stay Core may import each other freely…
      "src/services/ai/RAGEngine.ts": `import { providerManager } from "./ProviderManager";\nexport const engine = { providerManager };\n`,
      // …and a genuine Pro AI module may import Pro services directly.
      "src/services/ai/WebLLMService.ts": `import { BackupService } from "../BackupService";\nexport const svc = { BackupService };\n`,
    });
    try {
      const result = checkProImports(root);
      expect(result.violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an AI-tree Core module statically importing a Pro service", () => {
    // Regression pin for the exact-list policy: RAGEngine is Core, so its
    // static link to BackupService is precisely the erosion the gate exists
    // for — the AI directory no longer grants blanket Pro-to-Pro status.
    const root = fakeRepoSafe({
      "src/services/BackupService.ts": PRO_STUB,
      "src/services/ai/RAGEngine.ts": `import { BackupService } from "../BackupService";\nexport const engine = { BackupService };\n`,
    });
    try {
      const result = checkProImports(root);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].specifier).toBe("../BackupService");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

it("allows server-internal imports but still rejects Core importing Pro", () => {
     // Rule 3 allows an import when importer and target both live under
     // `server/` (the server assembles its own handlers). That allowance must
     // not leak into Core: the `src/leak.ts` reference is a violation whatever
     // the server tree imports internally.
     const root = fakeRepoSafe({
       "server/src/proxy-utils.ts": "export const proxy = 1;\n",
       "server/src/index.ts": `import { proxy } from "./proxy-utils";\nexport const s = proxy;\n`,
       "src/services/BackupService.ts": PRO_STUB,
       "src/leak.ts": `import { BackupService } from "./services/BackupService";\nexport const leak = BackupService;\n`,
     });
     try {
       const result = checkProImports(root);
       expect(result.violations).toHaveLength(1);
       expect(result.violations[0].file).toBe("src/leak.ts");
     } finally {
       rmSync(root, { recursive: true, force: true });
     }
   });

  it("allows test files to reference Pro modules", () => {
    const root = fakeRepoSafe({
      "src/services/BackupService.ts": PRO_STUB,
      "src/tests/backup.pin.test.ts": `import { BackupService } from "../services/BackupService";\nimport { expect } from "vitest";\nexpect(BackupService).toBeTruthy();\n`,
    });
    try {
      const result = checkProImports(root);
      expect(result.violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows type-only imports but flags a specifier with a value usage", () => {
    const source = [
      `import type { SyncState } from "../services/WebRTCSyncService";`,
      `import { BackupService } from "../services/BackupService";`,
      `export type S = SyncState;`,
      `export const b = BackupService;`,
    ].join("\n");
    expect(isTypeOnlyUsage(source, "../services/WebRTCSyncService")).toBe(true);
    expect(isTypeOnlyUsage(source, "../services/BackupService")).toBe(false);

    const root = fakeRepoSafe({
      "src/services/WebRTCSyncService.ts": "export type SyncState = string;\n",
      "src/services/BackupService.ts": PRO_STUB,
      "src/components/Bar.tsx": source,
    });
    try {
      const result = checkProImports(root);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].specifier).toBe("../services/BackupService");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats AI-tree Core imports as plain allowed — there is no pending zone", () => {
    // Under the exact Pro list, the AI modules that are Core (BYOK cloud,
    // embedding engine, semantic search) import like any other Core module:
    // no tolerance, no counting, just allowed.
    const root = fakeRepoSafe({
      "src/services/ai/ProviderManager.ts": AI_STUB,
      "src/components/Chat.tsx": `import { providerManager } from "../services/ai/ProviderManager";\nexport const chat = providerManager;\n`,
    });
    try {
      const result = checkProImports(root);
      expect(result.violations).toHaveLength(0);
      // A Core→Core import is not a Pro reference at all, so it consumes no
      // allowance (the counter only tracks seam/Pro→Pro/server/test/type-only
      // references), and there is no pending counter left to bump.
      expect(result.allowed).toBe(0);
      expect(result).not.toHaveProperty("pendingAi");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles multi-line type-only imports", () => {
    const root = fakeRepoSafe({
      "src/services/WebRTCSyncService.ts": "export type SyncState = string;\n",
      "src/components/Baz.tsx": `import type {\n  SyncState,\n} from "../services/WebRTCSyncService";\nexport type S = SyncState;\n`,
    });
    try {
      const result = checkProImports(root);
      expect(result.violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
