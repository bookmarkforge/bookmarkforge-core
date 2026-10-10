import { describe, it, expect } from "vitest";
import { memoryRecordSchema } from "../../memory/memoryRecordSchema";

/**
 * Shape assertions for the unified memory schema (src/memory/memoryRecordSchema.ts).
 * This is the single RxDB collection the memory subsystem persists to today;
 * these tests pin the contract the rest of the app relies on (discriminator,
 * DXE1-safe indexes, encrypted fields). The legacy four-collection schemas are
 * covered separately in memory-schemas.test.ts.
 */
describe("memoryRecordSchema — unified memory collection", () => {
  // RxJsonSchema<any> (union schema workaround) — same cast style as
  // memory-schemas.test.ts.
  const props = memoryRecordSchema.properties as Record<string, any>;

  it("has the unified collection identity (title, version 3, primaryKey)", () => {
    expect(memoryRecordSchema.title).toBe("memory record schema (unified collection)");
    expect(memoryRecordSchema.version).toBe(3);
    expect(memoryRecordSchema.primaryKey).toBe("id");
    expect(memoryRecordSchema.type).toBe("object");
  });

  it("requires exactly id, type and createdAt", () => {
    expect(memoryRecordSchema.required).toEqual(["id", "type", "createdAt"]);
  });

  it("declares every required and indexed field as a property", () => {
    const propertyNames = Object.keys(props);
    for (const field of memoryRecordSchema.required ?? []) {
      expect(propertyNames).toContain(field);
    }
    for (const index of memoryRecordSchema.indexes as string[]) {
      expect(propertyNames).toContain(index);
    }
  });

  it("keeps the DXE1-safe conservative index set (type, createdAt)", () => {
    // Dexie fails (DXE1) when an indexed field is not unconditionally
    // required, so only the always-present fields may be indexed.
    expect(memoryRecordSchema.indexes).toEqual(["type", "createdAt"]);
  });

  it("defines the type discriminator for every record kind", () => {
    expect(props.type).toEqual({
      type: "string",
      maxLength: 16,
      enum: ["atom", "profile", "session", "message"],
    });
  });

  it("declares the atom fields", () => {
    expect(props.content.type).toBe("string");
    expect(props.content.maxLength).toBe(2000);
    expect(props.category.maxLength).toBe(30);
    expect(props.category.enum).toEqual([
      "preference",
      "fact",
      "goal",
      "project",
      "workflow",
    ]);
    expect(props.confidence).toEqual({
      type: "number",
      minimum: 0,
      maximum: 1,
      multipleOf: 0.01,
    });
    expect(props.sourceMessageId.maxLength).toBe(100);
    expect(props.sessionId.maxLength).toBe(100);
    expect(props.embedding.type).toBe("array");
    expect(props.embedding.items.type).toBe("number");
    expect(props.updatedAt.format).toBe("date-time");
  });

  it("declares the profile fields (scenario or persona)", () => {
    expect(props.profileType.enum).toEqual(["scenario", "persona"]);
    expect(props.title.maxLength).toBe(300);
    expect(props.description.type).toBe("string");
    expect(props.atomIds.type).toBe("array");
    expect(props.atomIds.items.type).toBe("string");
    expect(props.frequency).toEqual({
      type: "number",
      multipleOf: 1,
      minimum: 1,
      maximum: 10000,
    });
    expect(props.lastActive.format).toBe("date-time");
    for (const field of ["preferences", "goals", "workflows", "generatedFromScenarioIds"]) {
      expect(props[field].type).toBe("array");
      expect(props[field].items.type).toBe("string");
    }
    expect(props.tone.maxLength).toBe(500);
  });

  it("declares the session fields", () => {
    expect(props.messageIds.type).toBe("array");
    expect(props.messageIds.items.type).toBe("string");
    expect(props.startedAt.format).toBe("date-time");
    expect(props.summary.type).toBe("string");
  });

  it("declares the message fields", () => {
    expect(props.role).toEqual({
      type: "string",
      maxLength: 20,
      enum: ["user", "assistant", "system"],
    });
    expect(props.sources.type).toBe("array");
    expect(props.sources.items.type).toBe("object");
    expect(props.isPrivate.type).toBe("boolean");
  });

  it("keeps common field constraints consistent", () => {
    expect(props.id.maxLength).toBe(200);
    expect(props.createdAt.format).toBe("date-time");
    expect(props.createdAt.maxLength).toBe(100);
  });

  it("encrypts exactly the private per-type fields and declares them all", () => {
    expect(memoryRecordSchema.encrypted).toEqual([
      "content",
      "title",
      "description",
      "summary",
      "sources",
      "preferences",
      "goals",
      "tone",
      "workflows",
    ]);
    for (const field of memoryRecordSchema.encrypted ?? []) {
      expect(props[field]).toBeDefined();
    }
  });
});
