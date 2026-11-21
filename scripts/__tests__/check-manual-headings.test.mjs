// @vitest-environment node
/**
 * scripts/__tests__/check-manual-headings.test.mjs
 *
 * Adversarial suite for the manual-headings gate. It pins the two shapes the
 * gate enforces (full manuals mirror the English numbered skeleton, condensed
 * manuals carry five unnumbered sections) and replays the 2026-11-04 Czech
 * drift that no other gate saw:
 *
 *   - §1 demoted to the bare body line "1. Úvod";
 *   - §8 replaced by the translated fragment "Dovoz a vývoz.";
 *   - §9 mangled into `<g id="1">9</g>. Odstraňování problémů`;
 *   - a subsection promoted to a section level;
 *   - a condensed manual that grew a numbered section or a subsection.
 *
 * The last test runs the gate against the real repository so the fixtures
 * cannot drift into a shape the checkout no longer has.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONDENSED_SECTION_COUNT,
  FULL_MANUAL_CODES,
  evaluateManualHeadings,
  headingSignature,
  parseHeadings,
  runManualHeadingsGate,
} from "../check-manual-headings.mjs";
import { LANDING_CODES, manualSourcePath } from "../landing-registry.mjs";

let tmpRoot;

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  }
});

/** English master with the real 13 sections and the subsection shape the
 * translations must follow. */
const ENGLISH = [
  "# User manual",
  "",
  "## 1. Introduction",
  "",
  "## 2. Getting Started",
  "### 2.1 Requirements",
  "### 2.2 Installation",
  "## 3. Core Features",
  "### 3.1 Bookmarks",
  "### 3.2 Note Editor",
  "## 4. AI in BookmarkForge",
  "## 5. P2P Sync",
  "### 5.1 Requirements",
  "## 6. Privacy",
  "## 7. Free vs Pro",
  "### 7.1 Feature comparison",
  "## 8. Import and Export",
  "## 9. Troubleshooting",
  "## 10. FAQ",
  "## 11. Changelog",
  "## 12. Legal",
  "## 13. Contact",
  "",
].join("\n");

const ENGLISH_SIGNATURE = headingSignature(parseHeadings(ENGLISH));

/** Same skeleton, translated text — headings differ only by words. */
const CZECH_FULL = ENGLISH.replace("# User manual", "# Uživatelská příručka")
  .replace("## 1. Introduction", "## 1. Úvod")
  .replace("## 2. Getting Started", "## 2. Začínáme")
  .replace("## 8. Import and Export", "## 8. Import a export")
  .replace("## 9. Troubleshooting", "## 9. Odstraňování problémů");

const CONDENSED = [
  "# Uživatelská příručka",
  "",
  "## Začínáme",
  "",
  "## Záložky a vyhledávání",
  "",
  "## Import z Pocket",
  "",
  "## Poznámky, AI a synchronizace",
  "",
  "## Zálohy a pomoc",
  "",
].join("\n");

const full = (src, label = "cs.md") =>
  evaluateManualHeadings(src, { full: true, expected: ENGLISH_SIGNATURE, label });
const condensed = (src, label = "cs.md") =>
  evaluateManualHeadings(src, { full: false, label });

describe("parseHeadings / headingSignature", () => {
  it("keeps level and dotted section number, dropping heading markup", () => {
    const headings = parseHeadings("# T\n## 3. Core **Features**\n### 3.1 `Bookmarks`\n");
    expect(headings).toEqual([
      { level: 1, text: "T", number: null },
      { level: 2, text: "3. Core Features", number: "3" },
      { level: 3, text: "3.1 Bookmarks", number: "3.1" },
    ]);
  });

  it("only treats a leading number as a section number at the start of the line", () => {
    expect(parseHeadings("## 300+ integrations")[0].number).toBe(null);
    expect(headingSignature(parseHeadings("## 2. Setup"))).toEqual(["2:2"]);
  });
});

describe("full manuals", () => {
  it("accepts a translated skeleton with the same sections and levels", () => {
    expect(full(CZECH_FULL)).toEqual([]);
  });

  it("catches the 2026-11-04 Czech §1 demoted to body text", () => {
    const drifted = CZECH_FULL.replace("## 1. Úvod", "1. Úvod");
    expect(full(drifted)).toEqual([
      expect.stringContaining("lost section(s) 1 that the English source declares"),
    ]);
  });

  it("catches §8 replaced by its translated fragment and §9 lost with it", () => {
    const drifted = CZECH_FULL.replace("## 8. Import a export", "Dovoz a vývoz.").replace(
      "## 9. Odstraňování problémů",
      "Problémy",
    );
    const failures = full(drifted);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("lost section(s) 8, 9");
  });

  it("catches the machine-translation artifact that hid §9", () => {
    const drifted = CZECH_FULL.replace(
      "## 9. Odstraňování problémů",
      '<g id="1">9</g>. Odstraňování problémů',
    );
    const failures = full(drifted);
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("machine-translation artifact in body"),
        expect.stringContaining("lost section(s) 9"),
      ]),
    );
  });

  it("catches a subsection promoted to a section", () => {
    const drifted = CZECH_FULL.replace("### 3.1 Bookmarks", "## 3.1 Bookmarks");
    expect(full(drifted)).toEqual([
      expect.stringContaining("section order or level differs from the English skeleton"),
    ]);
  });

  it("catches an extra section the English source does not declare", () => {
    const drifted = CZECH_FULL.replace("## 10. FAQ", "## 10. FAQ\n## 14. Roadmap");
    expect(full(drifted)).toEqual([
      expect.stringContaining("has section(s) 14 absent from the English source"),
    ]);
  });

  it("catches a second title", () => {
    expect(full(`# Second title\n\n${CZECH_FULL}`)).toEqual([
      expect.stringContaining('expected exactly one "# " title, found 2'),
    ]);
  });

  it("refuses to compare a full manual without an English signature", () => {
    expect(() => evaluateManualHeadings(CZECH_FULL, { full: true, label: "cs.md" })).toThrow(
      /missing English signature/,
    );
  });
});

describe("condensed manuals", () => {
  it("accepts the five-section unnumbered shape", () => {
    expect(condensed(CONDENSED)).toEqual([]);
  });

  it(`rejects a shape with more than ${CONDENSED_SECTION_COUNT} sections`, () => {
    const drifted = CONDENSED.replace("## Zálohy a pomoc", "## Zálohy\n\n## Pomoc");
    expect(condensed(drifted)).toEqual([
      expect.stringContaining(
        `condensed manual must carry ${CONDENSED_SECTION_COUNT} "## " sections, found 6`,
      ),
    ]);
  });

  it("rejects numbered section headings", () => {
    const drifted = CONDENSED.replace("## Začínáme", "## 1. Začínáme");
    expect(condensed(drifted)).toEqual(
      expect.arrayContaining([expect.stringContaining("numbered section heading(s) [1]")]),
    );
  });

  it("rejects subsections", () => {
    const drifted = CONDENSED.replace("## Začínáme", "## Začínáme\n### Instalace");
    expect(condensed(drifted)).toEqual(
      expect.arrayContaining([expect.stringContaining("has 1 subsection heading(s)")]),
    );
  });
});

describe("the repository itself", () => {
  it("keeps every registered manual on its documented skeleton", () => {
    const result = runManualHeadingsGate();
    expect(result.missing).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.counts.full).toBe(FULL_MANUAL_CODES.length);
    expect(result.counts.condensed).toBe(LANDING_CODES.length - FULL_MANUAL_CODES.length);
    expect(result.expected.filter((entry) => entry.startsWith("2:")).length).toBe(13);
  });

  it("covers exactly the registry's manual sources", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "manual-headings-"));
    mkdirSync(join(tmpRoot, "docs"), { recursive: true });
    // A tree with the English master only: every other locale must be reported
    // missing by path, so a registry entry can never be silently unpoliced.
    writeFileSync(join(tmpRoot, manualSourcePath("en")), ENGLISH);
    const result = runManualHeadingsGate(tmpRoot);
    expect(result.missing).toHaveLength(LANDING_CODES.length - 1);
    expect(result.missing).toContain(manualSourcePath("cs"));
    expect(result.failures).toEqual([]);
  });

  it("fails closed when the English master is absent", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "manual-headings-"));
    expect(() => runManualHeadingsGate(tmpRoot)).toThrow(/missing English master/);
  });
});
