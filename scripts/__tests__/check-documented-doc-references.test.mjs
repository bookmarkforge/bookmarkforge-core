// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractReferencesFromLine,
  extractRoutePolicies,
  scanDocumentReferences,
} from "../check-documented-doc-references.mjs";

function fixture({ document, routeTable = 'path: "/health"' }) {
  const root = mkdtempSync(join(tmpdir(), "doc-ref-gate-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "server", "src"), { recursive: true });
  writeFileSync(join(root, "README.md"), document);
  writeFileSync(
    join(root, "docs", "docs-state-index.md"),
    [
      "| Documento | Estado | Nota |",
      "|---|---|---|",
      "| `docs/docs-state-index.md` | vivo | index |",
      "",
    ].join("\n"),
  );
  writeFileSync(join(root, "server", "src", "route-table.ts"), routeTable);
  return root;
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
