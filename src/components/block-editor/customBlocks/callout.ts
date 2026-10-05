import {
  createBlockConfig,
  createBlockSpec,
  createExtension,
  defaultProps,
} from "@blocknote/core";

type _CalloutBlockConfig = ReturnType<typeof createCalloutBlockConfig>;

const createCalloutBlockConfig = createBlockConfig(
  () =>
    ({
      type: "callout" as const,
      propSchema: {
        icon: { default: "💡" },
        color: {
          default: "blue",
          values: ["blue", "green", "amber", "red", "cyan"] as const,
        },
        backgroundColor: defaultProps.backgroundColor,
        textColor: defaultProps.textColor,
      },
      content: "inline" as const,
    }) as const,
);

export const createCalloutBlockSpec = createBlockSpec(
  createCalloutBlockConfig,
  {
    parse(element) {
      if (element.tagName === "DIV" && element.getAttribute("data-callout")) {
        const ALLOWED_COLORS = [
          "blue",
          "green",
          "amber",
          "red",
          "cyan",
        ] as const;
        const rawColor = element.getAttribute("data-callout-color") || "blue";
        const color = (ALLOWED_COLORS as readonly string[]).includes(rawColor)
          ? (rawColor as (typeof ALLOWED_COLORS)[number])
          : "blue";
        const icon = element.getAttribute("data-callout-icon") || "💡";
        return {
          icon,
          color,
        } as const;
      }
      return undefined;
    },
    render() {
      const wrapper = document.createElement("div");
      wrapper.className = "bn-callout";
      const iconSpan = document.createElement("span");
      iconSpan.className = "bn-callout-icon";
      iconSpan.contentEditable = "false";
      wrapper.appendChild(iconSpan);
      const contentDiv = document.createElement("div");
      contentDiv.className = "bn-callout-content";
      wrapper.appendChild(contentDiv);
      return {
        dom: wrapper,
        contentDOM: contentDiv,
        ignoreMutation: (mutation) =>
          mutation.type === "attributes" ||
          iconSpan.contains(mutation.target as Node),
      };
    },
    toExternalHTML(block) {
      const wrapper = document.createElement("div");
      wrapper.className = `bn-callout bn-callout-${block.props.color}`;
      wrapper.setAttribute("data-callout", "");
      wrapper.setAttribute("data-callout-icon", block.props.icon);
      wrapper.setAttribute("data-callout-color", block.props.color);
      const iconSpan = document.createElement("span");
      iconSpan.className = "bn-callout-icon";
      iconSpan.textContent = block.props.icon;
      wrapper.appendChild(iconSpan);
      const contentDiv = document.createElement("div");
      wrapper.appendChild(contentDiv);
      return { dom: wrapper, contentDOM: contentDiv };
    },
  },
  [
    createExtension({
      key: "callout-shortcuts",
      keyboardShortcuts: {
        "Mod-Alt-c": ({ editor }) => {
          const cursorPosition = editor.getTextCursorPosition();
          if (
            editor.schema.blockSchema[cursorPosition.block.type]?.content !==
            "inline"
          )
            {return false;}
          editor.updateBlock(cursorPosition.block, {
            type: "callout",
            props: {},
          });
          return true;
        },
      },
    }),
  ],
);
