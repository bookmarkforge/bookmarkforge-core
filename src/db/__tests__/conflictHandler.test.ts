import { describe, it, expect } from "vitest";
import { defaultConflictHandler } from "../../db/database";

describe("DB Conflict Handler", () => {
  describe("defaultConflictHandler", () => {
    it("should prefer higher revision height", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "2-abc", updatedAt: "2024-01-01T00:00:00Z" },
        realMasterState: { _rev: "1-xyz", updatedAt: "2024-01-01T00:00:00Z" },
      });
      expect(result.documentData._rev).toBe("2-abc");
      expect(result.isEqual).toBe(false);
    });

    it("compares two-digit revision heights numerically, not lexically", () => {
      const result = defaultConflictHandler({
        newDocumentState: {
          _rev: "9-newer-lexically",
          updatedAt: "2024-01-01T00:00:00Z",
        },
        realMasterState: {
          _rev: "10-logically-newer",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      });

      expect(result.documentData._rev).toBe("10-logically-newer");
    });

    it("should prefer master when new revision is lower", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "1-abc", updatedAt: "2024-01-01T00:00:00Z" },
        realMasterState: { _rev: "3-xyz", updatedAt: "2024-01-01T00:00:00Z" },
      });
      expect(result.documentData._rev).toBe("3-xyz");
    });

    it("should use updatedAt when revisions are equal", () => {
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "1-abc", updatedAt: "2024-01-02T00:00:00Z" },
        realMasterState: { _rev: "1-xyz", updatedAt: "2024-01-01T00:00:00Z" },
      });
      expect(result.documentData.updatedAt).toBe("2024-01-02T00:00:00Z");
    });

    it("should merge blocks intelligently", () => {
      const result = defaultConflictHandler({
        newDocumentState: {
          _rev: "1-abc",
          updatedAt: "2024-01-01T00:00:00Z",
          blocks: [
            { id: "block1", content: "new" },
            { id: "block3", content: "added" },
          ],
        },
        realMasterState: {
          _rev: "1-xyz",
          updatedAt: "2024-01-01T00:00:00Z",
          blocks: [
            { id: "block1", content: "old" },
            { id: "block2", content: "existing" },
          ],
        },
      });
      const mergedBlocks = result.documentData.blocks as any[];
      expect(mergedBlocks.length).toBeGreaterThan(2);
      expect(mergedBlocks.some((b: any) => b.id === "block3")).toBe(true);
    });

    it("should use the revision as a deterministic fallback", () => {
      // The persisted master position is not a tie-break: the same pair must
      // resolve identically on every peer, regardless of arrival direction.
      const result = defaultConflictHandler({
        newDocumentState: { _rev: "1-bbb" },
        realMasterState: { _rev: "1-aaa" },
      });
      expect(result.documentData._rev).toBe("1-bbb");
    });

    it("should handle missing revisions gracefully", () => {
      const result = defaultConflictHandler({
        newDocumentState: { updatedAt: "2024-01-02T00:00:00Z" },
        realMasterState: { updatedAt: "2024-01-01T00:00:00Z" },
      });
      expect(result.isEqual).toBe(false);
      expect(result.documentData).toBeDefined();
    });

    it("should handle blocks without IDs", () => {
      const result = defaultConflictHandler({
        newDocumentState: {
          _rev: "1-abc",
          updatedAt: "2024-01-01T00:00:00Z",
          blocks: [{ content: "no-id" }],
        },
        realMasterState: {
          _rev: "1-xyz",
          updatedAt: "2024-01-01T00:00:00Z",
          blocks: [{ id: "block1", content: "with-id" }],
        },
      });
      const mergedBlocks = result.documentData.blocks as any[];
      expect(mergedBlocks.length).toBeGreaterThan(1);
    });

    it("resolves the same pair identically in either arrival direction", () => {
      const left = {
        id: "doc-1",
        _rev: "1-aaa",
        updatedAt: "2024-01-01T00:00:00Z",
        blocks: [{ id: "block-a" }],
      };
      const right = {
        id: "doc-1",
        _rev: "1-bbb",
        updatedAt: "2024-01-01T00:00:00Z",
        blocks: [{ id: "block-b" }],
      };

      const forward = defaultConflictHandler({
        newDocumentState: left,
        realMasterState: right,
      });
      const reverse = defaultConflictHandler({
        newDocumentState: right,
        realMasterState: left,
      });

      expect(forward.documentData).toEqual(reverse.documentData);
      expect(forward.documentData._rev).toBe("1-bbb");
    });

    it("uses document id when timestamp and revision are equal", () => {
      const lowerId = {
        id: "doc-a",
        _rev: "1-same",
        updatedAt: "2024-01-01T00:00:00Z",
      };
      const higherId = {
        id: "doc-b",
        _rev: "1-same",
        updatedAt: "2024-01-01T00:00:00Z",
      };
      const forward = defaultConflictHandler({
        newDocumentState: lowerId,
        realMasterState: higherId,
      });
      const reverse = defaultConflictHandler({
        newDocumentState: higherId,
        realMasterState: lowerId,
      });

      expect(forward.documentData).toEqual(reverse.documentData);
      expect(forward.documentData.id).toBe("doc-b");
    });

    it("resolves a newer tombstone with LWW and never merges it", () => {
      const live = {
        id: "doc-1",
        _rev: "9-live",
        updatedAt: "2024-01-01T00:00:00Z",
        isDeleted: false,
        blocks: [{ id: "keep" }],
      };
      const tombstone = {
        id: "doc-1",
        _rev: "1-delete",
        updatedAt: "2024-01-02T00:00:00Z",
        isDeleted: true,
        blocks: [],
      };

      const forward = defaultConflictHandler({
        newDocumentState: tombstone,
        realMasterState: live,
      });
      const reverse = defaultConflictHandler({
        newDocumentState: live,
        realMasterState: tombstone,
      });

      expect(forward.documentData).toEqual(reverse.documentData);
      expect(forward.documentData.isDeleted).toBe(true);
      expect(forward.documentData.blocks).toEqual([]);
    });

    it("does not union a winning subset, preserving a block deletion", () => {
      const subset = {
        id: "doc-1",
        _rev: "1-zzz",
        updatedAt: "2024-01-01T00:00:00Z",
        blocks: [{ id: "kept" }],
      };
      const superset = {
        id: "doc-1",
        _rev: "1-aaa",
        updatedAt: "2024-01-01T00:00:00Z",
        blocks: [{ id: "kept" }, { id: "deleted-on-subset-branch" }],
      };

      const result = defaultConflictHandler({
        newDocumentState: subset,
        realMasterState: superset,
      });
      const reverse = defaultConflictHandler({
        newDocumentState: superset,
        realMasterState: subset,
      });

      expect(result.documentData).toEqual(reverse.documentData);
      expect(result.documentData._rev).toBe("1-zzz");
      expect(result.documentData.blocks).toEqual([{ id: "kept" }]);
    });

    it("converges for three peers regardless of pairwise arrival order", () => {
      type PeerState = {
        id: string;
        _rev: string;
        updatedAt: string;
        blocks: Array<{ id: string }>;
      };
      const peers: PeerState[] = [
        { id: "doc-1", _rev: "1-a", updatedAt: "2024-01-01T00:00:00Z", blocks: [{ id: "a" }] },
        { id: "doc-1", _rev: "1-b", updatedAt: "2024-01-01T00:00:00Z", blocks: [{ id: "b" }] },
        { id: "doc-1", _rev: "1-c", updatedAt: "2024-01-01T00:00:00Z", blocks: [{ id: "c" }] },
      ];
      const resolve = (left: PeerState, right: PeerState): PeerState =>
        defaultConflictHandler({
          newDocumentState: left,
          realMasterState: right,
        }).documentData as PeerState;
      const fold = (order: PeerState[]): PeerState =>
        order.slice(1).reduce(resolve, order[0]!);

      const results = [
        fold([peers[0]!, peers[1]!, peers[2]!]),
        fold([peers[0]!, peers[2]!, peers[1]!]),
        fold([peers[1]!, peers[0]!, peers[2]!]),
        fold([peers[1]!, peers[2]!, peers[0]!]),
        fold([peers[2]!, peers[0]!, peers[1]!]),
        fold([peers[2]!, peers[1]!, peers[0]!]),
      ];

      for (const result of results.slice(1)) {
        expect(result).toEqual(results[0]);
      }
      expect(results[0]!.blocks).toEqual([
        { id: "a" },
        { id: "b" },
        { id: "c" },
      ]);
      expect(results[0]!._rev).toBe("1-c");
    });
  });
});
