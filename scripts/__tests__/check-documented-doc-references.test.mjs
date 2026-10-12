// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RELATIVE_LINK_BASELINE_PATH,
  RELATIVE_LINK_BASELINE_SCHEMA,
  RELATIVE_LINK_FINGERPRINT,
  extractReferencesFromLine,
  extractRelativeLinkTargets,
  extractRoutePolicies,
  scanDocumentReferences,
} from "../check-documented-doc-references.mjs";

function fixture({
  document,
  documentPath = "README.md",
  routeTable = 'path: "/health"',
  files = {},
  baseline,
}) {
  const root = mkdtempSync(join(tmpdir(), "doc-ref-gate-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "server", "src"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  const documentAbsolute = join(root, documentPath);
  mkdirSync(join(documentAbsolute, ".."), { recursive: true });
  writeFileSync(documentAbsolute, document);
  writeFileSync(
    join(root, "docs", "docs-state-index.md"),
    [
      "| Documento | Estado | Nota |",
      "|---|---|---|",
      "| `docs/docs-state-index.md` | vivo | index |",
      // A document is only part of the live corpus when the index lists it as
      // `vivo`; the fixtures register themselves the same way the real one does.
      ...(documentPath.startsWith("docs/")
        ? [`| \`${documentPath}\` | vivo | fixture |`]
        : []),
      "",
    ].join("\n"),
  );
  writeFileSync(join(root, "server", "src", "route-table.ts"), routeTable);
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolute = join(root, relativePath);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, contents);
  }
  if (baseline) writeFileSync(join(root, RELATIVE_LINK_BASELINE_PATH), JSON.stringify(baseline, null, 2));
  return root;
}

function scanned(root) {
  return scanDocumentReferences({
    root,
    stateIndexText: requireText(root, "docs/docs-state-index.md"),
    routeTableText: requireText(root, "server/src/route-table.ts"),
  });
}

describe("check-documented-doc-references", () => {
  it("extracts local paths and routes without treating wildcards as concrete references", () => {
    expect(extractReferencesFromLine("See `docs/api.md` and GET /api/license/health."))
      .toEqual({
        localPaths: ["docs/api.md"],
        routes: ["/api/license/health"],
      });
    expect(extractReferencesFromLine("The family /api/analytics/* is documented here."))
      .toEqual({ localPaths: [], routes: [] });
  });

  it("extracts declared route paths from the route table", () => {
    expect(extractRoutePolicies('path: "/health", path: "/api/client-events", path: "/health"'))
      .toEqual(["/health", "/api/client-events"]);
  });

  it("passes when local files and concrete routes resolve", () => {
    const root = fixture({
      document: "# Guide\n\nSee `docs/docs-state-index.md` and GET /health.\n",
    });
    try {
      const result = scanDocumentReferences({
        root,
        stateIndexText: requireText(root, "docs/docs-state-index.md"),
        routeTableText: requireText(root, "server/src/route-table.ts"),
      });
      expect(result.ok).toBe(true);
      expect(result.missingFiles).toEqual([]);
      expect(result.retiredRoutes).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports the exact line for a missing local file", () => {
    const root = fixture({ document: "# Guide\n\nSee `docs/gone.md`.\n" });
    try {
      const result = scanDocumentReferences({
        root,
        stateIndexText: requireText(root, "docs/docs-state-index.md"),
        routeTableText: requireText(root, "server/src/route-table.ts"),
      });
      expect(result.ok).toBe(false);
      expect(result.missingFiles).toEqual([
        { file: "README.md", line: 3, reference: "docs/gone.md" },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves relative Markdown links the way a reader's client does", () => {
    expect(extractRelativeLinkTargets("See [the manual](user-manual-ar.md).")).toEqual([
      "user-manual-ar.md",
    ]);
    expect(extractRelativeLinkTargets("See [policy](../TRADEMARKS.md) and [spec](./api.md#top)")).toEqual([
      "../TRADEMARKS.md",
      "./api.md",
    ]);
    // External, root-relative, anchor-only targets and non-document extensions
    // are not files we ship.
    expect(
      extractRelativeLinkTargets(
        "[a](https://example.com/x.md) [b](/docs/x.md) [c](#section) [d](image.png) [e](mailto:x@y.z)",
      ),
    ).toEqual([]);
  });

  it("fails on a bare-basename link that does not resolve", () => {
    const root = fixture({ document: "# Guide\n\nSee [manual](user-manual-ar.md).\n" });
    try {
      const result = scanned(root);
      expect(result.ok).toBe(false);
      expect(result.missingRelativeLinks).toEqual([
        { file: "README.md", line: 3, reference: "user-manual-ar.md" },
      ]);
      expect(result.baselineIssues.join(" ")).toMatch(/no baseline/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes a relative link that resolves, including a parent-relative one", () => {
    const root = fixture({
      document: "# Guide\n\nSee [manual](user-manual-en.md) and [policy](../TRADEMARKS.md).\n",
      documentPath: "docs/index.md",
      files: {
        "docs/user-manual-en.md": "# Manual\n",
        "TRADEMARKS.md": "# Trademarks\n",
      },
    });
    try {
      const result = scanned(root);
      expect(result.ok).toBe(true);
      expect(result.missingRelativeLinks).toEqual([]);
      expect(result.relativeLinkReferences).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("tolerates a dangling link only while the baseline explains it", () => {
    const document = "# Guide\n\nSee [manual](user-manual-ar.md).\n";
    const explained = fixture({
      document,
      baseline: {
        schema: RELATIVE_LINK_BASELINE_SCHEMA,
        fingerprint: RELATIVE_LINK_FINGERPRINT,
        knownMissingLinks: [
          { file: "README.md", reference: "user-manual-ar.md", reason: "Awaiting the translated manual." },
        ],
      },
    });
    const unexplained = fixture({
      document,
      baseline: {
        schema: RELATIVE_LINK_BASELINE_SCHEMA,
        fingerprint: RELATIVE_LINK_FINGERPRINT,
        knownMissingLinks: [{ file: "README.md", reference: "user-manual-ar.md", reason: "" }],
      },
    });
    try {
      expect(scanned(explained).ok).toBe(true);
      const result = scanned(unexplained);
      expect(result.ok).toBe(false);
      expect(result.baselineIssues.join(" ")).toMatch(/needs a reason/);
    } finally {
      rmSync(explained, { recursive: true, force: true });
      rmSync(unexplained, { recursive: true, force: true });
    }
  });

  it("fails when a baselined link resolves again, so the ratchet shrinks", () => {
    const root = fixture({
      document: "# Guide\n\nNothing relative here.\n",
      baseline: {
        schema: RELATIVE_LINK_BASELINE_SCHEMA,
        fingerprint: RELATIVE_LINK_FINGERPRINT,
        knownMissingLinks: [
          { file: "README.md", reference: "user-manual-ar.md", reason: "Paid since this entry was written." },
        ],
      },
    });
    try {
      const result = scanned(root);
      expect(result.ok).toBe(false);
      expect(result.staleRelativeLinks).toEqual([
        { file: "README.md", reference: "user-manual-ar.md", reason: "Paid since this entry was written." },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the baseline scope fingerprint moved", () => {
    const root = fixture({
      document: "# Guide\n\nSee [manual](user-manual-ar.md).\n",
      baseline: {
        schema: RELATIVE_LINK_BASELINE_SCHEMA,
        fingerprint: "relative-links/v0: an older, narrower rule",
        knownMissingLinks: [
          { file: "README.md", reference: "user-manual-ar.md", reason: "Frozen before the rule moved." },
        ],
      },
    });
    try {
      const result = scanned(root);
      expect(result.ok).toBe(false);
      expect(result.baselineIssues.join(" ")).toMatch(/fingerprint does not match/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a concrete route that is no longer declared", () => {
    const root = fixture({ document: "# Guide\n\nProbe /api/services/ai/session.\n" });
    try {
      const result = scanDocumentReferences({
        root,
        stateIndexText: requireText(root, "docs/docs-state-index.md"),
        routeTableText: requireText(root, "server/src/route-table.ts"),
      });
      expect(result.ok).toBe(false);
      expect(result.retiredRoutes).toEqual([
        { file: "README.md", line: 3, reference: "/api/services/ai/session" },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function requireText(root, relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}
