import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * P3 regression — ADR-038: HMAC signature verification in the two
 * attestation chains must use the shared constant-time primitive
 * (`src/services/security-vault/compare.ts`), never `===` / `!==`.
 *
 * Why it matters: `===` on signature hex leaks the longest matching prefix
 * length to any attacker who can place chosen signatures into storage and
 * observe verify/tamper results (classic string-compare timing oracle).
 * The codebase already had the primitive and used it correctly in
 * SecurityVault and the Node server (timingSafeEqual) — only these two
 * client attestation chains used `===`. Found by the 2026-09-02 audit
 * (docs/audit-report-2026-09-02.md, finding M-1).
 *
 * The scan strips comments first (same technique as
 * p2-secure-storage-prod-guard.regression.test.ts) so the negative
 * assertions validate the CODE, not the explanatory comment prose (this
 * file's own header would otherwise trip the `===` detector).
 */
const MUTATION_GUARD_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../services/security/MutationGuard.ts"),
  "utf-8",
);
const ATTESTATION_CHAIN_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../services/security/AttestationChain.ts"),
  "utf-8",
);
const COMPARE_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../services/security-vault/compare.ts"),
  "utf-8",
);

/** Strip line + block comments so prose never satisfies a code assertion. */
function stripComments(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

const mutationGuardCode = stripComments(MUTATION_GUARD_SRC);
const attestationChainCode = stripComments(ATTESTATION_CHAIN_SRC);

describe("P3 regression — ADR-038 constant-time HMAC comparison", () => {
  it("MutationGuard.verify compares signatures with constantTimeCompare", () => {
    expect(mutationGuardCode).toContain(
      "constantTimeCompare(signed.signature, expectedSig)",
    );
  });

  it("MutationGuard.detectTampering compares signatures with constantTimeCompare", () => {
    expect(mutationGuardCode).toContain(
      "constantTimeCompare(storedSig.signature, expectedSig)",
    );
  });

  it("MutationGuard has no direct ===/!== signature comparison left", () => {
    // Any `x.signature === y` / `x.signature !== y` reintroduces the oracle.
    expect(mutationGuardCode.match(/\.signature\s*(?:===|!==)/g) ?? []).toEqual(
      [],
    );
  });

  it("AttestationChain.verifyChain compares signature AND prevHash in constant time", () => {
    // prevHash carries the previous entry's secret HMAC, so it is the same
    // class of secret digest and gets the same treatment.
    expect(attestationChainCode).toContain(
      "constantTimeCompare(curr.prevHash, prev.signature)",
    );
    expect(attestationChainCode).toContain(
      "constantTimeCompare(curr.signature, expectedSig)",
    );
  });

  it("AttestationChain has no direct ===/!== chain-digest comparison left", () => {
    expect(
      attestationChainCode.match(
        /(?:curr\.signature|curr\.prevHash)\s*(?:===|!==)/g,
      ) ?? [],
    ).toEqual([]);
  });

  it("both services import the primitive from the shared module", () => {
    const importRe =
      /import\s*\{\s*constantTimeCompare\s*\}\s*from\s*"..\/security-vault\/compare"/;
    expect(mutationGuardCode).toMatch(importRe);
    expect(attestationChainCode).toMatch(importRe);
    // The primitive must keep existing and keep its exported name — both
    // services (and SecurityVault) resolve this import at module load.
    expect(COMPARE_SRC).toContain(
      "export function constantTimeCompare(a: string, b: string): boolean",
    );
  });
});

describe("P3 regression — constantTimeCompare primitive semantics", () => {
  // Behavioral pin (not just source scan): the primitive must stay correct
  // for the exact domain both services feed it — fixed-length hex digests.
  // Covers the length-mismatch branch, which a length-oblivious refactor
  // (e.g. zipping min(a,b)) would silently break fail-open.
  it.each([
    ["aabbccdd", "aabbccdd", true],
    ["aabbccdd", "aabbccde", false],
    ["aabbccdd", "aabbcc", false],
    ["aabbcc", "aabbccdd", false],
    ["", "", true],
    ["00", "0000", false],
  ])("compare(%j, %j) === %j", (a, b, expected) => {
    // Dynamic import keeps the top of the file comment-scan-only.
    return import("../../services/security-vault/compare").then(
      ({ constantTimeCompare }) => {
        expect(constantTimeCompare(a, b)).toBe(expected);
      },
    );
  });
});
