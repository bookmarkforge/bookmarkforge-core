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
 *   - imports of AI modules from Core → tolerated as pending, never violations.
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

  it("allows Pro-to-Pro imports and AI-tree internals", () => {
    const root = fakeRepoSafe({
      "src/services/BackupService.ts": PRO_STUB,
      "src/services/DiskBackupService.ts": "export const disk = 1;\n",
      "src/services/ai/ProviderManager.ts": AI_STUB,
      "src/services/ai/RAGEngine.ts": `import { providerManager } from "./ProviderManager";\nimport { BackupService } from "../BackupService";\nexport const engine = { providerManager, BackupService };\n`,
    });
    try {
      const result = checkProImports(root);
      expect(result.violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows server-internal Pro imports but rejects Core importing server Pro", () => {
    const root = fakeRepoSafe({
      "server/src/ai-proxy.ts": "export const proxy = 1;\n",
      "server/src/index.ts": `import { proxy } from "./ai-proxy";\nexport const s = proxy;\n`,
      "src/leak.ts": `import { proxy } from "../server/src/ai-proxy";\nexport const leak = proxy;\n`,
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

  it("counts Core imports of AI modules as pending, not violations", () => {
    const root = fakeRepoSafe({
      "src/services/ai/ProviderManager.ts": AI_STUB,
      "src/components/Chat.tsx": `import { providerManager } from "../services/ai/ProviderManager";\nexport const chat = providerManager;\n`,
    });
    try {
      const result = checkProImports(root);
      expect(result.violations).toHaveLength(0);
      expect(result.pendingAi).toBe(1);
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
