import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { defaultConflictHandler } from "../../db/database.core";

type ConcurrentEdit = {
  id: string;
  _rev: string;
  updatedAt: string;
  blocks: Array<{ id: string }>;
  isDeleted?: boolean;
};

type Scenario = {
  peerCount: number;
  editsPerPeer: number;
  orderSeeds: number[];
};

const scenarioArbitrary: fc.Arbitrary<Scenario> = fc.record({
  peerCount: fc.integer({ min: 2, max: 5 }),
  editsPerPeer: fc.integer({ min: 1, max: 5 }),
  // Six independent arrival orders per generated scenario. The final order
  // is always a permutation because shuffle() uses the original index as a
  // deterministic tie-break.
  orderSeeds: fc.array(fc.integer(), { minLength: 6, maxLength: 6 }),
});

function makeConcurrentEdits(
  peerCount: number,
  editsPerPeer: number,
): ConcurrentEdit[] {
  const edits: ConcurrentEdit[] = [];
  for (let peer = 0; peer < peerCount; peer++) {
    for (let edit = 0; edit < editsPerPeer; edit++) {
      edits.push({
        id: "doc-1",
        _rev: `1-p${String(peer).padStart(2, "0")}-e${String(edit).padStart(2, "0")}`,
        // Equal timestamps model concurrent writes; revision is the next
        // deterministic clock component.
        updatedAt: "2026-01-01T00:00:00.000Z",
        blocks: [{ id: `peer-${peer}-edit-${edit}` }],
      });
    }
  }
  return edits;
}

function mixSeed(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b9)) | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value | 0;
}

function shuffle<T>(values: readonly T[], seed: number): T[] {
  return values
    .map((value, index) => ({
      value,
      index,
      key: mixSeed(seed, index),
    }))
    .sort((left, right) => left.key - right.key || left.index - right.index)
    .map(({ value }) => value);
}

function resolve(left: ConcurrentEdit, right: ConcurrentEdit): ConcurrentEdit {
  return defaultConflictHandler({
    newDocumentState: left,
    realMasterState: right,
  }).documentData as ConcurrentEdit;
}

function foldArrivalOrder(order: readonly ConcurrentEdit[]): ConcurrentEdit {
  return order.slice(1).reduce(resolve, order[0]!);
}

describe("Property-based: conflict handler convergence", () => {
  it("converges for N peers × M concurrent edits under randomized arrival orders", () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const edits = makeConcurrentEdits(
          scenario.peerCount,
          scenario.editsPerPeer,
        );
        const finalStates = scenario.orderSeeds.map((seed) =>
          foldArrivalOrder(shuffle(edits, seed)),
        );

        for (const state of finalStates.slice(1)) {
          expect(state).toEqual(finalStates[0]);
        }

        const finalState = finalStates[0]!;
        const expectedBlockIds = edits
          .map((edit) => edit.blocks[0]!.id)
          .sort();
        const actualBlockIds = finalState.blocks.map((block) => block.id).sort();
        expect(actualBlockIds).toEqual(expectedBlockIds);
        expect(finalState._rev).toBe(
          edits[edits.length - 1]!._rev,
        );
      }),
      {
        numRuns: 300,
        endOnFailure: true,
      },
    );
  });

  it("keeps a newer tombstone regardless of randomized arrival order", () => {
    const liveBlocksArbitrary = fc.uniqueArray(
      fc.string({ minLength: 1, maxLength: 12 }),
      { minLength: 1, maxLength: 8 },
    );

    fc.assert(
      fc.property(liveBlocksArbitrary, (blockIds) => {
        const live: ConcurrentEdit = {
          id: "doc-1",
          _rev: "9-live",
          updatedAt: "2026-01-01T00:00:00.000Z",
          isDeleted: false,
          blocks: blockIds.map((id) => ({ id })),
        };
        const tombstone: ConcurrentEdit = {
          id: "doc-1",
          _rev: "1-delete",
          updatedAt: "2026-01-02T00:00:00.000Z",
          isDeleted: true,
          blocks: [],
        };

        const forward = resolve(tombstone, live);
        const reverse = resolve(live, tombstone);
        expect(forward).toEqual(reverse);
        expect(forward.isDeleted).toBe(true);
        expect(forward.blocks).toEqual([]);
      }),
      {
        numRuns: 300,
        endOnFailure: true,
      },
    );
  });
});
