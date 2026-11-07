import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * RL-1 regression — no unthrottled password-verification oracle.
 *
 * The audit found `verifyPassword()` was callable from outside the vault
 * without any rate limit: a compromised renderer (or a future caller) could
 * turn the vault into an offline brute-force oracle. The fix made
 * `verifyPassword` private and exposed ONLY `verifyPasswordRateLimited()`
 * (same 5-attempt lockout as unlock()) and `decryptShareWithRateLimit()`
 * (RL-2, share-import decrypt that runs inside the same lockout gate).
 *
 * TypeScript's `private` is compile-time only, so this test scans the
 * source: the declaration must keep the `private` keyword, and the two
 * sanctioned entry points must keep their lockout gates. It also pins the
 * two external callers (NuclearForgetService, CollaborationService) to the
 * rate-limited variants so a refactor cannot silently reintroduce a
 * bypass.
 */
describe("P3 regression — verifyPassword stays private (RL-1)", () => {
  const vaultSrc = fs.readFileSync(
    path.resolve(__dirname, "../../services/SecurityVault.ts"),
    "utf-8",
  );

  it("verifyPassword() is private (not exported or public)", () => {
    // The declaration must remain private.
    expect(vaultSrc).toMatch(/private\s+async\s+verifyPassword\s*\(/);
    // There must be no public declaration with the same name.
    // (The private line already contains "private async verifyPassword(" —
    // a public variant would have to start the line without private.)
    const publicDecl = vaultSrc.match(/(^|\n)\s*async\s+verifyPassword\s*\(/);
    expect(publicDecl).toBeNull();
  });

  it("verifyPasswordRateLimited() is the only public path and enforces lockout", () => {
    const start = vaultSrc.indexOf("async verifyPasswordRateLimited(");
    expect(start).toBeGreaterThan(-1);
    // Cut up to the next method to inspect only this body.
    const next = vaultSrc.indexOf("decryptShareWithRateLimit(", start);
    const body = vaultSrc.slice(start, next);
    expect(body).toMatch(/Date\.now\(\) < rl\.lockoutUntil/);
    expect(body).toMatch(/recordFailedAttempt/);
    expect(body).toMatch(/resetAttempts/);
  });

  it("decryptShareWithRateLimit() descifra DENTRO de la puerta de lockout (RL-2)", () => {
    const start = vaultSrc.indexOf("async decryptShareWithRateLimit(");
    expect(start).toBeGreaterThan(-1);
    const gate = vaultSrc.indexOf("Date.now() < rl.lockoutUntil", start);
    expect(gate).toBeGreaterThan(-1);
    const decrypt = vaultSrc.indexOf("encryptionService.decrypt", start);
    expect(decrypt).toBeGreaterThan(gate);
    // A decrypt failure counts as a failed attempt (catch block,
    // which appears AFTER the decrypt call).
    const bodyEnd = vaultSrc.indexOf("async generateSessionToken", start);
    expect(vaultSrc.slice(start, bodyEnd)).toMatch(/recordFailedAttempt/);
  });
});

describe("P3 regression — callers use only the rate-limited variants", () => {
  it("NuclearForgetService uses verifyPasswordRateLimited (not raw verifyPassword)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../services/NuclearForgetService.ts"),
      "utf-8",
    );
    expect(src).toMatch(/verifyPasswordRateLimited\s*\(/);
    // The only verification method invoked must be the rate-limited one.
    const direct = src.match(/securityVault\.verifyPassword\s*\(/);
    expect(direct).toBeNull();
  });

  it("CollaborationService decrypts the share ONLY via decryptShareWithRateLimit (RL-2)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../services/CollaborationService.ts"),
      "utf-8",
    );
    expect(src).toMatch(/decryptShareWithRateLimit\s*\(/);
    // Must never call encryptionService.decrypt directly for the
    // share payload (that would reintroduce the RL-2 rate-limit bypass).
    expect(src).not.toMatch(/encryptionService\.decrypt\s*\(/);
  });
});
