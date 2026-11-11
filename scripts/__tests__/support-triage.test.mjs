/**
 * Regression suite for scripts/support-triage.mjs.
 *
 * Each case pins a bug that actually shipped during development: substring
 * false positives ("sue" inside "issue", "ai" inside "said"/"j'ai"),
 * un-normalized keywords missing accented terms, single-topic drafts on
 * multi-topic tickets, and missing categories (GDPR/account requests).
 */
import { describe, expect, it } from "vitest";
import { classify } from "../support-triage.mjs";

describe("support-triage classify", () => {
  it("classifies an AppSumo license+ billing ticket with provider detection", () => {
    const r = classify(
      "I bought the lifetime deal on AppSumo but my license key is not working. I was charged twice!",
    );
    expect(r.topics).toContain("license");
    expect(r.provider).toBe("appsumo");
    expect(r.bfCodes).toEqual([]);
  });

  it("flags refund + anger + chargeback as urgent refund", () => {
    const r = classify(
      "This is ridiculous — I want a FULL REFUND NOW or I will dispute the charge with my bank.",
    );
    expect(r.category).toBe("refund");
    expect(r.flags.length).toBeGreaterThan(0);
  });

  it("does not flag legal urgency from the word 'issue' or 'said'", () => {
    const r = classify("I have an issue with sync — said the docs would help but they did not.");
    expect(r.flags).toEqual([]);
  });

  it("does not classify French 'j'ai' as the AI category", () => {
    const r = classify("J'ai un problème de synchronisation entre deux appareils.");
    expect(r.category).toBe("sync");
    expect(r.topics).not.toContain("ai");
  });

  it("matches accented Spanish keywords against normalized text", () => {
    const r = classify("La extensión del navegador no guarda mis marcadores.");
    expect(r.topics).toContain("extension");
  });

  it("keeps two topics on a multi-topic ticket", () => {
    const r = classify(
      "Please delete my account and all my data (GDPR). Also the Pocket import fails with BF-E107.",
    );
    expect(r.topics).toContain("account");
    expect(r.topics).toContain("import-export");
    expect(r.bfCodes).toContain("BF-E107");
  });

  it("classifies a German vault-access ticket", () => {
    const r = classify("Ich habe mein Hauptpasswort vergessen und komme nicht mehr in den Tresor.");
    expect(r.topics).toContain("vault-access");
  });

  it("classifies a French AppSumo refund ticket", () => {
    const r = classify("Je voudrais un remboursement, j'ai acheté sur AppSumo il y a 3 jours.");
    expect(r.category).toBe("refund");
    expect(r.provider).toBe("appsumo");
  });

  it("returns 'other' for unrelated text instead of forcing a category", () => {
    const r = classify("Hello, just saying hi and thanks for the great app!");
    expect(r.category).toBe("other");
  });
});
