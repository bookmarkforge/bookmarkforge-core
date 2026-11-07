// @vitest-environment node
/**
 * eslint-rules/no-silent-catch.test.mjs
 *
 * RuleTester unit tests for the no-silent-catch rule. Plain espree
 * parsing is enough — no JSX involved.
 */
import { describe } from "vitest";
import { RuleTester } from "eslint";
import rule from "./no-silent-catch.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

describe("no-silent-catch", () => {
  ruleTester.run("no-silent-catch", rule, {
    valid: [
      // Repo convention: empty catch with an INTENTIONAL SILENCE comment.
      "try { work(); } catch { /* INTENTIONAL SILENCE: the connection is already closed. */ }",
      // Any explanatory comment in the empty block passes.
      "try { work(); } catch (err) { /* best-effort cleanup */ }",
      // A line comment inside the empty block passes.
      "try { work(); } catch { // cleanup failure is non-fatal\n}",
      // Comment BEFORE the block inside the clause still counts.
      "try { work(); } catch (e) /* non-fatal */ { }",
      // Handling statements pass without any comment: re-throw.
      "try { work(); } catch (err) { throw err; }",
      // Logging is a statement.
      "try { work(); } catch (err) { console.error(err); }",
      // Returning a fallback is a statement.
      "function f() { try { work(); } catch { return fallback; } }",
      // Diversion statements pass.
      "for (;;) { try { work(); } catch { continue; } }",
      "for (;;) { try { work(); } catch { break; } }",
      // catch with optional binding + block comment also handled.
      "try { work(); } catch { /* INTENTIONAL SILENCE: covered by the metric below */ }",
      // No catch at all — nothing to check.
      "try { work(); } finally { cleanup(); }",
    ],

    invalid: [
      // The original sin: a bare skeleton with no statement and no comment.
      {
        code: "try { work(); } catch { }",
        errors: [{ messageId: "needJustification" }],
      },
      // Param form, still silent.
      {
        code: "try { work(); } catch (err) {}",
        errors: [{ messageId: "needJustification" }],
      },
      // Whitespace-only body is still silent.
      {
        code: "try { work(); } catch (err) {\n  \n}",
        errors: [{ messageId: "needJustification" }],
      },
      // A comment OUTSIDE the catch (before the try) does not justify it.
      {
        code: "// non-fatal\ntry { work(); } catch { }",
        errors: [{ messageId: "needJustification" }],
      },
    ],
  });
});