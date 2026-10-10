import { describe, expect, it } from "vitest";
import * as containerDb from "./database";
import * as dbDatabase from "../db/database";

describe("container/database bootstrap gate", () => {
  it("re-exports initDB and destroyDB from the db layer", () => {
    expect(containerDb.initDB).toBe(dbDatabase.initDB);
    expect(containerDb.destroyDB).toBe(dbDatabase.destroyDB);
  });

  it("re-exports the classified-error guards from the db layer", () => {
    expect(containerDb.isInvalidDbPasswordError).toBe(dbDatabase.isInvalidDbPasswordError);
    expect(containerDb.isDbInaccessibleError).toBe(dbDatabase.isDbInaccessibleError);
    expect(containerDb.isVaultLockedError).toBe(dbDatabase.isVaultLockedError);
  });

  it("forwards the classified-error guard behavior", () => {
    expect(
      containerDb.isInvalidDbPasswordError(Object.assign(new Error("bad"), { name: "INVALID_PASSWORD" })),
    ).toBe(true);
    expect(containerDb.isDbInaccessibleError(Object.assign(new Error("gone"), { name: "DB_INACCESSIBLE" }))).toBe(true);
    expect(containerDb.isVaultLockedError(Object.assign(new Error("locked"), { name: "VAULT_LOCKED" }))).toBe(true);
    expect(containerDb.isVaultLockedError(new Error("plain"))).toBe(false);
    expect(containerDb.isDbInaccessibleError(null)).toBe(false);
  });
});