import { describe, it, expect } from "vitest";
import {
  enexDateToIso,
  enmlToText,
  parseEnexDocument,
} from "../../services/importer.enex";

function b64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function enexNote(opts: {
  title?: string;
  enml?: string;
  created?: string;
  updated?: string;
  tags?: string[];
  guid?: string;
  resources?: number;
}): string {
  const tags = (opts.tags ?? []).map((t) => `<tag>${t}</tag>`).join("");
  const resources = Array.from(
    { length: opts.resources ?? 0 },
    () => "<resource><data>AAAA</data></resource>",
  ).join("");
  return `<note>
<title>${opts.title ?? "Note"}</title>
<content>${b64(opts.enml ?? "<en-note><div>Body</div></en-note>")}</content>
<created>${opts.created ?? "20240101T120000Z"}</created>
<updated>${opts.updated ?? "20240102T120000Z"}</updated>
${tags}${opts.guid ? `<guid>${opts.guid}</guid>` : ""}${resources}
</note>`;
}

function enexDoc(notes: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20240101T000000Z" application="Evernote" version="10.0">
${notes}
</en-export>`;
}

describe("importer.enex", () => {
  describe("enexDateToIso", () => {
    it("converts Evernote compact dates to ISO", () => {
      expect(enexDateToIso("20240101T120000Z")).toBe("2024-01-01T12:00:00.000Z");
      expect(enexDateToIso("20231231T235959")).toBe("2023-12-31T23:59:59.000Z");
    });
    it("returns undefined for empty/invalid input", () => {
      expect(enexDateToIso("")).toBeUndefined();
      expect(enexDateToIso("not-a-date")).toBeUndefined();
      expect(enexDateToIso(null)).toBeUndefined();
    });
  });

  describe("enmlToText", () => {
    it("converts headings, bold, lists and todos to markdown-lite", () => {
      const md = enmlToText(
        `<en-note><h1>Main</h1><div>Hello <b>bold</b> and <i>italic</i></div>` +
          `<ul><li>First</li><li>Second</li></ul>` +
          `<div><en-todo checked="true"/>Done</div><div><en-todo/>Pending</div>` +
          `<a href="https://example.com">a link</a></en-note>`,
      );
      expect(md).toContain("# Main");
      expect(md).toContain("**bold**");
      expect(md).toContain("*italic*");
      expect(md).toContain("- First");
      expect(md).toContain("- Second");
      expect(md).toContain("- [x] Done");
      expect(md).toContain("- [ ] Pending");
      expect(md).toContain("[a link](https://example.com)");
    });

    it("skips en-media and en-crypt elements", () => {
      const md = enmlToText(
        `<en-note><div>Before<en-media type="image" hash="abc"/><en-crypt/>After</div></en-note>`,
      );
      expect(md).toBe("BeforeAfter");
    });

    it("renders blockquotes and code blocks", () => {
      const md = enmlToText(
        `<en-note><blockquote><div>quoted</div></blockquote><pre>code();</pre></en-note>`,
      );
      expect(md).toContain("> quoted");
      expect(md).toContain("```");
      expect(md).toContain("code();");
    });
  });

  describe("parseEnexDocument", () => {
    it("returns null for non-ENEX XML", () => {
      expect(parseEnexDocument("<root><note/></root>")).toBeNull();
      expect(parseEnexDocument("not xml at all")).toBeNull();
      expect(parseEnexDocument("")).toBeNull();
    });

    it("parses notes with title, tags, dates, guid and decoded content", () => {
      const xml = enexDoc(
        enexNote({
          title: "My Note",
          enml: "<en-note><h1>Hi</h1><div>Content here</div></en-note>",
          tags: ["work", "ideas"],
          guid: "abc-123_guid",
          resources: 2,
        }),
      );
      const notes = parseEnexDocument(xml);
      expect(notes).not.toBeNull();
      expect(notes).toHaveLength(1);
      const n = notes![0]!;
      expect(n.title).toBe("My Note");
      expect(n.tags).toEqual(["work", "ideas"]);
      expect(n.guid).toBe("abc-123_guid");
      expect(n.createdAt).toBe("2024-01-01T12:00:00.000Z");
      expect(n.updatedAt).toBe("2024-01-02T12:00:00.000Z");
      expect(n.hasResources).toBe(true);
      expect(n.textContent).toContain("# Hi");
      expect(n.textContent).toContain("Content here");
    });

    it("parses multiple notes and tolerates missing optional fields", () => {
      const xml = enexDoc(
        enexNote({ title: "One", guid: "g1" }) +
          `<note><title></title><content>${b64("<en-note/>")}</content></note>`,
      );
      const notes = parseEnexDocument(xml);
      expect(notes).toHaveLength(2);
      expect(notes![0]!.guid).toBe("g1");
      expect(notes![1]!.title).toBe("Untitled Note");
      expect(notes![1]!.guid).toBeUndefined();
      expect(notes![1]!.hasResources).toBe(false);
    });

    it("keeps the note with empty body when content is undecodable", () => {
      const xml = enexDoc(
        `<note><title>Bad</title><content>!!!not-base64!!!</content></note>`,
      );
      const notes = parseEnexDocument(xml);
      expect(notes).toHaveLength(1);
      expect(notes![0]!.title).toBe("Bad");
      expect(notes![0]!.textContent).toBe("");
    });

    it("rejects guid values outside the safe charset", () => {
      const xml = enexDoc(enexNote({ guid: "bad guid!@#" }));
      const notes = parseEnexDocument(xml);
      expect(notes![0]!.guid).toBeUndefined();
    });
  });

  describe("enmlToText hardening", () => {
    it("marks en-todo checked by attribute presence in any form", () => {
      const md = enmlToText(
        `<en-note><ul>` +
          `<li><en-todo checked="true"/>Done A</li>` +
          `<li><en-todo checked=""/>Done B</li>` +
          `<li><en-todo checked="checked"/>Done C</li>` +
          `<li><en-todo/>Todo D</li>` +
          `</ul></en-note>`,
      );
      expect(md).toContain("- [x] Done A");
      expect(md).toContain("- [x] Done B");
      expect(md).toContain("- [x] Done C");
      expect(md).toContain("- [ ] Todo D");
      expect(md).not.toContain("- - [");
    });

    it("drops non-http(s) anchor targets but keeps the text", () => {
      const md = enmlToText(
        `<en-note><div><a href="javascript:alert(1)">click me</a> ` +
          `<a href="data:text/html,x">data link</a></div></en-note>`,
      );
      expect(md).toContain("click me");
      expect(md).toContain("data link");
      expect(md).not.toContain("javascript:");
      expect(md).not.toContain("data:text/html");
    });

    it("keeps the bare URL when an http anchor has no text", () => {
      const md = enmlToText(
        `<en-note><div>See <a href="https://example.com/x"></a> end</div></en-note>`,
      );
      expect(md).toContain("https://example.com/x");
    });
  });
});
