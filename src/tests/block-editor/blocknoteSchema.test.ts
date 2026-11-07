import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@blocknote/core", () => ({
  BlockNoteSchema: {
    create: vi.fn((opts: any) => ({ blockSpecs: opts.blockSpecs })),
  },
  defaultBlockSpecs: {
    paragraph: { type: "paragraph" },
    heading: { type: "heading" },
    bulletListItem: { type: "bulletListItem" },
  },
}));

vi.mock("../../components/block-editor/customBlocks", () => ({
  createCalloutBlockSpec: vi.fn(() => ({ type: "callout" })),
  createColumnLayoutBlockSpec: vi.fn(() => ({ type: "columnLayout" })),
  createColumnBlockSpec: vi.fn(() => ({ type: "column" })),
}));

describe("blocknoteSchema", () => {
  let mod: any;
  let coreMock: any;
  let customBlocksMock: any;

  beforeEach(async () => {
    vi.resetModules();
    coreMock = await import("@blocknote/core");
    customBlocksMock = await import(
      "../../components/block-editor/customBlocks"
    );
    mod = await import("../../components/block-editor/blocknoteSchema");
  });

  it("creates a BlockNote schema", () => {
    expect(coreMock.BlockNoteSchema.create).toHaveBeenCalled();
  });

  it("extends the default block specs", () => {
    expect(mod.schema.blockSpecs.paragraph).toEqual({ type: "paragraph" });
    expect(mod.schema.blockSpecs.heading).toEqual({ type: "heading" });
    expect(mod.schema.blockSpecs.bulletListItem).toEqual({
      type: "bulletListItem",
    });
  });

  it("registers the callout block spec", () => {
    expect(customBlocksMock.createCalloutBlockSpec).toHaveBeenCalled();
    expect(mod.schema.blockSpecs.callout).toEqual({ type: "callout" });
  });

  it("registers the column layout block spec", () => {
    expect(customBlocksMock.createColumnLayoutBlockSpec).toHaveBeenCalled();
    expect(mod.schema.blockSpecs.columnLayout).toEqual({
      type: "columnLayout",
    });
  });

  it("registers the column block spec", () => {
    expect(customBlocksMock.createColumnBlockSpec).toHaveBeenCalled();
    expect(mod.schema.blockSpecs.column).toEqual({ type: "column" });
  });
});
