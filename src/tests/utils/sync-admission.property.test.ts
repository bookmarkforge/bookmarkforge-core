// src/tests/utils/sync-admission.property.test.ts
//
// Property-based tests (fast-check) for shouldApplyIncomingSyncDoc — the pure
// LWW admission decision extracted from WebRTCSyncService.upsertBatch. The
// contract under test:
//  1. No local copy            -> incoming applies.
//  2. local.isPrivate === true -> NEVER overwritten (any incoming version).
//  3. Otherwise                -> applies iff compareSyncVersions(incoming, local) > 0.
// These properties must hold for every generated pair, independent of arrival
// order, so a stale peer snapshot can never regress local state.

import { describe, test, expect } from "vitest";
import fc from "fast-check";
import {
  compareSyncVersions,
  shouldApplyIncomingSyncDoc,
} from "../../services/webrtc-sync/compare";

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

// Local states may carry isPrivate as any runtime value — only strict `true`
// is protected; truthy strings/numbers must NOT trigger the guard.
const arbLocalState: fc.Arbitrary<SyncState> = fc.record({
  id: arbId,
  updatedAt: arbTimestamp,
  _rev: arbRev,
  isDeleted: fc.boolean(),
  isPrivate: fc.oneof(
    fc.constant(true),
    fc.constant(false),
    fc.constant(undefined),
    fc.string({ maxLength: 6 }),
    fc.integer({ min: -3, max: 3 }),
  ),
  payload: fc.string({ maxLength: 40 }),
});

// Incoming wire docs: same shape, isPrivate may also appear (remote docs
// can claim privacy, but the guard keys on the LOCAL record only).
const arbIncomingDoc: fc.Arbitrary<SyncState> = fc.record({
  id: arbId,
  updatedAt: arbTimestamp,
  _rev: arbRev,
  isDeleted: fc.boolean(),
  isPrivate: fc.boolean(),
  payload: fc.string({ maxLength: 40 }),
});

describe("shouldApplyIncomingSyncDoc properties", () => {
  test("no local copy -> incoming always applies", () => {
    fc.assert(
      fc.property(arbIncomingDoc, (incoming) => {
        expect(shouldApplyIncomingSyncDoc(incoming, null)).toBe(true);
      }),
    );
  });

  test("local isPrivate === true -> never overwritten, even by newer versions", () => {
    fc.assert(
      fc.property(arbIncomingDoc, arbLocalState, (incoming, localBase) => {
        const local: SyncState = { ...localBase, isPrivate: true };
        // Force the incoming doc to be unambiguously newer; protection must
        // still hold — privacy trumps LWW.
        const newerIncoming: SyncState = {
          ...incoming,
          updatedAt: "2999-01-01T00:00:00.000Z",
          _rev: "999-deadbeef",
        };
        expect(shouldApplyIncomingSyncDoc(newerIncoming, local)).toBe(false);
        expect(shouldApplyIncomingSyncDoc(incoming, local)).toBe(false);
      }),
    );
  });

  test("non-true isPrivate values do NOT trigger the private guard", () => {
    fc.assert(
      fc.property(arbIncomingDoc, arbLocalState, (incoming, local) => {
        fc.pre(local.isPrivate !== true);
        // Decision must reduce to the pure LWW comparison.
        expect(shouldApplyIncomingSyncDoc(incoming, local)).toBe(
          compareSyncVersions(incoming, local) > 0,
        );
      }),
    );
  });

  test("applies iff strictly newer — stale/equal versions never rewrite", () => {
    fc.assert(
      fc.property(arbIncomingDoc, arbLocalState, (incoming, localBase) => {
        fc.pre(localBase.isPrivate !== true);
        const applied = shouldApplyIncomingSyncDoc(incoming, localBase);
        const cmp = compareSyncVersions(incoming, localBase);
        expect(applied).toBe(cmp > 0);
        if (cmp <= 0) {
          expect(applied).toBe(false);
        }
      }),
    );
  });

  test("strictly newer updatedAt always applies (non-private)", () => {
    fc.assert(
      fc.property(
        arbIncomingDoc,
        arbLocalState,
        fc.integer({ min: 1, max: 100_000 }),
        (incomingBase, localBase, deltaSec) => {
          fc.pre(localBase.isPrivate !== true);
          const older = new Date(
            Date.parse("2020-01-01T00:00:00.000Z") + deltaSec * 1000,
          ).toISOString();
          const newer = new Date(Date.parse(older) + 60_000).toISOString();
          const olderDoc: SyncState = { ...incomingBase, updatedAt: older };
          const newerDoc: SyncState = { ...incomingBase, updatedAt: newer };
          const local: SyncState = { ...localBase, updatedAt: older };
          expect(shouldApplyIncomingSyncDoc(newerDoc, local)).toBe(true);
          expect(
            shouldApplyIncomingSyncDoc(olderDoc, {
              ...localBase,
              updatedAt: newer,
            }),
          ).toBe(false);
        },
      ),
    );
  });

  test("equal versions are a no-op in both directions", () => {
    fc.assert(
      fc.property(arbIncomingDoc, arbLocalState, (incoming, _localBase) => {
        // Identical non-private content => compareSyncVersions === 0 =>
        // never applies, in either direction.
        const doc: SyncState = { ...incoming, isPrivate: false };
        const local: SyncState = { ...doc };
        expect(compareSyncVersions(doc, local)).toBe(0);
        expect(shouldApplyIncomingSyncDoc(doc, local)).toBe(false);
        expect(shouldApplyIncomingSyncDoc(local, doc)).toBe(false);
      }),
    );
  });

  test("decision is deterministic and antisymmetric for non-private pairs", () => {
    fc.assert(
      fc.property(arbIncomingDoc, arbLocalState, (incoming, local) => {
        const first = shouldApplyIncomingSyncDoc(incoming, local);
        const second = shouldApplyIncomingSyncDoc(incoming, local);
        expect(first).toBe(second);
        // For non-private pairs the relation is antisymmetric: at most one
        // direction may apply, and only when versions differ.
        if (local.isPrivate !== true) {
          const reverse = shouldApplyIncomingSyncDoc(local, incoming);
          const cmp = compareSyncVersions(incoming, local);
          expect(first && reverse).toBe(false);
        }
      }),
    );
  });

  test("incoming isPrivate claim does not protect or block admission", () => {
    fc.assert(
      fc.property(arbIncomingDoc, arbLocalState, (incoming, localBase) => {
        fc.pre(localBase.isPrivate !== true);
        // A remote doc claiming isPrivate:true must not change the outcome —
        // the guard only inspects the local record.
        const claimingPrivate: SyncState = { ...incoming, isPrivate: true };
        expect(shouldApplyIncomingSyncDoc(claimingPrivate, localBase)).toBe(
          compareSyncVersions(claimingPrivate, localBase) > 0,
        );
      }),
    );
  });
});
