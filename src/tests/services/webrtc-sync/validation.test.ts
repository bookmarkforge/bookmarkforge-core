import { describe, it, expect } from "vitest";
import {
  isBoundedString,
  isSha256Hex,
  isBoundedSyncTimestamp,
  isOptionalSyncCursor,
  isSyncStartMessage,
  isString,
  isStringArray,
  isValidSessionDescription,
  isValidSyncDoc,
} from "../../../services/webrtc-sync/validation";

describe("webrtc-sync/validation", () => {
  describe("isBoundedString", () => {
    it("accepts strings within bounds", () => {
      expect(isBoundedString("hello", 10)).toBe(true);
    });

    it("rejects empty strings", () => {
      expect(isBoundedString("", 10)).toBe(false);
    });

    it("rejects non-strings", () => {
      expect(isBoundedString(123 as unknown as string, 10)).toBe(false);
      expect(isBoundedString(null as unknown as string, 10)).toBe(false);
      expect(isBoundedString(undefined as unknown as string, 10)).toBe(false);
    });

    it("rejects strings exceeding maxLength", () => {
      expect(isBoundedString("hello world", 5)).toBe(false);
    });
  });

  describe("isSha256Hex", () => {
    it("accepts valid SHA256 hex", () => {
      expect(
        isSha256Hex(
          "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        ),
      ).toBe(true);
    });

    it("rejects non-strings", () => {
      expect(isSha256Hex(123 as unknown as string)).toBe(false);
    });

    it("rejects strings with invalid chars", () => {
      expect(isSha256Hex("xyz0123456789abcdef0123456789abcdef0123456789abcdef0123456789")).toBe(
        false,
      );
    });

    it("rejects strings with wrong length", () => {
      expect(isSha256Hex("short")).toBe(false);
    });
  });

  describe("isBoundedSyncTimestamp", () => {
    it("accepts valid ISO timestamps within tolerance", () => {
      const now = new Date();
      const valid = new Date(now.getTime() - 1000).toISOString();
      expect(isBoundedSyncTimestamp(valid)).toBe(true);
    });

    it("rejects empty strings", () => {
      expect(isBoundedSyncTimestamp("")).toBe(false);
    });

    it("rejects non-strings", () => {
      expect(isBoundedSyncTimestamp(123 as unknown as string)).toBe(false);
    });

    it("rejects unparseable timestamps", () => {
      expect(isBoundedSyncTimestamp("not-a-date")).toBe(false);
    });

    it("rejects timestamps too far in the future", () => {
      const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      expect(isBoundedSyncTimestamp(future)).toBe(false);
    });

    it("rejects strings longer than 100 chars", () => {
      expect(isBoundedSyncTimestamp("a".repeat(101))).toBe(false);
    });
  });

  describe("isOptionalSyncCursor", () => {
    it("accepts null and undefined", () => {
      expect(isOptionalSyncCursor(null)).toBe(true);
      expect(isOptionalSyncCursor(undefined)).toBe(true);
    });

    it("accepts valid cursor strings", () => {
      expect(isOptionalSyncCursor("2024-01-01T00:00:00Z")).toBe(true);
    });

    it("rejects empty strings", () => {
      expect(isOptionalSyncCursor("")).toBe(false);
    });

    it("rejects non-strings", () => {
      expect(isOptionalSyncCursor(123 as unknown as string | null)).toBe(false);
    });
  });

  describe("isSyncStartMessage", () => {
    it("accepts a valid legacy message", () => {
      expect(
        isSyncStartMessage({
          type: "sync_start",
          totalChunks: 10,
          checksum: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        }),
      ).toBe(true);
    });

    it("rejects non-objects", () => {
      expect(isSyncStartMessage("not-an-object")).toBe(false);
      expect(isSyncStartMessage(null)).toBe(false);
    });

    it("rejects invalid totalChunks", () => {
      expect(
        isSyncStartMessage({
          type: "sync_start",
          totalChunks: 0,
          checksum: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        }),
      ).toBe(false);
      expect(
        isSyncStartMessage({
          type: "sync_start",
          totalChunks: 2001,
          checksum: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        }),
      ).toBe(false);
    });

    it("rejects invalid checksum format", () => {
      expect(
        isSyncStartMessage({
          type: "sync_start",
          totalChunks: 10,
          checksum: "bad",
        }),
      ).toBe(false);
    });

    it("requires auth and batchId together", () => {
      expect(
        isSyncStartMessage({
          type: "sync_start",
          totalChunks: 10,
          checksum: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          auth: "token",
        }),
      ).toBe(false);
    });

    it("requires checksum when batchId is present without auth", () => {
      expect(
        isSyncStartMessage({
          type: "sync_start",
          totalChunks: 10,
          batchId: "1",
        }),
      ).toBe(false);
    });
  });

  describe("isString", () => {
    it("accepts strings within bounds", () => {
      expect(isString("hello", 10)).toBe(true);
    });

    it("rejects non-strings", () => {
      expect(isString(123 as unknown as string, 10)).toBe(false);
    });

    it("rejects strings exceeding maxLength", () => {
      expect(isString("hello world", 5)).toBe(false);
    });
  });

  describe("isStringArray", () => {
    it("accepts valid string arrays", () => {
      expect(isStringArray(["a", "b", "c"])).toBe(true);
    });

    it("rejects non-arrays", () => {
      expect(isStringArray("not-array" as unknown as string[])).toBe(false);
    });

    it("rejects arrays with too many items", () => {
      expect(isStringArray(new Array(10001).fill("x"))).toBe(false);
    });

    it("rejects arrays with items exceeding maxLength", () => {
      expect(isStringArray(["a".repeat(2001)])).toBe(false);
    });
  });

  describe("isValidSessionDescription", () => {
    it("accepts valid offer/answer descriptions", () => {
      expect(
        isValidSessionDescription({
          type: "offer",
          sdp: "v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\n",
        }),
      ).toBe(true);
      expect(
        isValidSessionDescription({
          type: "answer",
          sdp: "v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\n",
        }),
      ).toBe(true);
    });

    it("rejects non-objects", () => {
      expect(isValidSessionDescription("not-object" as unknown as RTCSessionDescriptionInit)).toBe(
        false,
      );
      expect(isValidSessionDescription(null)).toBe(false);
      expect(isValidSessionDescription([])).toBe(false);
    });

    it("rejects invalid types", () => {
      expect(
        isValidSessionDescription({
          type: "invalid",
          sdp: "v=0",
        } as unknown as RTCSessionDescriptionInit),
      ).toBe(false);
    });

    it("rejects empty or oversized SDP", () => {
      expect(
        isValidSessionDescription({
          type: "offer",
          sdp: "",
        } as unknown as RTCSessionDescriptionInit),
      ).toBe(false);
      expect(
        isValidSessionDescription({
          type: "offer",
          sdp: "a".repeat(65537),
        } as unknown as RTCSessionDescriptionInit),
      ).toBe(false);
    });

    it("rejects SDP with null bytes", () => {
      expect(
        isValidSessionDescription({
          type: "offer",
          sdp: "v=0\u0000",
        } as unknown as RTCSessionDescriptionInit),
      ).toBe(false);
    });
  });

  describe("isValidSyncDoc", () => {
    it("accepts valid document records in strict mode", () => {
      expect(
        isValidSyncDoc(
          {
            id: "abc",
            folderId: "f1",
            title: "My Doc",
            blocks: [],
            tags: [],
            links: [],
            processed: true,
            isPrivate: false,
            isDeleted: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          "documents",
          true,
        ),
      ).toBe(true);
    });

    it("accepts valid bookmark records in strict mode", () => {
      expect(
        isValidSyncDoc(
          {
            id: "abc",
            url: "https://example.com",
            title: "Example",
            tags: [],
            relatedLinks: [],
            processed: true,
            isPrivate: false,
            isDeleted: false,
            visitCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          "bookmarks",
          true,
        ),
      ).toBe(true);
    });

    it("rejects private records", () => {
      expect(
        isValidSyncDoc(
          {
            id: "abc",
            isPrivate: true,
            processed: true,
            isDeleted: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          "documents",
          true,
        ),
      ).toBe(false);
    });

    it("rejects records with oversized blocks in strict mode", () => {
      expect(
        isValidSyncDoc(
          {
            id: "abc",
            blocks: [new Array(50001).fill("x")],
            processed: true,
            isPrivate: false,
            isDeleted: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          "documents",
          true,
        ),
      ).toBe(false);
    });

    it("rejects records whose blocks cannot be serialized", () => {
      const blocks: unknown[] = [];
      blocks.push(blocks);
      expect(
        isValidSyncDoc(
          {
            id: "cyclic",
            blocks,
            processed: true,
            isPrivate: false,
            isDeleted: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          "documents",
          true,
        ),
      ).toBe(false);
    });

    it("rejects records with oversized embeddings", () => {
      expect(
        isValidSyncDoc(
          {
            id: "abc",
            embedding: new Array(4097).fill(1),
            processed: true,
            isPrivate: false,
            isDeleted: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          "documents",
          true,
        ),
      ).toBe(false);
    });

    it("rejects records with invalid visitCount", () => {
      expect(
        isValidSyncDoc(
          {
            id: "abc",
            url: "https://example.com",
            title: "Example",
            processed: true,
            isPrivate: false,
            isDeleted: false,
            visitCount: -1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          "bookmarks",
          true,
        ),
      ).toBe(false);
    });

    it("accepts permissive path when strictSchema is false", () => {
      expect(
        isValidSyncDoc(
          {
            id: "abc",
            title: "Doc",
            processed: true,
            isPrivate: false,
            isDeleted: false,
            createdAt: new Date().toISOString(),
            updatedAt: "",
          },
          "documents",
          false,
        ),
      ).toBe(true);
    });

    it("rejects a permissive path with a non-empty invalid updatedAt", () => {
      expect(
        isValidSyncDoc(
          {
            id: "abc",
            title: "Doc",
            processed: true,
            isPrivate: false,
            isDeleted: false,
            createdAt: new Date().toISOString(),
            updatedAt: "not-a-timestamp",
          },
          "documents",
          false,
        ),
      ).toBe(false);
    });

    it("validates optional document fields in strict mode", () => {
      const valid = {
        id: "abc",
        folderId: "f1",
        title: "Doc",
        url: "https://example.com",
        content: "content",
        summary: "summary",
        textContent: "text",
        tags: ["a"],
        links: ["https://example.com"],
        relatedLinks: [],
        processed: true,
        isPrivate: false,
        isDeleted: false,
        visitCount: 1,
        blocks: [{ type: "p", content: "x" }],
        embedding: [0.1, 0.2],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(isValidSyncDoc(valid, "documents", true)).toBe(true);

      expect(isValidSyncDoc({ ...valid, folderId: 1 }, "documents", true)).toBe(false);
      expect(isValidSyncDoc({ ...valid, content: 1 }, "documents", true)).toBe(false);
      expect(isValidSyncDoc({ ...valid, summary: 1 }, "documents", true)).toBe(false);
      expect(isValidSyncDoc({ ...valid, textContent: 1 }, "documents", true)).toBe(false);
    });
  });
});
