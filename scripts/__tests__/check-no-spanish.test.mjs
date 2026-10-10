/**
 * scripts/__tests__/check-no-spanish.test.mjs
 *
 * Unit suite for the Spanish-prose ratchet. The negative paths carry the
 * weight here: a ratchet that cannot fail is decoration, so every "this must
 * fail" rule has a test that proves it fails (ADR-028's gate-drift principle,
 * applied to this gate).
 */
import { describe, expect, it } from "vitest";
import {
  EXCLUDED,
  SCAN_ROOTS,
  detectSpanishProse,
  evaluate,
  isScannable,
  scanText,
  scopeFingerprint,
  spanishWordsIn,
} from "../check-no-spanish.mjs";
import { MANUAL_FILES } from "../landing-registry.mjs";

const isExcluded = (path) => EXCLUDED.some((pattern) => pattern.test(path));

describe("the detector", () => {
  it("flags a line carrying three distinct Spanish words", () => {
    const detected = detectSpanishProse("La configuracion del servidor requiere una clave");
    expect(detected).not.toBeNull();
    expect(detected.words).toEqual(expect.arrayContaining(["la", "del"]));
  });

  it("flags two words plus a Spanish accented letter", () => {
    // Exactly two Spanish words, so only the accent can carry the line.
    const detected = detectSpanishProse("Cada página");
    expect(detected).not.toBeNull();
    expect(detected.via).toBe("accent");
    expect(detected.words).toEqual(["cada", "pagina"]);
  });

  it("does not flag a single Spanish word inside an English sentence", () => {
    expect(detectSpanishProse("The servidor is the entry point for every request.")).toBeNull();
  });

  it("does not flag two unaccented Spanish words", () => {
    // The density floor exists so a stray cognate cannot trip the gate.
    expect(detectSpanishProse("The vault is stored locally and the plan is fixed.")).toBeNull();
  });

  it("ignores English cognates that are also valid Spanish", () => {
    // These are the words that make naive Spanish detection useless: they are
    // real Spanish AND real English, so they carry no signal at all.
    const line = "This is a legal total error in the local manual version of the plan.";
    expect(spanishWordsIn(line)).not.toContain("error");
    expect(spanishWordsIn(line)).not.toContain("total");
    expect(spanishWordsIn(line)).not.toContain("legal");
    expect(spanishWordsIn(line)).not.toContain("manual");
    expect(detectSpanishProse(line)).toBeNull();
  });

  it("does not flag English words that merely look Spanish", () => {
    for (const line of [
      "No results were found.",
      "The version is stored in the local store.",
      "A solo performance test measures the total bundle size.",
    ]) {
      expect(detectSpanishProse(line)).toBeNull();
    }
  });

  it("honours the shared i18n-allow pragma", () => {
    const line = "la clave del servidor la guarda el operador /* i18n-allow: quoted Spanish */";
    expect(detectSpanishProse(line)).toBeNull();
  });

  it("matches accent-stripped text", () => {
    expect(detectSpanishProse("decision tipica con la debida atencion")).not.toBeNull();
  });
});

describe("scanText", () => {
  it("counts Spanish prose and reports the offending lines", () => {
    const text = [
      "# Title",
      "",
      "Esta es la seccion donde la clave del servidor se describe en detalle.",
      "This paragraph is entirely in English and must not count at all.",
      "",
      "El documento entero tiene la forma que se describe a continuacion.",
    ].join("\n");
    const result = scanText("docs/x.md", text);
    expect(result.count).toBe(2);
    expect(result.hits.map((hit) => hit.line)).toEqual([3, 6]);
  });

  it("ignores fenced code blocks", () => {
    const text = ["```bash", "# la clave del servidor se genera aqui", "```", ""].join("\n");
    expect(scanText("docs/x.md", text).count).toBe(0);
  });

  it("tolerates CRLF line endings", () => {
    // This checkout uses Windows line endings. A scanner splitting only on "\n"
    // leaves a trailing "\r" on every line, so word extraction must not depend
    // on it — and the reported line numbers must still be right.
    const text =
      "La clave del servidor se describe en la seccion\r\n" +
      "de este documento con la clave del servidor.\r\n" +
      "The third line is entirely English and must not count.\r\n";
    const result = scanText("docs/x.md", text);
    expect(result.count).toBe(2);
    expect(result.hits.map((hit) => hit.line)).toEqual([1, 2]);
  });

  it("counts nothing in an English document", () => {
    const text = [
      "# Rollback drill",
      "",
      "Runs the detect -> rollback -> restore chain against the real tree.",
      "Reports a per-phase table and exits 0/1 for CI.",
    ].join("\n");
    expect(scanText("docs/x.md", text).count).toBe(0);
  });
});

describe("scope", () => {
  it("scans docs, scripts and legal", () => {
    expect(SCAN_ROOTS).toEqual(["docs", "scripts", "legal"]);
  });

  it("excludes the multi-language manual family anywhere in the tree", () => {
    expect(isExcluded(`docs/${MANUAL_FILES.es}.md`)).toBe(true);
    expect(isExcluded(`docs/${MANUAL_FILES.pt}.md`)).toBe(true);
    expect(isExcluded(`scripts/public-export/${MANUAL_FILES.es}.md`)).toBe(true);
    expect(isExcluded(`docs/${MANUAL_FILES.es}-styled.html`)).toBe(true);
    expect(isExcluded("docs/pricing-decision.md")).toBe(false);
  });

  it("excludes per-locale translation sources and manifests", () => {
    expect(isExcluded("scripts/translations/es.json")).toBe(true);
    expect(isExcluded("scripts/landing-translations.json")).toBe(true);
    expect(isExcluded("scripts/privacy-translations.json")).toBe(true);
    expect(isExcluded("docs/policy-es.md")).toBe(true);
  });

  it("excludes the language detectors themselves", () => {
    // They hold Spanish words as DATA. Without this the gate flags its own
    // word list, and so does check-english-only.
    expect(isExcluded("scripts/check-no-spanish.mjs")).toBe(true);
    expect(isExcluded("scripts/check-english-only.mjs")).toBe(true);
  });

  it("excludes test fixtures, which carry Spanish on purpose", () => {
    expect(isExcluded("scripts/__tests__/check-license-claims.test.mjs")).toBe(true);
  });

  it("keeps ordinary source and docs in scope", () => {
    for (const path of [
      "docs/ADR-043-check-seo-gate.md",
      "scripts/rollback.mjs",
      "legal/REGISTRO.md",
    ]) {
      expect(isExcluded(path)).toBe(false);
      expect(isScannable(path)).toBe(true);
    }
  });

  it("does not scan hidden files, binaries or baselines", () => {
    expect(isScannable(".hidden.md")).toBe(false);
    expect(isScannable("image.png")).toBe(false);
    expect(isScannable("scripts/no-spanish-baseline.json")).toBe(false);
    expect(isScannable("scripts/rollback.mjs")).toBe(true);
  });
});

describe("the ratchet", () => {
  const baseline = { scope: scopeFingerprint(), perFile: { "docs/a.md": 2, "docs/b.md": 5 } };

  it("passes when every file matches its baseline", () => {
    const scan = { scope: scopeFingerprint(), perFile: { "docs/a.md": 2, "docs/b.md": 5 }, findings: [] };
    expect(evaluate(scan, baseline).ok).toBe(true);
  });

  it("passes when a file improves", () => {
    const scan = { scope: scopeFingerprint(), perFile: { "docs/a.md": 0, "docs/b.md": 1 }, findings: [] };
    const result = evaluate(scan, baseline);
    expect(result.ok).toBe(true);
    expect(result.oks.join(" ")).toContain("improved");
  });

  it("fails when a file regresses, and names the lines", () => {
    const scan = {
      scope: scopeFingerprint(),
      perFile: { "docs/a.md": 2, "docs/b.md": 9 },
      findings: [
        { file: "docs/b.md", line: 12, text: "La clave del servidor no se valida aqui" },
        { file: "docs/b.md", line: 20, text: "El documento tiene la forma que se describe" },
      ],
    };
    const result = evaluate(scan, baseline);
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("docs/b.md: Spanish prose regressed");
    expect(result.failures.join("\n")).toContain("docs/b.md:12");
  });

  it("fails on a file that is not in the baseline at all", () => {
    const scan = {
      scope: scopeFingerprint(),
      perFile: { "docs/a.md": 2, "docs/b.md": 5, "docs/new.md": 1 },
      findings: [{ file: "docs/new.md", line: 3, text: "La clave del servidor se valida en la seccion" }],
    };
    const result = evaluate(scan, baseline);
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("docs/new.md");
  });

  it("fails closed when the baseline is missing", () => {
    const scan = { scope: scopeFingerprint(), perFile: {}, findings: [] };
    const result = evaluate(scan, null);
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("no baseline");
  });

  it("fails when the scope fingerprint moves", () => {
    // Otherwise someone could delete Spanish words from SPANISH_WORDS to make
    // the gate quiet without ever touching the baseline.
    const scan = { scope: "deadbeef", perFile: {}, findings: [] };
    const result = evaluate(scan, { ...baseline, scope: "cafebabe" });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("scope fingerprint changed");
  });

  it("keeps fix-A-break-B from passing on an equal total", () => {
    const scan = {
      scope: scopeFingerprint(),
      perFile: { "docs/a.md": 0, "docs/b.md": 7 },
      findings: [],
    };
    // Totals are equal (2 + 5 === 0 + 7) but docs/b.md regressed.
    expect(evaluate(scan, baseline).ok).toBe(false);
  });

  it("accepts --update as the explicit re-pin path", () => {
    const scan = { scope: scopeFingerprint(), perFile: { "docs/a.md": 0 }, findings: [] };
    expect(evaluate(scan, null, { update: true }).ok).toBe(true);
  });
});

describe("the detector does not match English documentation", () => {
  it.each([
    "## Rollback path\n",
    "The gate fails closed when a row lacks the Mode column or carries an unknown mode.",
    "| Command | Mode | Observable on this date |\n|---|---|---|\n",
    "- **Bilingual labels.** Each section accepts its Spanish label or its English equivalent.\n",
    "The bundle is precached at 6.36 MB with a 10 MB cap; ORT WASM stays lazy at 22.5 MB.",
  ])("leaves English text alone: %j", (line) => {
    expect(detectSpanishProse(line)).toBeNull();
  });
});