import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * P1 regression — private content must never leave the device via WebRTC P2P
 * sync. The selectors in `startSync()` must exclude `isPrivate: true` docs and
 * bookmarks (same guarantee the "Force local AI" flag gives to the AI stack:
 * what is private stays local). This test scans the source so the guarantee
 * cannot silently regress when the sync loop is refactored.
 *
 * The schema already carries the compound index ["isPrivate", "isDeleted",
 * "createdAt"] for both collections, so the added selector field is
 * index-backed and does not degrade query performance.
 */
describe("P1 regression — WebRTC sync excludes private content", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../services/WebRTCSyncService.ts"),
    "utf-8",
  );

  it("documentSelector filters isPrivate:false and does NOT filter isDeleted (tombstones travel)", () => {
    // Slice the documentSelector object literal (up to the closing "as never").
    const start = src.indexOf("const documentSelector = {");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = src.indexOf("as never;", start);
    const selector = src.slice(start, end);
    expect(selector).toMatch(/isPrivate:\s*false/);
    // Tombstone invariant: deleted docs (isDeleted: true) are sent so the
    // receiver can apply removals with last-write-wins by updatedAt. A
    // selector that filters them resurrects locally deleted docs from the
    // peer's stale mirror.
    expect(selector).not.toMatch(/isDeleted/);
  });

  it("bookmarkSelector filters isPrivate:false and does NOT filter isDeleted (tombstones travel)", () => {
    const start = src.indexOf("const bookmarkSelector = {");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = src.indexOf("as never;", start);
    const selector = src.slice(start, end);
    expect(selector).toMatch(/isPrivate:\s*false/);
    expect(selector).not.toMatch(/isDeleted/);
  });
});
