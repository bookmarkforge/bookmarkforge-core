import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@blocknote/core", () => ({
  createBlockConfig: vi.fn((fn: () => any) => fn()),
  createBlockSpec: vi.fn(
    (config: any, implementation: any, extensions?: any[]) => {
      const spec = {
        config,
        implementation,
        extensions: extensions ?? [],
      };
      return spec;
    },
  ),
  createExtension: vi.fn((ext: any) => ext),
  defaultProps: {
    backgroundColor: { default: "default" },
    textColor: { default: "default" },
  },
}));

// Production `customBlocks/columnLayout.ts` exports the resolved BlockSpec
// objects directly (e.g. `export const createColumnLayoutBlockSpec = createBlockSpec(...)`).
// Tests below access properties on the SPEC object, not a factory callable.
// The dynamic import types `createColumnLayoutBlockSpec` as a function
// `(options?) => BlockSpec` because that's how `@blocknote/core` types the
// passed-through `createBlockSpec` generic. We wrap the import with `as any`
// to satisfy TS without altering runtime — the imported values ARE the
// resolved spec objects (single clean cast vs. 22 scattered `as any` sites).
const { createColumnLayoutBlockSpec, createColumnBlockSpec } = (await import(
  "../../components/block-editor/customBlocks/columnLayout"
)) as any;

describe("columnLayout block spec", () => {
  describe("config", () => {
    it("has type 'columnLayout'", () => {
      expect((createColumnLayoutBlockSpec as any).config.type).toBe("columnLayout");
    });

    it("has count default of 2", () => {
      expect(createColumnLayoutBlockSpec.config.propSchema.count.default).toBe(
        2,
      );
    });

    it("allows count values [2, 3]", () => {
      expect(
        createColumnLayoutBlockSpec.config.propSchema.count.values,
      ).toEqual([2, 3]);
    });

    it("has content 'none'", () => {
      expect(createColumnLayoutBlockSpec.config.content).toBe("none");
    });
  });

  describe("columnLayout implementation.parse", () => {
    it("parses valid column-layout div", () => {
      const el = {
        tagName: "DIV",
        getAttribute: (attr: string) => {
          if (attr === "data-column-layout") return "true";
          if (attr === "data-column-count") return "3";
          return null;
        },
      };
      const result = createColumnLayoutBlockSpec.implementation.parse(el);
      expect(result).toEqual({ count: 3 });
    });

    it("defaults to count 2 when data-column-count is missing", () => {
      const el = {
        tagName: "DIV",
        getAttribute: (attr: string) => {
          if (attr === "data-column-layout") return "true";
          return null;
        },
      };
      const result = createColumnLayoutBlockSpec.implementation.parse(el);
      expect(result).toEqual({ count: 2 });
    });

    it("returns undefined for non-DIV element", () => {
      const el = {
        tagName: "SPAN",
        getAttribute: vi.fn(),
      };
      const result = createColumnLayoutBlockSpec.implementation.parse(el);
      expect(result).toBeUndefined();
    });

    it("returns undefined for DIV without data-column-layout", () => {
      const el = {
        tagName: "DIV",
        getAttribute: vi.fn().mockReturnValue(null),
      };
      const result = createColumnLayoutBlockSpec.implementation.parse(el);
      expect(result).toBeUndefined();
    });

    it("parses count=2", () => {
      const el = {
        tagName: "DIV",
        getAttribute: (attr: string) => {
          if (attr === "data-column-layout") return "true";
          if (attr === "data-column-count") return "2";
          return null;
        },
      };
      const result = createColumnLayoutBlockSpec.implementation.parse(el);
      expect(result).toEqual({ count: 2 });
    });
  });

  describe("columnLayout implementation.render", () => {
    it("creates wrapper with bn-column-layout class", () => {
      const { dom } = createColumnLayoutBlockSpec.implementation.render();
      expect(dom.className).toBe("bn-column-layout");
    });
  });

  describe("columnLayout implementation.toExternalHTML", () => {
    it("creates wrapper with data-column-layout attribute", () => {
      const { dom } =
        createColumnLayoutBlockSpec.implementation.toExternalHTML();
      expect(dom.className).toBe("bn-column-layout");
      expect(dom.getAttribute("data-column-layout")).toBe("");
    });
  });

  describe("columnLayout extensions", () => {
    it("has column-layout-shortcuts extension", () => {
      expect(createColumnLayoutBlockSpec.extensions).toHaveLength(1);
      expect(createColumnLayoutBlockSpec.extensions[0].key).toBe(
        "column-layout-shortcuts",
      );
    });

    it("has Mod-Alt-l keyboard shortcut", () => {
      const shortcuts =
        createColumnLayoutBlockSpec.extensions[0].keyboardShortcuts;
      expect(shortcuts).toHaveProperty("Mod-Alt-l");
    });

    describe("Mod-Alt-l handler", () => {
      const shortcut = () =>
        createColumnLayoutBlockSpec.extensions[0].keyboardShortcuts["Mod-Alt-l"];

      it("returns false when the current block is not inline", () => {
        const updateBlock = vi.fn();
        const result = shortcut()({
          editor: {
            getTextCursorPosition: () => ({ block: { type: "paragraph" } }),
            schema: {
              blockSchema: {
                paragraph: { content: "none" },
              },
            },
            updateBlock,
          },
        });
        expect(result).toBe(false);
        expect(updateBlock).not.toHaveBeenCalled();
      });

      it("returns false when the block type is missing from the schema", () => {
        const updateBlock = vi.fn();
        const result = shortcut()({
          editor: {
            getTextCursorPosition: () => ({ block: { type: "ghost" } }),
            schema: { blockSchema: {} },
            updateBlock,
          },
        });
        expect(result).toBe(false);
        expect(updateBlock).not.toHaveBeenCalled();
      });

      it("wraps the current inline block into a 2-column layout", () => {
        const updateBlock = vi.fn();
        const cursorBlock = { type: "paragraph" };
        const result = shortcut()({
          editor: {
            getTextCursorPosition: () => ({ block: cursorBlock }),
            schema: {
              blockSchema: {
                paragraph: { content: "inline" },
              },
            },
            updateBlock,
          },
        });
        expect(result).toBe(true);
        expect(updateBlock).toHaveBeenCalledWith(cursorBlock, {
          type: "columnLayout",
          props: { count: 2 },
          children: [
            { type: "column", props: {}, content: [] },
            { type: "column", props: {}, content: [] },
          ],
        });
      });
    });
  });
});

describe("column block spec", () => {
  describe("config", () => {
    it("has type 'column'", () => {
      expect(createColumnBlockSpec.config.type).toBe("column");
    });

    it("has content 'inline'", () => {
      expect(createColumnBlockSpec.config.content).toBe("inline");
    });
  });

  describe("column implementation.parse", () => {
    it("parses valid column div", () => {
      const el = {
        tagName: "DIV",
        getAttribute: (attr: string) => {
          if (attr === "data-column") return "";
          return null;
        },
      };
      const result = createColumnBlockSpec.implementation.parse(el);
      expect(result).toEqual({});
    });

    it("returns undefined for non-DIV element", () => {
      const el = {
        tagName: "SPAN",
        getAttribute: vi.fn(),
      };
      const result = createColumnBlockSpec.implementation.parse(el);
      expect(result).toBeUndefined();
    });

    it("returns undefined for DIV without data-column", () => {
      const el = {
        tagName: "DIV",
        getAttribute: vi.fn().mockReturnValue(null),
      };
      const result = createColumnBlockSpec.implementation.parse(el);
      expect(result).toBeUndefined();
    });

    it("returns undefined for DIV with data-column=null", () => {
      const el = {
        tagName: "DIV",
        getAttribute: vi.fn().mockReturnValue(null),
      };
      const result = createColumnBlockSpec.implementation.parse(el);
      expect(result).toBeUndefined();
    });
  });

  describe("column implementation.render", () => {
    it("creates div with bn-column-content class", () => {
      const { dom, contentDOM } = createColumnBlockSpec.implementation.render();
      expect(dom.className).toBe("bn-column-content");
      expect(contentDOM).toBe(dom);
    });
  });

  describe("column implementation.toExternalHTML", () => {
    it("creates div with data-column attribute", () => {
      const { dom, contentDOM } =
        createColumnBlockSpec.implementation.toExternalHTML();
      expect(dom.className).toBe("bn-column-content");
      expect(dom.getAttribute("data-column")).toBe("");
      expect(contentDOM).toBe(dom);
    });
  });
});
