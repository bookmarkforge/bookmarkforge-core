// @vitest-environment node
/**
 * scripts/__tests__/check-license-claims.test.mjs
 *
 * Tests for the license-claims gate (batch: post-AGPL-drift hardening).
 *
 * The gate exists because thirty localized manuals, their PDFs, a landing
 * comparison and the OpenAPI metadata shipped "AGPL-3.0" while the project is
 * MIT. These tests pin the two directions of the gate:
 *
 *  1. negative scan — a third-party license token in the user-visible corpus
 *     (manuals, landings, legal pages, API metadata, lockfile self entry)
 *     must fail the gate;
 *  2. positive claims — a corpus carrying a license statement must say MIT,
 *     and the root package.json / LICENSE must keep the MIT contract.
 *
 * Fixtures are materialized in a temp tree (same pattern as
 * check-docs-markdown.test.mjs) so the tests never depend on the real repo's
 * document set.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLicenseGate } from "../check-license-claims.mjs";
import { MANUAL_FILES, manualPdfPath, manualSourcePath } from "../landing-registry.mjs";

let tmpRoot;

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  }
});

function makeRoot(files) {
  tmpRoot = mkdtempSync(join(tmpdir(), "license-claims-gate-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(tmpRoot, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return tmpRoot;
}

const MIT_LICENSE = `MIT License

Copyright (c) 2026 BookmarkForge

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.
`;

function contractFiles(extra = {}) {
  return {
    "package.json": JSON.stringify({ name: "x", license: "MIT" }),
    "LICENSE": MIT_LICENSE,
    [manualSourcePath("es")]: "**Licencia:** MIT\n",
    ...extra,
  };
}

describe("check-license-claims", () => {
  it("passes on a clean minimal tree (MIT manuals, MIT manifest, MIT LICENSE)", () => {
    const root = makeRoot(contractFiles());
    const { contractFailures, corpusFailures } = runLicenseGate(root);
    expect(contractFailures).toEqual([]);
    expect(corpusFailures).toEqual([]);
  });

  it("fails when a localized manual claims AGPL-3.0 in its license header", () => {
    const root = makeRoot(
      contractFiles({
        [manualSourcePath("de")]: "**Lizenz:** AGPL-3.0\n",
      }),
    );
    const { corpusFailures } = runLicenseGate(root);
    expect(corpusFailures.some((f) => f.includes(`${MANUAL_FILES.de}.md`))).toBe(true);
  });

  it("fails when the Legal section names a non-MIT code license", () => {
    const root = makeRoot(
      contractFiles({
        [manualSourcePath("es")]:
          "# Manual\n\n## 13. Legal\n\n- **Licencia del código:** AGPL-3.0-or-later\n",
      }),
    );
    const { corpusFailures } = runLicenseGate(root);
    expect(corpusFailures.some((f) => f.includes("AGPL"))).toBe(true);
  });

  it("fails when a landing translation table advertises a non-MIT license", () => {
    const root = makeRoot(
      contractFiles({
        "scripts/translations/pocket-alternative-en.json":
          '{ "rows": [ { "bookmarkforge": "✅ AGPL-3.0" } ] }\n',
      }),
    );
    const { corpusFailures } = runLicenseGate(root);
    expect(corpusFailures.some((f) => f.includes("pocket-alternative-en.json"))).toBe(true);
  });

  it("fails when the OpenAPI license block stops being MIT", () => {
    const root = makeRoot(
      contractFiles({
        "docs/openapi.yaml": "license:\n  name: Apache-2.0\n",
      }),
    );
    const { contractFailures, corpusFailures } = runLicenseGate(root);
    expect(contractFailures).toEqual([]);
    expect(corpusFailures.some((f) => f.includes("openapi.yaml"))).toBe(true);
  });

  it("fails when package.json drifts away from MIT", () => {
    const root = makeRoot({
      "package.json": JSON.stringify({ name: "x", license: "AGPL-3.0-or-later" }),
      "LICENSE": MIT_LICENSE,
      [manualSourcePath("es")]: "**Licencia:** MIT\n",
    });
    const { contractFailures } = runLicenseGate(root);
    expect(contractFailures.some((f) => f.includes("package.json"))).toBe(true);
  });

  it("fails when the root LICENSE text is swapped for another license", () => {
    const root = makeRoot({
      "package.json": JSON.stringify({ name: "x", license: "MIT" }),
      "LICENSE": "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n",
      [manualSourcePath("es")]: "**Licencia:** MIT\n",
    });
    const { contractFailures } = runLicenseGate(root);
    expect(contractFailures.some((f) => f.includes("LICENSE"))).toBe(true);
  });

  it("reports corpus entries that are missing from the tree instead of skipping them", () => {
    const root = makeRoot({
      "package.json": JSON.stringify({ name: "x", license: "MIT" }),
      "LICENSE": MIT_LICENSE,
      // no manual at all
    });
    const { corpusFailures, missing } = runLicenseGate(root);
    // Content problems stay empty: a missing file is a different failure class
    // (CI treats it as broken inventory), not a wrong license claim.
    expect(corpusFailures).toEqual([]);
    expect(missing).toContain(manualSourcePath("es"));
  });

  it("treats -styled.html and public-export overlay copies as optional (the public export re-curates them away)", () => {
    const root = makeRoot(
      contractFiles({
        // The styled twins and overlay sources are absent, as in the exported
        // public tree — this must NOT be reported as missing inventory.
      }),
    );
    const { missing } = runLicenseGate(root);
    expect(missing.some((f) => f.includes("-styled.html"))).toBe(false);
    expect(missing.some((f) => f.startsWith("scripts/public-export/"))).toBe(false);
    // ...but the required manual sources are still demanded (the .md ships in
    // contractFiles, the .pdf does not).
    expect(missing.some((f) => f === manualPdfPath("es"))).toBe(true);
  });

  it("ignores dependency license metadata deep in package-lock.json (dependency facts, not claims)", () => {
    const root = makeRoot(
      contractFiles({
        "package-lock.json": JSON.stringify({
          name: "x",
          version: "1.0.0",
          lockfileVersion: 3,
          requires: true,
          packages: {
            "": { name: "x", version: "1.0.0", license: "MIT" },
            "node_modules/dep": { license: "Apache-2.0" },
          },
        }) + "\n",
      }),
    );
    const { corpusFailures } = runLicenseGate(root);
    expect(corpusFailures).toEqual([]);
  });

  it("fails when the package-lock.json self entry drifts to a non-MIT license", () => {
    const root = makeRoot(
      contractFiles({
        "package-lock.json": [
          "{",
          '  "name": "x",',
          '  "version": "1.0.0",',
          '  "lockfileVersion": 3,',
          '  "requires": true,',
          '  "packages": {',
          '    "": {',
          '      "name": "x",',
          '      "version": "1.0.0",',
          '      "license": "AGPL-3.0-or-later",',
          "      \"dependencies\": {}",
          "    },",
          "  },",
          "}",
          "",
        ].join("\n"),
      }),
    );
    const { corpusFailures } = runLicenseGate(root);
    expect(corpusFailures.some((f) => f.includes("package-lock.json"))).toBe(true);
  });

  it("fails on a PDF manual that embeds a non-MIT license token", () => {
    // A fake-but-plausible PDF body: the gate's extractor scores printable
    // ASCII runs that look like license vocabulary, so this is enough to pin
    // the PDF path without shipping a real generated PDF in fixtures. The
    // Spanish manual IS docs/manual-de-usuario-es.pdf (endonym + locale).
    const pdfBody = [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "4 0 obj << /Length 120 >> stream",
      "BT /F1 12 Tf (Licencia: AGPL-3.0-or-later) Tj ET",
      "endstream endobj",
      "trailer << /Root 1 0 R >>",
      "%%EOF",
    ].join("\n");
    const root = makeRoot(
      contractFiles({ [manualPdfPath("es")]: pdfBody }),
    );
    const { corpusFailures } = runLicenseGate(root);
    expect(corpusFailures.some((f) => f.includes(manualPdfPath("es")))).toBe(true);
  });

  it("does not flag the word MIT itself nor innocuous copy", () => {
    const root = makeRoot(
      contractFiles({
        [manualSourcePath("en")]: "**License:** MIT — see LICENSE for details.\n",
        "public/privacy-and-terms.html": "<p>Lifetime license for v1. No subscription.</p>\n",
      }),
    );
    const { corpusFailures } = runLicenseGate(root);
    expect(corpusFailures).toEqual([]);
  });
});
