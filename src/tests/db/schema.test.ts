/**
 * Tests for db/schema.ts
 * Verifies that all RxDB schemas are correctly defined
 */
import { describe, it, expect } from "vitest";

import {
  bookmarkSchema,
  documentSchema,
  folderSchema,
  templateSchema,
  versionSchema,
  flashcardSchema,
  messageSchema,
  chunkSchema,
  highlightSchema,
  insightSchema,
} from "../../db/schema";

describe("bookmarkSchema", () => {
  it("should have the correct title", () => {
    expect(bookmarkSchema.title).toBe("bookmark schema");
  });

  it("should have version 8 (v6 urlHash + v7 envelope + v8 read state)", () => {
    expect(bookmarkSchema.version).toBe(8);
  });

  it("should have primaryKey id", () => {
    expect(bookmarkSchema.primaryKey).toBe("id");
  });

  it("should have all required fields", () => {
    const required = bookmarkSchema.required as string[];
    expect(required).toContain("id");
    expect(required).toContain("url");
    expect(required).toContain("title");
    expect(required).toContain("createdAt");
    expect(required).toContain("updatedAt");
    expect(required).toContain("processed");
    expect(required).toContain("isDeleted");
  });

  it("should have defined indexes", () => {
    expect(bookmarkSchema.indexes).toBeDefined();
    expect(Array.isArray(bookmarkSchema.indexes)).toBe(true);
  });

  it("should have encrypted fields", () => {
    expect(bookmarkSchema.encrypted).toContain("title");
    expect(bookmarkSchema.encrypted).toContain("content");
    expect(bookmarkSchema.encrypted).toContain("summary");
    expect(bookmarkSchema.encrypted).toContain("relatedLinks");
  });

  it("should use urlHash for dedup (plaintext, indexed) and encrypt url", () => {
    expect(bookmarkSchema.indexes).toContain("urlHash");
    expect(bookmarkSchema.encrypted).toContain("url");
    expect(bookmarkSchema.encrypted).not.toContain("urlHash");
  });

  it("should have defined properties", () => {
    const props = bookmarkSchema.properties as Record<string, any>;
    expect(props.id.type).toBe("string");
    expect(props.url.maxLength).toBe(2000);
    expect(props.content.maxLength).toBe(10_000_000);
    expect(props.summary.maxLength).toBe(100_000);
    expect(props.relatedLinks.items.maxLength).toBe(2000);
    expect(props.tags.type).toBe("array");
    expect(props.embedding.type).toBe("array");
    expect(props.isDeleted.type).toBe("boolean");
  });
});

describe("documentSchema", () => {
  it("should have version 2 (F-06 authenticated envelope)", () => {
    expect(documentSchema.version).toBe(2);
  });

  it("should have folderId required", () => {
    const required = documentSchema.required as string[];
    expect(required).toContain("folderId");
  });

  it("should have composite indexes", () => {
    const indexes = documentSchema.indexes as any[];
    expect(indexes).toContainEqual(["folderId", "isDeleted", "createdAt"]);
    expect(indexes).toContainEqual(["isPrivate", "isDeleted", "createdAt"]);
  });
});

describe("folderSchema", () => {
  it("should have minimal fields", () => {
    const required = folderSchema.required as string[];
    expect(required).toEqual(["id", "title", "parentId", "createdAt"]);
  });

  it("should have a parentId index", () => {
    expect(folderSchema.indexes).toEqual(["parentId"]);
  });

  it("v4 should encrypt the title at rest (v3 encrypted + v4 F-06 envelope)", () => {
    expect(folderSchema.version).toBe(4);
    expect(folderSchema.encrypted).toContain("title");
  });
});

describe("templateSchema", () => {
  it("should have the correct required fields", () => {
    expect(templateSchema.required).toEqual([
      "id",
      "title",
      "blocks",
      "createdAt",
    ]);
  });

  it("v3 should encrypt title and blocks at rest (v2 encrypted + v3 F-06 envelope)", () => {
    expect(templateSchema.version).toBe(3);
    expect(templateSchema.encrypted).toContain("title");
    expect(templateSchema.encrypted).toContain("blocks");
  });
});

describe("versionSchema", () => {
  it("should have a documentId index", () => {
    expect(versionSchema.indexes).toContain("documentId");
    expect(versionSchema.indexes).toContain("createdAt");
  });

  it("should have encrypted blocks", () => {
    expect(versionSchema.encrypted).toContain("blocks");
  });
});

describe("flashcardSchema", () => {
  it("should have numeric fields with constraints", () => {
    const props = flashcardSchema.properties as Record<string, any>;
    expect(props.interval.minimum).toBe(0);
    expect(props.interval.maximum).toBe(36500);
    expect(props.easeFactor.minimum).toBe(1.0);
    expect(props.easeFactor.maximum).toBe(3.0);
    expect(props.repetition.maximum).toBe(10000);
  });

  it("should have composite indexes", () => {
    const indexes = flashcardSchema.indexes as any[];
    expect(indexes).toContainEqual(["documentId", "nextReview"]);
    expect(indexes).toContainEqual(["nextReview", "interval"]);
  });

  it("should have question and answer encrypted", () => {
    expect(flashcardSchema.encrypted).toContain("question");
    expect(flashcardSchema.encrypted).toContain("answer");
  });
});

describe("messageSchema", () => {
  it("should bump the version when adding grounding metadata + F-06 envelope", () => {
    expect(messageSchema.version).toBe(4);
  });

  it("should expose and encrypt grounding metadata", () => {
    expect(messageSchema.properties).toHaveProperty("groundingMetadata");
    expect(messageSchema.properties).toHaveProperty("sourceOrigin");
    expect(messageSchema.properties).toHaveProperty("isError");
    expect(messageSchema.properties).toHaveProperty("retryQuery");
    expect(messageSchema.encrypted).toContain("groundingMetadata");
  });

  it("should have required fields", () => {
    expect(messageSchema.required).toEqual([
      "id",
      "role",
      "content",
      "createdAt",
    ]);
  });

  it("should have a createdAt index", () => {
    expect(messageSchema.indexes).toContain("createdAt");
  });

  it("should have content and sources encrypted", () => {
    expect(messageSchema.encrypted).toContain("content");
    expect(messageSchema.encrypted).toContain("sources");
  });
});

describe("highlightSchema", () => {
  it("v3 should encrypt text and note at rest (v2 encrypted + v3 F-06 envelope)", () => {
    expect(highlightSchema.version).toBe(3);
    expect(highlightSchema.encrypted).toContain("text");
    expect(highlightSchema.encrypted).toContain("note");
  });

  it("indexed bookmarkId should not be encrypted", () => {
    expect(highlightSchema.indexes).toContain("bookmarkId");
    expect(highlightSchema.encrypted).not.toContain("bookmarkId");
  });
});

describe("insightSchema", () => {
  it("v3 should encrypt title, content and relatedIds at rest (v2 encrypted + v3 F-06 envelope)", () => {
    expect(insightSchema.version).toBe(3);
    expect(insightSchema.encrypted).toContain("title");
    expect(insightSchema.encrypted).toContain("content");
    expect(insightSchema.encrypted).toContain("relatedIds");
  });

  it("indexed type/createdAt should not be encrypted", () => {
    expect(insightSchema.encrypted).not.toContain("type");
    expect(insightSchema.encrypted).not.toContain("createdAt");
  });
});

describe("encrypted-vs-indexed invariant", () => {
  it("no encrypted field is indexed (RxDB cannot index encrypted data)", () => {
    const indexed = (s: { indexes?: unknown; encrypted?: string[] }): string[] => {
      const flat: string[] = [];
      for (const idx of (s.indexes as (string | string[])[] | undefined) ?? []) {
        if (typeof idx === "string") flat.push(idx);
        else flat.push(...idx);
      }
      return flat;
    };
    for (const schema of [
      bookmarkSchema,
      folderSchema,
      templateSchema,
      highlightSchema,
      insightSchema,
    ] as const) {
      for (const field of schema.encrypted ?? []) {
        // Cast: the loop variable is a union of RxJsonSchema<DocType> — the
        // real rxdb types don't let a union satisfy the structural param
        // type directly, but the fields accessed here exist on every member.
        expect(
          indexed(schema as { indexes?: unknown; encrypted?: string[] }),
        ).not.toContain(field);
      }
    }
  });
});

describe("chunkSchema", () => {
  it("should have complete required fields", () => {
    expect(chunkSchema.required).toEqual([
      "id",
      "parentId",
      "parentType",
      "isPrivate",
      "content",
      "embedding",
      "index",
      "createdAt",
    ]);
  });

  it("should have composite indexes", () => {
    const indexes = chunkSchema.indexes as any[];
    expect(indexes).toContainEqual(["parentId", "parentType", "index"]);
    expect(indexes).toContainEqual(["parentId", "createdAt"]);
  });

  it("should have content encrypted", () => {
    expect(chunkSchema.encrypted).toContain("content");
  });

  it("should have parentType with maxLength 20", () => {
    const props = chunkSchema.properties as Record<string, any>;
    expect(props.parentType.maxLength).toBe(20);
  });
});
