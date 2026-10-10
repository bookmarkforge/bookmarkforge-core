// @vitest-environment node
/**
 * eslint-rules/no-unexplained-test-skip.test.mjs
 *
 * RuleTester unit tests for the no-unexplained-test-skip rule. No JSX
 * involved — plain espree parsing is enough.
 */
import { describe } from "vitest";
import { RuleTester } from "eslint";
import rule from "./no-unexplained-test-skip.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

describe("no-unexplained-test-skip", () => {
  ruleTester.run("no-unexplained-test-skip", rule, {
    valid: [
      // Declaration form: the name string IS the reason.
      "test.skip('renders empty state', async ({ page }) => {});",
      // Conditional skip with an inline description.
      "test.skip(isWebKit, 'flaky on WebKit - see #1234');",
      // Single-string reason form.
      "test.skip('temporarily disabled until v2');",
      // `test.fixme` with a name string.
      "test.fixme('revisit after layout refactor', async () => {});",
      // `test.todo` with a name.
      "test.todo('add keyboard nav test');",
      // Comment on the line directly above.
      "// Only run narrow-viewport on the most overflow-prone locales\ntest.skip();",
      // Trailing comment on the same line.
      "test.skip(); // reason: pending upstream fixture",
      // `skipIf` env guard is intentionally out of scope.
      "test.skipIf(!serverEntryExists)('server', async () => {});",
      // `describe.skipIf` / `describe.skip` forms are out of scope.
      "test.describe.skipIf(!docsExist)('docs integrity', () => {});",
      "test.describe.skip('legacy suite', () => {});",
      // Unrelated member calls are untouched.
      "foo.skip();",
      "test.only('focused test', async () => {});",
    ],

    invalid: [
      // Bare no-arg skip - the original sin (visual-testing.spec.ts).
      {
        code: "test.skip();",
        errors: [{ messageId: "needReason" }],
      },
      // Conditional skip without a reason string or comment.
      {
        code: "test.skip(cond);",
        errors: [{ messageId: "needReason" }],
      },
      {
        code: "test.fixme();",
        errors: [{ messageId: "needReason" }],
      },
      {
        code: "test.todo();",
        errors: [{ messageId: "needReason" }],
      },
      {
        code: "it.skip();",
        errors: [{ messageId: "needReason" }],
      },
      // A comment separated by a blank line does NOT count as adjacent -
      // it may belong to a different statement.
      {
        code: "// reason\n\ntest.skip();",
        errors: [{ messageId: "needReason" }],
      },
      // Empty template literal is not a reason.
      {
        code: "test.skip(``);",
        errors: [{ messageId: "needReason" }],
      },
    ],
  });
});
