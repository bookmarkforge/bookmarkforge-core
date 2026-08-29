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

const { createCalloutBlockSpec } =
  await import("../../components/block-editor/customBlocks/callout");

describe("callout block spec", () => {
  let spec: any;

  beforeEach(() => {
    vi.clearAllMocks();
    spec = createCalloutBlockSpec;
  });

  describe("config", () => {
    it("has type 'callout'", () => {
      expect(spec.config.type).toBe("callout");
    });

    it("has correct propSchema defaults", () => {
      expect(spec.config.propSchema.icon.default).toBe("💡");
      expect(spec.config.propSchema.color.default).toBe("blue");
    });

    it("defines all color values", () => {
      expect(spec.config.propSchema.color.values).toEqual([
        "blue",
        "green",
        "amber",
        "red",
        "cyan",
      ]);
    });

    it("has content 'inline'", () => {
      expect(spec.config.content).toBe("inline");
    });
  });

  describe("implementation.parse", () => {
    it("parses valid callout div element", () => {
      const el = {
        tagName: "DIV",
        getAttribute: (attr: string) => {
          if (attr === "data-callout") return "true";
          if (attr === "data-callout-icon") return "🔥";
          if (attr === "data-callout-color") return "red";
          return null;
        },
      };
      const result = spec.implementation.parse(el);
      expect(result).toEqual({ icon: "🔥", color: "red" });
    });

    it("returns default icon when data-callout-icon is missing", () => {
      const el = {
        tagName: "DIV",
        getAttribute: (attr: string) => {
          if (attr === "data-callout") return "true";
          return null;
        },
      };
      const result = spec.implementation.parse(el);
      expect(result).toEqual({ icon: "💡", color: "blue" });
    });

    it("returns undefined for non-DIV element", () => {
      const el = {
        tagName: "SPAN",
        getAttribute: vi.fn(),
      };
      const result = spec.implementation.parse(el);
      expect(result).toBeUndefined();
    });

    it("returns undefined for DIV without data-callout", () => {
      const el = {
        tagName: "DIV",
        getAttribute: vi.fn().mockReturnValue(null),
      };
      const result = spec.implementation.parse(el);
      expect(result).toBeUndefined();
    });

    it("parses all color variants", () => {
      for (const color of ["blue", "green", "amber", "red", "cyan"]) {
        const el = {
          tagName: "DIV",
          getAttribute: (attr: string) => {
            if (attr === "data-callout") return "true";
            if (attr === "data-callout-color") return color;
            return null;
          },
        };
        const result = spec.implementation.parse(el);
        expect(result!.color).toBe(color);
      }
    });
  });

  describe("implementation.render", () => {
    it("creates wrapper with bn-callout class", () => {
      const { dom, contentDOM, ignoreMutation } = spec.implementation.render();
      expect(dom.className).toBe("bn-callout");
    });

    it("creates icon span with bn-callout-icon class", () => {
      const { dom } = spec.implementation.render();
      const iconSpan = dom.querySelector(".bn-callout-icon");
      expect(iconSpan).toBeDefined();
      expect((iconSpan as any).contentEditable).toBe("false");
    });

    it("creates content div with bn-callout-content class", () => {
      const { contentDOM } = spec.implementation.render();
      expect(contentDOM.className).toBe("bn-callout-content");
    });

    it("ignoreMutation returns true for attribute changes", () => {
      const { ignoreMutation } = spec.implementation.render();
      expect(ignoreMutation({ type: "attributes" })).toBe(true);
    });

    it("ignoreMutation returns true when target is inside icon span", () => {
      const { dom, ignoreMutation } = spec.implementation.render();
      const iconSpan = dom.querySelector(".bn-callout-icon");
      const child = document.createElement("span");
      iconSpan!.appendChild(child);
      expect(ignoreMutation({ target: child })).toBe(true);
    });

    it("ignoreMutation returns false for unrelated mutations", () => {
      const { ignoreMutation } = spec.implementation.render();
      const unrelatedNode = document.createElement("div");
      expect(
        ignoreMutation({ type: "characterData", target: unrelatedNode }),
      ).toBe(false);
    });
  });

  describe("implementation.toExternalHTML", () => {
    it("creates wrapper with correct class and data attributes", () => {
      const block = {
        props: {
          icon: "🔥",
          color: "red",
        },
      };
      const { dom } = spec.implementation.toExternalHTML(block);
      expect(dom.className).toBe("bn-callout bn-callout-red");
      expect(dom.getAttribute("data-callout")).toBe("");
      expect(dom.getAttribute("data-callout-icon")).toBe("🔥");
      expect(dom.getAttribute("data-callout-color")).toBe("red");
    });

    it("renders icon text in span", () => {
      const block = {
        props: { icon: "💡", color: "blue" },
      };
      const { dom } = spec.implementation.toExternalHTML(block);
      const iconSpan = dom.querySelector(".bn-callout-icon");
      expect(iconSpan!.textContent).toBe("💡");
    });

    it("creates content div for contentDOM", () => {
      const block = {
        props: { icon: "💡", color: "blue" },
      };
      const { contentDOM } = spec.implementation.toExternalHTML(block);
      expect(contentDOM).toBeDefined();
    });
  });

  describe("extensions", () => {
    it("has callout-shortcuts extension", () => {
      expect(spec.extensions).toHaveLength(1);
      expect(spec.extensions[0].key).toBe("callout-shortcuts");
    });

    it("has Mod-Alt-c keyboard shortcut", () => {
      const shortcuts = spec.extensions[0].keyboardShortcuts;
      expect(shortcuts).toHaveProperty("Mod-Alt-c");
    });
  });
});
