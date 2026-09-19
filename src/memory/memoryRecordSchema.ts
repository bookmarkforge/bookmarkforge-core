/**
 * Unified schema for every document the memory subsystem stores. Replaces
 * the four RxDB collections (memoryAtoms, memoryProfiles, memorySessions,
 * memoryChatMessages) that pushed us over the RxDB 17 OSS open-collection
 * cap (NON_PREMIUM_COLLECTION_LIMIT = 13). Consolidating into one
 * `memory` collection preserves every behaviour:
 *
 *   - Atoms      → { type: "atom",    ... }
 *   - Profiles   → { type: "profile", ... }    (scenarios + personas)
 *   - Sessions   → { type: "session", ... }
 *   - Messages   → { type: "message", ... }
 *
 * Indexes and `required` are intentionally conservative. RxDB unions cannot
 * conditionally require fields, so any indexed field must be present on every
 * document or the Dexie backend will fail DXE1. We therefore index only the
 * fields that are populated on every type (`type`, `createdAt`) and let
 * per-type selectors fall back to collection scan — the memory collection is
 * bounded by per-user activity, so scan is acceptable. Lookups by id remain
 * O(1) via the primary key; entity filtering just narrows on the type index.
 *
 * The companion types (MemoryAtom | MemoryProfile | MemorySession |
 * MemoryChatMessage) live in ./MemoryTypes; the runtime schema is typed as
 * `any` because RxJsonSchema's generic union mechanics drop non-shared
 * properties (see existing memoryProfileSchema for the same workaround).
 */
import { RxJsonSchema } from "rxdb";
import {
  MemoryRecord,
} from "./MemoryTypes";

/**
 * Field-level encryption: every personally identifying or private field is
 * added to the encrypted set. RxDB handles type-specific absence gracefully
 * (an absent field on a doc is replaced by an empty encrypted placeholder).
 */
const ENCRYPTED_FIELDS = [
  "content",       // atoms + messages
  "title",         // sessions + scenario profiles
  "description",   // scenario profiles
  "summary",       // sessions
  "sources",       // messages
  "preferences",   // persona profiles
  "goals",         // persona profiles
  "tone",          // persona profiles
  "workflows",     // persona profiles
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- RxDB union schemas drop non-shared props when typed
export const memoryRecordSchema: RxJsonSchema<any> = {
  title: "memory record schema (unified collection)",
  // v2: authenticated-at-rest envelope (F-06) — identity migration.
  // v3: add the profileType discriminator used by scenario/persona queries.
  version: 3,
  primaryKey: "id",
  type: "object",
  properties: {
    // Discriminator — every document has it; the indexed field that lets a
    // selector narrow to a sub-entity without scanning.
    type: { type: "string", maxLength: 16, enum: ["atom", "profile", "session", "message"] },

    // ---- common ----
    id: { type: "string", maxLength: 200 },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },

    // ---- atom ----
    content: { type: "string", maxLength: 2000 },
    category: { type: "string", maxLength: 30, enum: ["preference", "fact", "goal", "project", "workflow"] },
    confidence: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01 },
    sourceMessageId: { type: "string", maxLength: 100 },
    sessionId: { type: "string", maxLength: 100 },
    embedding: { type: "array", items: { type: "number" } },
    updatedAt: { type: "string", format: "date-time", maxLength: 100 },

    // ---- profile (scenario OR persona) ----
    profileType: { type: "string", enum: ["scenario", "persona"] },
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

    // ---- session ----
    messageIds: { type: "array", items: { type: "string" } },
    startedAt: { type: "string", format: "date-time", maxLength: 100 },
    summary: { type: "string" },

    // ---- message ----
    role: { type: "string", maxLength: 20, enum: ["user", "assistant", "system"] },
    sources: { type: "array", items: { type: "object" } },
    isPrivate: { type: "boolean" },
  },
  required: ["id", "type", "createdAt"],
  // DXE1-safe in Dexie: every indexed field is unconditionally required above.
  // We deliberately drop the per-entity indexes (sessionId, role, lastActive,
  // frequency, category, confidence). Queries that filtered on them previously
  // now layer `type: "atom"|"message"` and let RxDB use the compound type
  // index to prune before scanning the remaining matches.
  indexes: ["type", "createdAt"],
  encrypted: ENCRYPTED_FIELDS,
};

/**
 * Convenience type re-export so callers can `import { MemoryRecord } from the
 * schema module` if they prefer to read the runtime shape alongside the type.
 */
export type { MemoryRecord };
