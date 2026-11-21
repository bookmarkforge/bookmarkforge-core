// @vitest-environment node
/**
 * eslint-rules/no-unbounded-card-header.test.mjs
 *
 * Vitest unit tests for the no-unbounded-card-header rule — the narrow
 * companion to no-unbounded-text (only <h1>..<h4> inside a `<div>` card
 * wrapper). Uses ESLint's RuleTester with the same parser/lint scope as
 * the project's eslint.config.js so JSX + TypeScript surface both render
 * correctly.
 *
 * The `// @vitest-environment node` pragma avoids loading jsdom for
 * these tests — there is nothing DOM-relevant to verify.
 */
import { describe } from "vitest";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import rule from "./no-unbounded-card-header.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

/** Compose a valid JSX-bearing fixture; the leading non-JSX prefix keeps
 *  the AST grounded so the parser does not try to interpret the JSX as
 *  block-level code alone. */
const F = (jsx) => `const X = () => (${jsx});`;

describe("no-unbounded-card-header", () => {
  ruleTester.run("no-unbounded-card-header", rule, {
    valid: [
      // Not a heading — <span>/<p>/<div> are out of scope.
      F(`<div className="card"><span>{label}</span></div>`),
      // h5/h6 are explicitly out of scope for card titles.
      F(`<div className="card"><h5>{title}</h5></div>`),
      F(`<div className="card"><h6>{title}</h6></div>`),
      // Heading with static text only — no dynamic surface.
      F(`<div className="card"><h2>Static Title</h2></div>`),
      // Heading with `{children}` — composition boundary, exempt.
      F(`<div className="card"><h2>{children}</h2></div>`),
      // Defense on the heading itself: truncate.
      F(`<div className="card"><h2 className="truncate">{title}</h2></div>`),
      // Defense: line-clamp-2.
      F(`<div className="card"><h3 className="line-clamp-2">{title}</h3></div>`),
      // Defense: bare line-clamp (Tailwind 4).
      F(`<div className="card"><h2 className="line-clamp">{title}</h2></div>`),
      // Defense: max-w-md preset.
      F(`<div className="card"><h4 className="max-w-md">{title}</h4></div>`),
      // Defense: max-w arbitrary value.
      F(`<div className="card"><h2 className="max-w-[200px]">{title}</h2></div>`),
      // Defense via template-literal className.
      F(`<div className="card"><h2 className={\`text-lg max-w-md\`}>{title}</h2></div>`),
      // Wrapper className is a NON-container token — ds-bg-card is a color
      // token, ds-radius-card is a radius token, ds-card-title/subtitle are
      // text tokens (not card containers).
      F(`<div className="ds-bg-card"><h2>{title}</h2></div>`),
      F(`<div className="ds-radius-card"><h2>{title}</h2></div>`),
      F(`<div className="ds-card-title"><h2>{title}</h2></div>`),
      F(`<div className="ds-card-subtitle"><h2>{title}</h2></div>`),
      F(`<div className="security-card-in"><h2>{title}</h2></div>`),
      // Wrapper is not a <div> — <section>/<article> out of scope.
      F(`<section className="card"><h2>{title}</h2></section>`),
      F(`<article className="card"><h2>{title}</h2></article>`),
      // No card wrapper at all.
      F(`<h2>{title}</h2>`),
      // Card wrapper is BEYOND the depth limit — out of scope. The card
      // div sits at ancestor depth 11 (10 plain divs between it and the
      // heading), so the walk breaks before inspecting it.
      "const X = () => (<div className=\"card\"><div><div><div><div><div><div><div><div><div><div><h2>{title}</h2></div></div></div></div></div></div></div></div></div></div></div>);",
      // Static string-literal inside an expression container.
      F(`<div className="card"><h2>{"Static"}</h2></div>`),
    ],

    invalid: [
      // Direct `{title}` in a card div heading.
      {
        code: F(`<div className="card"><h2>{title}</h2></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Mixed static text + dynamic expression.
      {
        code: F(`<div className="card"><h2>Items: {count}</h2></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Function-call expression (i18n).
      {
        code: F(`<div className="card"><h2>{t("app_title")}</h2></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // ds-card (the real repo container token).
      {
        code: F(`<div className="ds-card"><h2>{title}</h2></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // ds-card-soft token.
      {
        code: F(`<div className="ds-card-soft"><h3>{item.title}</h3></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // ds-card-soft-primary token.
      {
        code: F(`<div className="ds-card-soft-primary p-6"><h2>{title}</h2></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // card-inactive token.
      {
        code: F(`<div className="card-inactive"><h4>{name}</h4></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Heading in card with other classes around the token.
      {
        code: F(`<div className="flex ds-card p-4"><h1>{title}</h1></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Nested wrapper between the card div and the heading.
      {
        code: F(`<div className="card"><section><div><h2>{title}</h2></div></section></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Conditional expression.
      {
        code: F(`<div className="card"><h2>{cond ? "On" : "Off"}</h2></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Optional chaining.
      {
        code: F(`<div className="card"><h2>{maybe?.title}</h2></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Spread of children.
      {
        code: F(`<div className="card"><h2>{...children}</h2></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Type cast.
      {
        code: F(`<div className="card"><h2>{title as string}</h2></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Template literal with interpolation.
      {
        code: "const X = () => (<div className=\"card\"><h2>{`prefix-${x}-suffix`}</h2></div>);",
        errors: [{ messageId: "needDefense" }],
      },
      // whitespace-nowrap is NOT a defense.
      {
        code: F(`<div className="card"><h2 className="whitespace-nowrap">{title}</h2></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // overflow-hidden is NOT a defense.
      {
        code: F(`<div className="card"><h2 className="overflow-hidden">{title}</h2></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Dynamic className (cx/clsx/styled) — cannot verify, conservative.
      {
        code: F(`<div className="card"><h2 className={cx("ds-h2")}>{title}</h2></div>`),
        errors: [{ messageId: "needDefense" }],
      },
    ],
  });
});
