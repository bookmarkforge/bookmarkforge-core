import { describe, it, expect } from "vitest";
import {
  memoryAtomSchema,
  memoryScenarioSchema,
  memoryPersonaSchema,
  memorySessionSchema,
  memoryChatMessageSchema,
} from "../../memory/memory-schemas";

describe("memory-schemas — esquemas RxDB", () => {
  describe("memoryAtomSchema", () => {
    it("has correct title and version", () => {
      expect(memoryAtomSchema.title).toBe("memory atom schema");
      expect(memoryAtomSchema.version).toBe(1);
    });

    it("has primaryKey = id", () => {
      expect(memoryAtomSchema.primaryKey).toBe("id");
    });

    it("root type is object", () => {
      expect(memoryAtomSchema.type).toBe("object");
    });

    it("has the correct required properties", () => {
      const required = [
        "id",
        "content",
        "category",
        "confidence",
        "sourceMessageId",
        "sessionId",
        "createdAt",
        "updatedAt",
      ];
      expect(memoryAtomSchema.required).toEqual(required);
    });

    it("defines date-time format on createdAt and updatedAt", () => {
      const props = memoryAtomSchema.properties as Record<string, any>;
      expect(props.createdAt.format).toBe("date-time");
      expect(props.updatedAt.format).toBe("date-time");
    });

    it("confidence has minimum 0, maximum 1, multipleOf 0.01", () => {
      const confidence = (memoryAtomSchema.properties as Record<string, any>)
        .confidence;
      expect(confidence.minimum).toBe(0);
      expect(confidence.maximum).toBe(1);
      expect(confidence.multipleOf).toBe(0.01);
    });

    it("category has enum with the 5 values", () => {
      const category = (memoryAtomSchema.properties as Record<string, any>)
        .category;
      expect(category.enum).toEqual([
        "preference",
        "fact",
        "goal",
        "project",
        "workflow",
      ]);
    });

    it("embedding is an array of numbers", () => {
      const embedding = (memoryAtomSchema.properties as Record<string, any>)
        .embedding;
      expect(embedding.type).toBe("array");
      expect(embedding.items.type).toBe("number");
    });

    it("has the expected indexes", () => {
      const indexes = memoryAtomSchema.indexes as any[];
      expect(indexes).toContain("category");
      expect(indexes).toContain("sessionId");
      expect(indexes).toContain("confidence");
      expect(indexes).toContain("createdAt");
      expect(indexes).toContainEqual(["category", "confidence"]);
      expect(indexes).toContainEqual(["sessionId", "createdAt"]);
    });

    it("has encrypted content field", () => {
      expect(memoryAtomSchema.encrypted).toContain("content");
    });
  });

  describe("memoryScenarioSchema", () => {
    it("has primaryKey = id", () => {
      expect(memoryScenarioSchema.primaryKey).toBe("id");
    });

    it("has the correct required properties", () => {
      const required = [
        "id",
        "title",
        "description",
        "atomIds",
        "frequency",
        "lastActive",
        "createdAt",
      ];
      expect(memoryScenarioSchema.required).toEqual(required);
    });

    it("frequency has minimum 1, maximum 10000, multipleOf 1", () => {
      const frequency = (memoryScenarioSchema.properties as Record<string, any>)
        .frequency;
      expect(frequency.minimum).toBe(1);
      expect(frequency.maximum).toBe(10000);
      expect(frequency.multipleOf).toBe(1);
    });

    it("atomIds is an array of strings", () => {
      const atomIds = (memoryScenarioSchema.properties as Record<string, any>)
        .atomIds;
      expect(atomIds.type).toBe("array");
      expect(atomIds.items.type).toBe("string");
    });

    it("has correct indexes", () => {
      const indexes = memoryScenarioSchema.indexes as any[];
      expect(indexes).toContain("frequency");
      expect(indexes).toContain("lastActive");
      expect(indexes).toContain("createdAt");
    });

    it("has encrypted title and description fields", () => {
      expect(memoryScenarioSchema.encrypted).toContain("title");
      expect(memoryScenarioSchema.encrypted).toContain("description");
    });

    it("description is a string type without maxLength", () => {
      const description = (
        memoryScenarioSchema.properties as Record<string, any>
      ).description;
      expect(description.type).toBe("string");
      expect(description.maxLength).toBeUndefined();
    });
  });

  describe("memoryPersonaSchema", () => {
    it("has primaryKey = id", () => {
      expect(memoryPersonaSchema.primaryKey).toBe("id");
    });

    it("has the correct required properties", () => {
      const required = [
        "id",
        "preferences",
        "goals",
        "tone",
        "workflows",
        "updatedAt",
        "generatedFromScenarioIds",
      ];
      expect(memoryPersonaSchema.required).toEqual(required);
    });

    it("id has maxLength 50", () => {
      const id = (memoryPersonaSchema.properties as Record<string, any>).id;
      expect(id.maxLength).toBe(50);
    });

    it("tone has maxLength 500", () => {
      const tone = (memoryPersonaSchema.properties as Record<string, any>).tone;
      expect(tone.maxLength).toBe(500);
    });

    it("preferences, goals, workflows, generatedFromScenarioIds son arrays de strings", () => {
      const props = memoryPersonaSchema.properties as Record<string, any>;
      ["preferences", "goals", "workflows", "generatedFromScenarioIds"].forEach(
        (field) => {
          expect(props[field].type).toBe("array");
          expect(props[field].items.type).toBe("string");
        },
      );
    });

    it("has encrypted preferences, goals, tone, workflows fields", () => {
      expect(memoryPersonaSchema.encrypted).toContain("preferences");
      expect(memoryPersonaSchema.encrypted).toContain("goals");
      expect(memoryPersonaSchema.encrypted).toContain("tone");
      expect(memoryPersonaSchema.encrypted).toContain("workflows");
    });
  });

  describe("memorySessionSchema", () => {
    it("has primaryKey = id", () => {
      expect(memorySessionSchema.primaryKey).toBe("id");
    });

    it("has the correct required properties", () => {
      const required = ["id", "title", "messageIds", "startedAt", "lastActive"];
      expect(memorySessionSchema.required).toEqual(required);
    });

    it("summary is optional (not in required)", () => {
      expect(memorySessionSchema.required).not.toContain("summary");
    });

    it("title has maxLength 300", () => {
      const title = (memorySessionSchema.properties as Record<string, any>)
        .title;
      expect(title.maxLength).toBe(300);
    });

    it("has startedAt and lastActive indexes", () => {
      const indexes = memorySessionSchema.indexes as any[];
      expect(indexes).toContain("startedAt");
      expect(indexes).toContain("lastActive");
    });

    it("has encrypted title and summary fields", () => {
      expect(memorySessionSchema.encrypted).toContain("title");
      expect(memorySessionSchema.encrypted).toContain("summary");
    });
  });

  describe("memoryChatMessageSchema", () => {
    it("has primaryKey = id", () => {
      expect(memoryChatMessageSchema.primaryKey).toBe("id");
    });

    it("has the correct required properties", () => {
      const required = ["id", "sessionId", "role", "content", "createdAt"];
      expect(memoryChatMessageSchema.required).toEqual(required);
    });

    it("role has enum with user, assistant, system", () => {
      const role = (memoryChatMessageSchema.properties as Record<string, any>)
        .role;
      expect(role.enum).toEqual(["user", "assistant", "system"]);
    });

    it("sources is an array of objects and is optional", () => {
      const sources = (
        memoryChatMessageSchema.properties as Record<string, any>
      ).sources;
      expect(sources.type).toBe("array");
      expect(sources.items.type).toBe("object");
    });

    it("has the expected indexes", () => {
      const indexes = memoryChatMessageSchema.indexes as any[];
      expect(indexes).toContain("sessionId");
      expect(indexes).toContain("role");
      expect(indexes).toContain("createdAt");
      expect(indexes).toContainEqual(["sessionId", "createdAt"]);
    });

    it("has encrypted content and sources fields", () => {
      expect(memoryChatMessageSchema.encrypted).toContain("content");
      expect(memoryChatMessageSchema.encrypted).toContain("sources");
    });

    it("no requiere sources en required", () => {
      expect(memoryChatMessageSchema.required).not.toContain("sources");
    });
  });

  describe("all schemas — common structure", () => {
    it("each schema has title, version, primaryKey, type, properties, required", () => {
      const schemas = [
        memoryAtomSchema,
        memoryScenarioSchema,
        memoryPersonaSchema,
        memorySessionSchema,
        memoryChatMessageSchema,
      ];
      schemas.forEach((schema) => {
        expect(schema.title).toBeTruthy();
        expect(typeof schema.version).toBe("number");
        expect(typeof schema.primaryKey).toBe("string");
        expect(schema.type).toBe("object");
        expect(schema.properties).toBeDefined();
        expect(schema.required).toBeInstanceOf(Array);
      });
    });

    it("each schema has encrypted as an array", () => {
      const schemas = [
        memoryAtomSchema,
        memoryScenarioSchema,
        memoryPersonaSchema,
        memorySessionSchema,
        memoryChatMessageSchema,
      ];
      schemas.forEach((schema) => {
        expect(schema.encrypted).toBeInstanceOf(Array);
        expect(schema.encrypted!.length).toBeGreaterThan(0);
      });
    });
  });
});
