import {
  createBlockConfig,
  createBlockSpec,
  createExtension,
  defaultProps,
} from "@blocknote/core";

type _ColumnLayoutBlockConfig = ReturnType<
  typeof createColumnLayoutBlockConfig
>;
type _ColumnBlockConfig = ReturnType<typeof createColumnBlockConfig>;

const COLUMN_VALUES = [2, 3] as const;

const createColumnLayoutBlockConfig = createBlockConfig(
  () =>
    ({
      type: "columnLayout" as const,
      propSchema: {
        count: { default: 2, values: COLUMN_VALUES },
        backgroundColor: defaultProps.backgroundColor,
        textColor: defaultProps.textColor,
      },
      content: "none" as const,
    }) as const,
);

const createColumnBlockConfig = createBlockConfig(
  () =>
    ({
      type: "column" as const,
      propSchema: {
        backgroundColor: defaultProps.backgroundColor,
        textColor: defaultProps.textColor,
      },
      content: "inline" as const,
    }) as const,
);

export const createColumnLayoutBlockSpec = createBlockSpec(
  createColumnLayoutBlockConfig,
  {
    parse(element) {
      if (
        element.tagName === "DIV" &&
        element.getAttribute("data-column-layout")
      ) {
        return {
          count: parseInt(
            element.getAttribute("data-column-count") || "2",
            10,
          ) as (typeof COLUMN_VALUES)[number],
        };
      }
      return undefined;
    },
    render() {
      const wrapper = document.createElement("div");
      wrapper.className = "bn-column-layout";
      return {
        dom: wrapper,
      };
    },
    toExternalHTML() {
      const wrapper = document.createElement("div");
      wrapper.className = "bn-column-layout";
      wrapper.setAttribute("data-column-layout", "");
      return { dom: wrapper };
    },
  },
  [
    createExtension({
      key: "column-layout-shortcuts",
      keyboardShortcuts: {
        "Mod-Alt-l": ({ editor }) => {
          const cursorPosition = editor.getTextCursorPosition();
          const schema = editor.schema.blockSchema;
          if (schema[cursorPosition.block.type]?.content !== "inline")
            {return false;}
          const count = 2;
          const columns = Array.from({ length: count }, () => ({
            type: "column" as const,
            props: {},
            content: [],
          }));
          editor.updateBlock(cursorPosition.block, {
            type: "columnLayout",
            props: { count },
            children: columns,
          });
          return true;
        },
      },
    }),
  ],
);

export const createColumnBlockSpec = createBlockSpec(createColumnBlockConfig, {
  parse(element) {
    if (
      element.tagName === "DIV" &&
      element.getAttribute("data-column") !== null
    ) {
      return {};
    }
    return undefined;
  },
  render() {
    const div = document.createElement("div");
    div.className = "bn-column-content";
    return { dom: div, contentDOM: div };
  },
  toExternalHTML() {
    const div = document.createElement("div");
    div.className = "bn-column-content";
    div.setAttribute("data-column", "");
    return { dom: div, contentDOM: div };
  },
});
