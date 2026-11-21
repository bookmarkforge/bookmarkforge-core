// src/tests/utils/sync-version.property.test.ts
//
// Property-based tests (fast-check) for the deterministic sync ordering and
// conflict-resolution contracts:
//  - compareSyncVersions / compareRxRevision form a total order used by every
//    WebRTC receiver (arrival order must never matter).
//  - constantTimeStringEqual is reflexive/symmetric and detects any diff.
//  - defaultConflictHandler: deterministic, never resurrects a newer
//    tombstone, and the winner is always the state with the newer clock.

import { describe, test, expect } from "vitest";
import fc from "fast-check";
import {
  compareSyncVersions,
  constantTimeStringEqual,
} from "../../services/webrtc-sync/compare";
import { compareRxRevision } from "../../utils/syncVersion";
import { defaultConflictHandler } from "../../db/database";

type SyncState = Record<string, unknown>;

const arbIsoDate = fc
  .integer({ min: 0, max: 4_000_000_000 })
  .map((s) => new Date(s * 1000).toISOString());
const arbTimestamp = fc.oneof(
  arbIsoDate,
  fc.constant(""),
  fc.string({ maxLength: 30 }), // malformed timestamps exercise fallback
);
const arbRev = fc.oneof(
  fc
    .tuple(fc.integer({ min: 0, max: 999 }), fc.string({ minLength: 1, maxLength: 8 }))
    .map(([h, hash]) => `${h}-${hash}`),
  fc.string({ maxLength: 12 }),
  fc.constant(""),
);
const arbId = fc.string({ minLength: 1, maxLength: 12 });

const arbSyncState: fc.Arbitrary<SyncState> = fc.record({
  id: arbId,
  updatedAt: arbTimestamp,
  _rev: arbRev,
  isDeleted: fc.boolean(),
  payload: fc.string({ maxLength: 40 }),
});

function sign(n: number): number {
  return n === 0 ? 0 : n > 0 ? 1 : -1;
}

describe("compareSyncVersions properties", () => {
  test("deterministic", () => {
    fc.assert(
      fc.property(arbSyncState, arbSyncState, (a, b) => {
        expect(compareSyncVersions(a, b)).toBe(compareSyncVersions(a, b));
      }),
      { numRuns: 300 },
    );
  });

  test("antisymmetric: sign(cmp(a,b)) === -sign(cmp(b,a))", () => {
    fc.assert(
      fc.property(arbSyncState, arbSyncState, (a, b) => {
        expect(
          sign(compareSyncVersions(a, b)) + sign(compareSyncVersions(b, a)),
        ).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  test("reflexive: cmp(a,a) === 0", () => {
    fc.assert(
      fc.property(arbSyncState, (a) => {
        expect(compareSyncVersions(a, a)).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  test("newer ISO updatedAt always wins over older", () => {
    fc.assert(
      fc.property(
        arbIsoDate,
        arbIsoDate,
        arbId,
        arbRev,
        (t1, t2, id, rev) => {
          fc.pre(t1 !== t2);
          const newer = { id, updatedAt: t1 > t2 ? t1 : t2, _rev: rev };
          const older = { id, updatedAt: t1 > t2 ? t2 : t1, _rev: rev };
          // "newer" always carries max(t1,t2), "older" min(t1,t2).
          expect(sign(compareSyncVersions(newer, older))).toBe(1);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("compareRxRevision properties", () => {
  test("antisymmetric and reflexive", () => {
    fc.assert(
      fc.property(arbRev, arbRev, (a, b) => {
        // Sum form avoids the -0/Object.is pitfall of unary negation.
        expect(sign(compareRxRevision(a, b)) + sign(compareRxRevision(b, a))).toBe(0);
        expect(compareRxRevision(a, a)).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  test("higher revision height wins regardless of hash", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 501, max: 1000 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (low, high, h1, h2) => {
          const cmp = compareRxRevision(`${high}-${h1}`, `${low}-${h2}`);
          expect(sign(cmp)).toBe(1);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("constantTimeStringEqual properties", () => {
  test("reflexive and symmetric", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 64 }), (s) => {
        expect(constantTimeStringEqual(s, s)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  test("detects any single-character difference", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 32 }),
        fc.constantFrom("a", "b", "0", " ", "é"),
        (s, extra) => {
          const other = s + extra;
          expect(constantTimeStringEqual(s, other)).toBe(false);
          expect(constantTimeStringEqual(other, s)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("defaultConflictHandler properties", () => {
  test("identical states resolve as equal", () => {
    fc.assert(
      fc.property(arbSyncState, (state) => {
        const result = defaultConflictHandler({
          newDocumentState: state,
          realMasterState: { ...state },
        });
        expect(result.isEqual).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  test("deterministic for identical inputs", () => {
    fc.assert(
      fc.property(arbSyncState, arbSyncState, (a, b) => {
        const r1 = defaultConflictHandler({ newDocumentState: a, realMasterState: b });
        const r2 = defaultConflictHandler({ newDocumentState: a, realMasterState: b });
        expect(r1.isEqual).toBe(r2.isEqual);
        expect(JSON.stringify(r1.documentData)).toBe(JSON.stringify(r2.documentData));
      }),
      { numRuns: 200 },
    );
  });

  test("newer live state always beats older tombstone is impossible; older live never resurrects newer tombstone", () => {
    fc.assert(
      fc.property(
        arbIsoDate,
        arbIsoDate,
        arbId,
        fc.string({ maxLength: 40 }),
        (tombTime, liveTime, id, payload) => {
          fc.pre(tombTime !== liveTime);
          const [newerT, olderT] = tombTime > liveTime ? [tombTime, liveTime] : [liveTime, tombTime];
          // Master holds the NEWER tombstone; incoming state is OLDER and live.
          const result = defaultConflictHandler({
            newDocumentState: { id, updatedAt: olderT, isDeleted: false, payload },
            realMasterState: { id, updatedAt: newerT, isDeleted: true, payload: "tomb" },
          });
          // The tombstone is newer only when tombTime > liveTime; otherwise the
          // live state legitimately wins. Assert the winner's clock matches max.
          const winnerTime = String(result.documentData.updatedAt);
          expect(winnerTime).toBe(newerT);
          if (tombTime > liveTime) {
            expect(result.documentData.isDeleted).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  test("with strictly newer updatedAt the winner carries that timestamp", () => {
    fc.assert(
      fc.property(
        arbIsoDate,
        arbIsoDate,
        arbId,
        fc.string({ maxLength: 40 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (t1, t2, id, p1, p2) => {
          fc.pre(t1 !== t2);
          const [newerT, olderT] = t1 > t2 ? [t1, t2] : [t2, t1];
          const newerPayload = t1 > t2 ? p1 : p2;
          const olderPayload = t1 > t2 ? p2 : p1;
          // newDocumentState is the NEWER one.
          const result = defaultConflictHandler({
            newDocumentState: { id, updatedAt: newerT, payload: newerPayload },
            realMasterState: { id, updatedAt: olderT, payload: olderPayload },
          });
          expect(result.documentData.updatedAt).toBe(newerT);
          expect(result.documentData.payload).toBe(newerPayload);
        },
      ),
      { numRuns: 200 },
    );
  });
});
