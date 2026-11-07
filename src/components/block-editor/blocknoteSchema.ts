import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import {
  createCalloutBlockSpec,
  createColumnLayoutBlockSpec,
  createColumnBlockSpec,
} from "./customBlocks";

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: createCalloutBlockSpec(),
    columnLayout: createColumnLayoutBlockSpec(),
    column: createColumnBlockSpec(),
  },
});
