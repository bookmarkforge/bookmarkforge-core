import { describe, it, expect } from "vitest";
import {
  parseFirefoxPlaces,
  parsePinboardPosts,
} from "../../services/importer.alt-bookmarks";

describe("importer.alt-bookmarks", () => {
  describe("parsePinboardPosts", () => {
    it("parses a Pinboard posts/all JSON array", () => {
      const json = JSON.stringify([
        {
          href: "https://example.com/a",
          description: "Article A",
          extended: "longer note",
          time: "2024-01-02T03:04:05Z",
          tags: "dev, privacy tools",
        },
        { href: "https://example.com/b", description: "B", tags: "" },
      ]);
      const out = parsePinboardPosts(json);
      expect(out).toHaveLength(2);
      expect(out![0]).toMatchObject({
        url: "https://example.com/a",
        title: "Article A",
        summary: "longer note",
        tags: ["dev", "privacy", "tools"],
        createdAt: "2024-01-02T03:04:05Z",
      });
      expect(out![1]!.tags).toEqual([]);
    });

    it("returns null for non-array or non-pinboard JSON", () => {
      expect(parsePinboardPosts('{"bookmarks":[]}')).toBeNull();
      expect(parsePinboardPosts("[]")).toBeNull();
      expect(parsePinboardPosts('[{"foo":1}]')).toBeNull();
      expect(parsePinboardPosts("not json")).toBeNull();
    });

    it("skips entries without an href", () => {
      const out = parsePinboardPosts(
        JSON.stringify([{ href: "https://a.com" }, { description: "no url" }]),
      );
      expect(out).toHaveLength(1);
    });
  });

  describe("parseFirefoxPlaces", () => {
    it("walks the places.json tree and flattens folders", () => {
      const json = JSON.stringify({
        guid: "places",
        children: [
          {
            title: "Bookmarks Toolbar",
            type: "text",
            children: [
              {
                title: "Nested",
                type: "text",
                children: [
                  {
                    title: "Deep link",
                    uri: "https://deep.example.com",
                    tags: "alpha,beta",
                    dateAdded: 1704067200000,
                    lastModified: 1704153600000,
                  },
                ],
              },
              { title: "Top link", uri: "https://top.example.com", type: "text" },
              { title: "Folder without uri", type: "text", children: [] },
              { title: "Not http", uri: "place:sort=8", type: "text" },
              { title: "javascript", uri: "javascript:alert(1)", type: "text" },
            ],
          },
        ],
      });
      const out = parseFirefoxPlaces(json);
      expect(out).toHaveLength(2);
      expect(out![0]).toMatchObject({
        url: "https://deep.example.com",
        title: "Deep link",
        tags: ["alpha", "beta"],
        createdAt: "2024-01-01T00:00:00.000Z",
      });
      expect(out![1]!.url).toBe("https://top.example.com");
    });

    it("returns null for non-places JSON", () => {
      expect(parseFirefoxPlaces('{"bookmarks":[]}')).toBeNull();
      expect(parseFirefoxPlaces("not json")).toBeNull();
      expect(parseFirefoxPlaces('{"children":[]}')).toBeNull();
    });
  });
});
