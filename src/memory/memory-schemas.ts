/**
 * Legacy memory schemas. Kept in place because the test suite
 * (`src/tests/memory/memory-schemas.test.ts`,
 * `src/tests/db/database.test.ts`, the barrel smoke test) still imports them
 * to assert property and index shape. Production code goes through the
 * unified `memoryRecordSchema` exported from `./memoryRecordSchema` — these
 * exports are no longer wired to any RxDB collection and exist purely for
 * compatibility with mocks that pin the old four-collection shape.
 *
 * Each is typed as `RxJsonSchema<any>` because the entity unions
 * (MemoryAtom, MemoryProfile, ...) had a `type` discriminator added in the
 * unification, which RxDB's typed `RxJsonSchema<T>` rejects unless the
 * schema's `properties.type` is included. Re-adding it would defeat the
 * purpose of the legacy stubs.
 */
import { RxJsonSchema } from "rxdb";
/* eslint-disable @typescript-eslint/no-explicit-any */

export const memoryAtomSchema: RxJsonSchema<any> = {
  title: "memory atom schema",
  version: 1,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    content: { type: "string", maxLength: 2000 },
    category: {
      type: "string",
      maxLength: 30,
      enum: ["preference", "fact", "goal", "project", "workflow"],
    },
    confidence: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01 },
    sourceMessageId: { type: "string", maxLength: 100 },
    sessionId: { type: "string", maxLength: 100 },
    embedding: { type: "array", items: { type: "number" } },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
    updatedAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: [
    "id",
    "content",
    "category",
    "confidence",
    "sourceMessageId",
    "sessionId",
    "createdAt",
    "updatedAt",
  ],
  indexes: [
    "category",
    "sessionId",
    "confidence",
    "createdAt",
    ["category", "confidence"],
    ["sessionId", "createdAt"],
  ],
  encrypted: ["content"],
};

export const memoryScenarioSchema: RxJsonSchema<any> = {
  title: "memory scenario schema",
  version: 1,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    title: { type: "string", maxLength: 300 },
    description: { type: "string" },
    atomIds: { type: "array", items: { type: "string" } },
    frequency: { type: "number", multipleOf: 1, minimum: 1, maximum: 10000 },
    lastActive: { type: "string", format: "date-time", maxLength: 100 },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: [
    "id",
    "title",
    "description",
    "atomIds",
    "frequency",
    "lastActive",
    "createdAt",
  ],
  indexes: ["frequency", "lastActive", "createdAt"],
  encrypted: ["title", "description"],
};

export const memoryPersonaSchema: RxJsonSchema<any> = {
  title: "memory persona schema",
  version: 1,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 50 },
    preferences: { type: "array", items: { type: "string" } },
    goals: { type: "array", items: { type: "string" } },
    tone: { type: "string", maxLength: 500 },
    workflows: { type: "array", items: { type: "string" } },
    updatedAt: { type: "string", format: "date-time", maxLength: 100 },
    generatedFromScenarioIds: { type: "array", items: { type: "string" } },
  },
  required: [
    "id",
    "preferences",
    "goals",
    "tone",
    "workflows",
    "updatedAt",
    "generatedFromScenarioIds",
  ],
  encrypted: ["preferences", "goals", "tone", "workflows"],
};

export const memorySessionSchema: RxJsonSchema<any> = {
  title: "memory session schema",
  version: 1,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    title: { type: "string", maxLength: 300 },
    messageIds: { type: "array", items: { type: "string" } },
    startedAt: { type: "string", format: "date-time", maxLength: 100 },
    lastActive: { type: "string", format: "date-time", maxLength: 100 },
    summary: { type: "string" },
  },
  required: ["id", "title", "messageIds", "startedAt", "lastActive"],
  indexes: ["startedAt", "lastActive"],
  encrypted: ["title", "summary"],
};

export const memoryChatMessageSchema: RxJsonSchema<any> = {
  title: "memory chat message schema",
  version: 1,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    sessionId: { type: "string", maxLength: 100 },
    role: {
      type: "string",
      maxLength: 20,
      enum: ["user", "assistant", "system"],
    },
    content: { type: "string" },
    sources: { type: "array", items: { type: "object" } },
    isPrivate: { type: "boolean" },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: ["id", "sessionId", "role", "content", "createdAt"],
  indexes: ["sessionId", "role", "createdAt", ["sessionId", "createdAt"]],
  encrypted: ["content", "sources"],
};

/**
 * Unified profile schema combining scenarios and personas (legacy stub).
 * Same shape as before but typed `any` for the reason in the header.
 */
export const memoryProfileSchema: RxJsonSchema<any> = {
  title: "memory profile schema",
  version: 1,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    type: {
      type: "string",
      maxLength: 20,
      enum: ["scenario", "persona"],
    },
    title: { type: "string", maxLength: 300 },
    description: { type: "string" },
    atomIds: { type: "array", items: { type: "string" } },
    frequency: { type: "number", multipleOf: 1, minimum: 1, maximum: 10000 },
    lastActive: { type: "string", format: "date-time", maxLength: 100 },
    preferences: { type: "array", items: { type: "string" } },
    goals: { type: "array", items: { type: "string" } },
    tone: { type: "string", maxLength: 500 },
    workflows: { type: "array", items: { type: "string" } },
    generatedFromScenarioIds: { type: "array", items: { type: "string" } },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
    updatedAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: ["id", "type", "createdAt", "updatedAt"],
  indexes: ["type", "createdAt"],
  encrypted: [
    "title",
    "description",
    "preferences",
    "goals",
    "tone",
    "workflows",
  ],
};
