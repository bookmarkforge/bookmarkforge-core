// @vitest-environment node
/**
 * eslint-rules/no-unbounded-text.test.mjs
 *
 * Vitest unit tests for the no-unbounded-text rule. Uses ESLint's
 * RuleTester with the same parser/lint scope as the project's
 * eslint.config.js so JSX + TypeScript surface both render correctly.
 *
 * The `// @vitest-environment node` pragma avoids loading jsdom for
 * these tests — there is nothing DOM-relevant to verify.
 */
import { describe } from "vitest";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import rule from "./no-unbounded-text.mjs";

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

describe("no-unbounded-text", () => {
  ruleTester.run("no-unbounded-text", rule, {
    valid: [
      // Self-closing element — no children — skip.
      F(`<button />`),
      // Pure static text — no expressions — skip.
      F(`<button>Save</button>`),
      // Composition boundary: `{children}` is exempt.
      F(`<button>{children}</button>`),
      // Defense: `truncate` on the element itself.
      F(`<button className="truncate">{label}</button>`),
      // Defense: `line-clamp-2`.
      F(`<td className="line-clamp-2">{description}</td>`),
      // Defense: bare `line-clamp` (Tailwind 4).
      F(`<button className="line-clamp">{title}</button>`),
      // Defense: `max-w-md` Tailwind preset.
      F(`<button className="bg-blue-500 max-w-md">{title}</button>`),
      // Defense: `max-w-[200px]` Tailwind arbitrary value.
      F(`<button className="max-w-[200px]">{title}</button>`),
      // Static string-literal inside an expression container.
      F(`<button>{"Save"}</button>`),
      // Tooltip with static-string label — no dynamic surface.
      F(`<Tooltip label="static">x</Tooltip>`),
      // Tooltip with dynamic label BUT classNames.tooltip has `max-w-md`.
      F(
        `<Tooltip label={text} classNames={{ tooltip: "max-w-md truncate" }}>x</Tooltip>`,
      ),
      // Heading not in card context — class does not match, no card ancestor.
      F(`<h2>{title}</h2>`),
      // Heading in card context WITH defense on the heading.
      F(`<div className="card"><h2 className="truncate">{title}</h2></div>`),
      // Heading with self-card-title class WITH defense.
      F(`<h2 className="card-title truncate">{title}</h2>`),
      // Out-of-scope elements (e.g. <span>, <p>).
      F(`<span>{label}</span>`),
      F(`<p>{description}</p>`),
      // Tooltip with no label prop — no overflow surface.
      F(`<Tooltip>x</Tooltip>`),
      // Template literal with NO interpolations is static.
      "const X = () => (<button>{`static`}</button>);",
      // Defense also via template-literal className.
      F(`<button className={\`flex max-w-md\`}>{label}</button>`),
      // Domain exemption: `children` is the composition boundary.
      F(`<td>{children}</td>`),
      // Defense via inline template without interpolations is static.
      "const X = () => (<button>{`static text`}</button>);",
    ],

    invalid: [
      // ---- Fixable: <button>/<td> with no className (insert attr) ----
      // Direct `{label}` in <button>.
      {
        code: F(`<button>{label}</button>`),
        output: F(`<button className="truncate">{label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Mixed static text + dynamic expression.
      {
        code: F(`<button>Items: {count}</button>`),
        output: F(`<button className="truncate">Items: {count}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Function-call expression.
      {
        code: F(`<button>{t("save")}</button>`),
        output: F(`<button className="truncate">{t("save")}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Conditional expression.
      {
        code: F(`<button>{cond ? "On" : "Off"}</button>`),
        output: F(`<button className="truncate">{cond ? "On" : "Off"}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Logical expression.
      {
        code: F(`<button>{item && item.label}</button>`),
        output: F(`<button className="truncate">{item && item.label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Spread of children — JSXSpreadChild, length unknowable.
      {
        code: F(`<button>{...children}</button>`),
        output: F(`<button className="truncate">{...children}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Optional chaining (`x?.y`) — MemberExpression, treated as dynamic.
      {
        code: F(`<button>{maybe?.label}</button>`),
        output: F(`<button className="truncate">{maybe?.label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Nullish coalescing with non-literal RHS.
      {
        code: F(`<button>{maybeLabel ?? "(none)"}</button>`),
        output: F(`<button className="truncate">{maybeLabel ?? "(none)"}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Type cast (TSX).
      {
        code: F(`<button>{label as string}</button>`),
        output: F(`<button className="truncate">{label as string}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // td with dynamic content and no defense.
      {
        code: F(`<td>{description}</td>`),
        output: F(`<td className="truncate">{description}</td>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Trailing whitespace before `>` — the fix must collapse it to a
      // single space (`<button >` → `<button className="truncate">`, not
      // `<button  className="truncate">`).
      {
        code: F(`<button >{label}</button>`),
        output: F(`<button className="truncate">{label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Multiple spaces before `>` — same collapse.
      {
        code: F(`<button   >{label}</button>`),
        output: F(`<button className="truncate">{label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Newline before `>` (multi-attribute opening tag) — the insert
      // goes before `>` on its own line, whitespace is preserved.
      {
        code: F(`<button\n  onClick={handle}\n>{label}</button>`),
        output: F(
          `<button\n  onClick={handle}\n className="truncate">{label}</button>`,
        ),
        errors: [{ messageId: "needDefense" }],
      },
      // Template literal WITH interpolation is dynamic (the parser
      // sees `${x}` as a TemplateLiteral with one expressions entry).
      {
        code: "const X = () => (<button>{`prefix-${x}-suffix`}</button>);",
        output: "const X = () => (<button className=\"truncate\">{`prefix-${x}-suffix`}</button>);",
        errors: [{ messageId: "needDefense" }],
      },

      // ---- Fixable: existing static className (prepend truncate) ----
      // Defense `whitespace-nowrap` alone is NOT a defense — must still
      // flag, and the fix prepends `truncate`.
      {
        code: F(`<button className="whitespace-nowrap">{label}</button>`),
        output: F(`<button className="truncate whitespace-nowrap">{label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Defense `overflow-hidden` alone is NOT a defense.
      {
        code: F(`<button className="overflow-hidden">{label}</button>`),
        output: F(`<button className="truncate overflow-hidden">{label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Prepend preserves the rest of the className and double quotes.
      {
        code: F(`<button className="bg-blue-500 px-4">{label}</button>`),
        output: F(`<button className="truncate bg-blue-500 px-4">{label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Prepend preserves single-quote style.
      {
        code: F(`<button className='bg-blue-500'>{label}</button>`),
        output: F(`<button className='truncate bg-blue-500'>{label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Prepend works inside an expression-container string literal.
      {
        code: F(`<button className={"bg-blue-500"}>{label}</button>`),
        output: F(`<button className={"truncate bg-blue-500"}>{label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // td with an existing static className.
      {
        code: F(`<td className="cell">{description}</td>`),
        output: F(`<td className="truncate cell">{description}</td>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Empty className string — prepend must not leave a dangling space
      // (`truncate ` with trailing space would be a cosmetic regression).
      {
        code: F(`<button className="">{label}</button>`),
        output: F(`<button className="truncate">{label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Whitespace-only className — same bare `truncate` result.
      {
        code: F(`<button className="  ">{label}</button>`),
        output: F(`<button className="truncate">{label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Whitespace-only className inside an expression container — the
      // fixer replaces the Literal in place, so the braces stay.
      {
        code: F(`<button className={" "}>{label}</button>`),
        output: F(`<button className={"truncate"}>{label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },

      // ---- NOT fixable: no output — fixer must return null ----
      // h2 in card without defense — vertical defense (line-clamp) needed,
      // truncate is not a safe default → no autofix.
      {
        code: F(`<div className="card"><h2>{title}</h2></div>`),
        errors: [{ messageId: "needDefense" }],
      },
      // h2 with card-title class, no defense — card header, no autofix.
      {
        code: F(`<h2 className="card-title">{title}</h2>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Tooltip with dynamic label and no defense — defense belongs in
      // classNames.tooltip / label, not the wrapper className → no autofix.
      {
        code: F(`<Tooltip label={text}>x</Tooltip>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Tooltip with dynamic label and className WITHOUT defense.
      {
        code: F(`<Tooltip className="rounded" label={text}>x</Tooltip>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Tooltip with classNames.tooltip lacking defense.
      {
        code: F(
          `<Tooltip classNames={{ tooltip: "rounded" }} label={text}>x</Tooltip>`,
        ),
        errors: [{ messageId: "needDefense" }],
      },
      // MemberExpression tag: `<Mantine.Tooltip>` collapses to `Tooltip`
      // by our getElementName() branch, so the rule scopes to a tooltip
      // and inspects `label`.
      {
        code: F(`<Mantine.Tooltip label={text}>x</Mantine.Tooltip>`),
        errors: [{ messageId: "needDefense" }],
      },
      // Dynamic className (cx/clsx/styled) — we cannot verify the
      // runtime-resolved className, so the conservative rule treats
      // it as no defense and flags the dynamic child. No autofix.
      {
        code: F(
          `<button className={cx("foo", cond && "bar")}>{label}</button>`,
        ),
        errors: [{ messageId: "needDefense" }],
      },
      // Template-literal className without defense — static quasis joined
      // as "btn", no defense matched → flagged. No autofix (template
      // literal is not a plain string Literal).
      {
        code: F(`<button className={\`btn\`}>{label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
      // JSX spread: `<button {...props}>` — no static className, but an
      // explicit prop placed AFTER the spread would REPLACE the spread's
      // className (dropping styling). No autofix.
      {
        code: F(`<button {...buttonProps}>{label}</button>`),
        errors: [{ messageId: "needDefense" }],
      },
    ],
  });
});
