// @vitest-environment node
/**
 * eslint-rules/no-direct-userevent.test.mjs
 *
 * RuleTester coverage for the no-direct-userevent rule: the import-binding
 * resolution (default / namespace / aliased named), the `setup` factory
 * exemption, the per-file count baseline (grandfathering, ceilings, and
 * cross-file isolation), and the computed-access limitation.
 */
import { describe } from "vitest";
import { RuleTester } from "eslint";
import rule from "./no-direct-userevent.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

const IMPORT = 'import userEvent from "@testing-library/user-event";';

describe("no-direct-userevent", () => {
  ruleTester.run("no-direct-userevent", rule, {
    valid: [
      // The preferred pattern: one shared instance drives the interactions.
      `${IMPORT}\nconst user = userEvent.setup({ delay: null });\nawait user.click(btn);`,
      // The factory call itself is never an offense.
      `${IMPORT}\nuserEvent.setup();`,
      // A same-named method on some other object is untouched.
      'import { click } from "./test-helpers.js";\nclick();',
      // Computed access is out of scope by design.
      `${IMPORT}\nuserEvent["click"](btn);`,
      // Baseline grandfathers the existing direct calls in that file.
      {
        code: `${IMPORT}\nuserEvent.click(btn);`,
        filename: "src/tests/legacy.test.tsx",
        options: [{ baseline: { "src/tests/legacy.test.tsx": 1 } }],
      },
      // A baseline entry for another file does not leak into this one.
      {
        code: `${IMPORT}\nuserEvent.setup();`,
        filename: "src/tests/other.test.tsx",
        options: [{ baseline: { "src/tests/legacy.test.tsx": 5 } }],
      },
    ],

    invalid: [
      // A new file (no baseline entry) may not use the direct API at all.
      {
        code: `${IMPORT}\nuserEvent.click(btn);`,
        filename: "src/tests/new.test.tsx",
        errors: [{ messageId: "directApi" }],
      },
      {
        code: `${IMPORT}\nuserEvent.type(input, "hi");`,
        filename: "src/tests/new.test.tsx",
        errors: [{ messageId: "directApi" }],
      },
      // Namespace import binding is resolved too.
      {
        code: 'import * as ue from "@testing-library/user-event";\nue.hover(el);',
        filename: "src/tests/new.test.tsx",
        errors: [{ messageId: "directApi" }],
      },
      // Aliased named import binding is resolved too.
      {
        code: 'import { userEvent as ue } from "@testing-library/user-event";\nue.dblClick(el);',
        filename: "src/tests/new.test.tsx",
        errors: [{ messageId: "directApi" }],
      },
      // The baseline is a ceiling: the count beyond it is reported.
      {
        code: `${IMPORT}\nuserEvent.click(a);\nuserEvent.click(b);`,
        filename: "src/tests/legacy.test.tsx",
        options: [{ baseline: { "src/tests/legacy.test.tsx": 1 } }],
        errors: [{ messageId: "directApi" }],
      },
      // An explicit zero is the same as no entry.
      {
        code: `${IMPORT}\nuserEvent.click(a);`,
        filename: "src/tests/legacy.test.tsx",
        options: [{ baseline: { "src/tests/legacy.test.tsx": 0 } }],
        errors: [{ messageId: "directApi" }],
      },
    ],
  });
});
