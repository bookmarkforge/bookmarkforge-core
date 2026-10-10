import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * P2 regression — the SecureStorage plaintext test bypass must be gated by
 * `import.meta.env.PROD` so it can never activate in a production build.
 *
 * `isTestEnv()` returns true for the NODE_ENV="test" unit-test switch, which
 * makes encryptValue/decryptValue store/read secrets verbatim. W-2 hardening
 * added a static `if (import.meta.env.PROD) return false;` FIRST: Vite inlines
 * `import.meta.env.PROD` at build time, so in a production bundle that branch
 * becomes `if (true) return false;` and is dead-code-eliminated — the bypass
 * cannot compile into prod even if NODE_ENV leaks as "test" (misconfigured
 * CI/hosting). This test scans the source so the guarantee cannot silently
 * regress during refactors.
 *
 * The scan strips comments first (same technique as scripts/check-env-config.mjs)
 * so the assertions validate the CODE, not the explanatory comment prose.
 */
describe("P2 regression — SecureStorage.isTestEnv() PROD gate", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../services/SecureStorage.ts"),
    "utf-8",
  );

  // Slice the isTestEnv() method body up to the next static member, then
  // strip comment prose so negative assertions check real code only.
  const isTestEnvBlock = src
    .slice(
      src.indexOf("private static isTestEnv(): boolean {"),
      src.indexOf("private static hasWebCrypto(): boolean {"),
    )
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  it("the bypass is gated by import.meta.env.PROD with an early return false", () => {
    expect(isTestEnvBlock).toMatch(/import\.meta\.env\.PROD/);
    expect(isTestEnvBlock).toMatch(/return false;/);
    // The PROD gate must be evaluated BEFORE the NODE_ENV fallback, so a
    // production build can never fall through to the test switch.
    const prodIdx = isTestEnvBlock.indexOf("import.meta.env.PROD");
    const nodeEnvIdx = isTestEnvBlock.indexOf("process.env");
    expect(prodIdx).toBeGreaterThanOrEqual(0);
    expect(nodeEnvIdx).toBeGreaterThan(prodIdx);
  });

  it("the runtime switch stays on NODE_ENV (not MODE / import.meta.vitest)", () => {
    expect(isTestEnvBlock).toMatch(/process\.env\?\.NODE_ENV === "test"/);
    // MODE stays "test" under Vitest, so a MODE-based switch would silently
    // bypass the NODE_ENV="production" suites that assert real encryption.
    expect(isTestEnvBlock).not.toMatch(/import\.meta\.env\.MODE/);
    // import.meta.vitest is only defined in Vitest TEST files, never in this
    // source module — it could never gate a check that runs in SecureStorage.
    expect(isTestEnvBlock).not.toMatch(/import\.meta\.vitest/);
  });

  it("encryptValue/decryptValue both still honor the isTestEnv() gate", () => {
    const calls = src.match(/SecureStorage\.isTestEnv\(\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("the __plain__ marker is still rejected outside a test environment", () => {
    expect(src).toMatch(/Refusing to decrypt plaintext marker/);
  });
});
