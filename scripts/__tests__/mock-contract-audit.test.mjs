// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(REPO_ROOT, "scripts/tooling/mock-contract-audit.mjs");
const tempRoots = [];

function runAudit(source, filter = "AnalyticsService.test.ts") {
  const root = mkdtempSync(join(tmpdir(), "mock-contract-audit-"));
  tempRoots.push(root);
  const file = join(root, "src/tests/services/AnalyticsService.test.ts");
  mkdirSync(join(root, "src/tests/services"), { recursive: true });
  writeFileSync(file, source);
  return spawnSync(process.execPath, [SCRIPT, filter], {
    encoding: "utf8",
    env: { ...process.env, BMF_MOCK_CONTRACT_ROOT: root },
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("mock-contract-audit", () => {
  it("fails when a required member is only mentioned in a comment", () => {
    const result = runAudit(`
      // P1 required member: safeRemove
      vi.mock("../../store/safeStorage", () => ({
        safeGet: () => null,
        safeSet: () => undefined,
      }));
    `);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing mock member path: safeRemove");
  });

  it("fails when one factory return branch omits a required member", () => {
    const result = runAudit(`
      vi.mock("../../store/safeStorage", () => {
        if (useCompleteMock) {
          return { safeRemove: () => undefined };
        }
        return { safeGet: () => null };
      });
    `);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing mock member path: safeRemove");
  });

  it("fails when a later property overrides a required member from a spread", () => {
    const result = runAudit(`
      const methods = { safeRemove: () => undefined };
      vi.mock("../../store/safeStorage", () => ({
        ...methods,
        safeRemove: undefined,
      }));
    `);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing mock member path: safeRemove");
  });

  it("fails closed when a dynamic computed key may override a required member", () => {
    const result = runAudit(`
      vi.mock("../../store/safeStorage", () => ({
        safeRemove: () => undefined,
        [runtimeKey]: undefined,
      }));
    `);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing mock member path: safeRemove");
  });

  it("fails closed when a later unresolved spread may override a required member", () => {
    const result = runAudit(`
      const methods = { safeRemove: () => undefined };
      vi.mock("../../store/safeStorage", () => ({
        ...methods,
        ...runtimeOverrides,
      }));
    `);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing mock member path: safeRemove");
  });

  it("fails closed when a dynamic computed method may override a required member", () => {
    const result = runAudit(`
      vi.mock("../../store/safeStorage", () => ({
        safeRemove: () => undefined,
        [runtimeKey]() { return undefined; },
      }));
    `);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing mock member path: safeRemove");
  });

  it("fails when a shorthand member resolves to undefined", () => {
    const result = runAudit(`
      const safeRemove = undefined;
      vi.mock("../../store/safeStorage", () => ({ safeRemove }));
    `);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing mock member path: safeRemove");
  });

  it("fails when a computed property overrides a required member", () => {
    const result = runAudit(`
      vi.mock("../../store/safeStorage", () => ({
        safeRemove: () => undefined,
        ["safeRemove"]: undefined,
      }));
    `);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing mock member path: safeRemove");
  });

  it("fails when a duplicate mock factory omits a required member", () => {
    const result = runAudit(`
      vi.mock("../../store/safeStorage", () => ({
        safeRemove: () => undefined,
      }));
      vi.mock("../../store/safeStorage", () => ({
        safeGet: () => null,
      }));
    `);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("cannot verify which one is effective");
  });

  it("does not resolve a factory identifier to an unrelated same-named object", () => {
    const result = runAudit(`
      const storageMock = { safeRemove: () => undefined };
      vi.mock("../../store/safeStorage", () => {
        const storageMock = { safeGet: () => null };
        return storageMock;
      });
    `);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing mock member path: safeRemove");
  });

  it("does not resolve a factory parameter to an unrelated same-named object", () => {
    const result = runAudit(`
      const storageMock = { safeRemove: () => undefined };
      vi.mock("../../store/safeStorage", (storageMock) => storageMock);
    `);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing mock member path: safeRemove");
  });

  it("accepts a required member supplied by a vi.hoisted mock object", () => {
    const result = runAudit(`
      const { mockStorage } = vi.hoisted(() => ({
        mockStorage: {
          safeGet: () => null,
          safeSet: () => undefined,
          safeRemove: () => undefined,
        },
      }));
      vi.mock("../../store/safeStorage", () => mockStorage);
    `);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("mock-contract-audit: 1/1");
  });
});
