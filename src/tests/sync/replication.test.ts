import { describe, expect, it } from "vitest";
import { syncReplicationModifier } from "../../services/sync/replication";

const applyModifier = syncReplicationModifier as unknown as (doc: unknown) => unknown;

describe("sync replication privacy boundary", () => {
  it("allows only documents explicitly marked public", () => {
    const document = { id: "public-1", isPrivate: false };
    expect(applyModifier(document)).toBe(document);
  });

  it.each([
    ["missing metadata", { id: "legacy-1" }],
    ["null metadata", { id: "invalid-1", isPrivate: null }],
    ["string metadata", { id: "invalid-2", isPrivate: "false" }],
    ["private metadata", { id: "private-1", isPrivate: true }],
    ["null document", null],
  ])("rejects %s", (_label, document) => {
    const expected = document && typeof document === "object" &&
      (document as { isPrivate?: unknown }).isPrivate === true
      ? "Private document rejected by replication boundary"
      : "explicit public privacy metadata";
    expect(() => applyModifier(document)).toThrow(expected);
  });
});
