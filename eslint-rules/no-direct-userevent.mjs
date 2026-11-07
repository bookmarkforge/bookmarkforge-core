/**
 * eslint-rules/no-direct-userevent.mjs
 *
 * Flags calls to the module-level `@testing-library/user-event` API
 * (`userEvent.click(...)`, `userEvent.type(...)`, `userEvent.hover(...)`, …)
 * inside test files.
 *
 * Why: the default export is a namespace of standalone helpers, and every
 * direct call re-creates its own event setup (and its own `document`-level
 * hooks) on each invocation. The repo's preferred pattern is ONE shared
 * instance per test:
 *
 *     const user = userEvent.setup({ delay: null });
 *     await user.click(getByText("Embeddings"));
 *
 * The rule looks at the real import bindings (default, namespace, or the
 * named `userEvent` re-export), so an instance created by `userEvent.setup()`
 * and its methods (`user.click(...)`) are never flagged — only calls made
 * through the module namespace itself. `userEvent.setup()` is the factory and
 * is always allowed.
 *
 * Baseline (debt ceiling). The tree already carries a large number of direct
 * calls from before this rule existed, so the rule is NOT clean and cannot be
 * enabled at `error` unconditionally without red-lining `npm run lint`. It
 * takes a `baseline` option — a `{ "<repo-relative path>": <allowed count> }`
 * map — and reports only the occurrences BEYOND the allowed count for that
 * file. Consequences:
 *   - a file that is not in the baseline may not use the direct API at all;
 *   - a baselined file may not add new direct calls (the count is a ceiling);
 *   - a file that migrates to `userEvent.setup()` passes freely.
 * The baseline lives in `eslint-rules/userevent-direct-baseline.json` and is
 * read by `eslint.config.js`, so it is reviewed in the PR diff like any other
 * baseline (see `scripts/no-unbounded-text-baseline.json` for the sibling
 * pattern). Regenerate it after an accepted batch of new direct calls by
 * running ESLint over the test tree with an empty baseline (`{}`) and counting
 * the `bmf/no-direct-userevent` messages per file.
 *
 * Out of scope by design:
 *   - computed access (`userEvent["click"](…)`) — not statically a method
 *     call and never worth a diagnostic;
 *   - optional-call chains (`userEvent.click?.(…)`) — vanishingly rare, and a
 *     false negative here is caught by the next real call;
 *   - non-test code: `user-event` is a dev-only test utility, so the rule is
 *     activated only for the test trees in `eslint.config.js`.
 */
import path from "node:path";

const USER_EVENT_MODULE = "@testing-library/user-event";
const FACTORY_METHOD = "setup";

/** Repo-relative, forward-slash path used as the baseline key. */
function baselineKey(filename) {
  const relative = path.relative(process.cwd(), filename);
  return relative.split(path.sep).join("/");
}

export const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Prefer one shared `userEvent.setup()` instance over the module-level `@testing-library/user-event` API in tests.",
      recommended: false,
    },
    schema: [
      {
        type: "object",
        properties: {
          // { "src/tests/a.test.tsx": 3 } — allowed direct-call count per file.
          baseline: {
            type: "object",
            additionalProperties: { type: "integer", minimum: 0 },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      directApi:
        "`userEvent.{{method}}()` calls the module-level user-event API directly; each call re-creates its own setup. Create one instance with `const user = userEvent.setup()` and call `user.{{method}}()`. ({{file}}: {{count}} direct call(s), baseline allows {{allowed}}.)",
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const baseline = options.baseline ?? {};
    const file = baselineKey(context.filename ?? context.getFilename());
    const allowed = Number.isInteger(baseline[file]) ? baseline[file] : 0;

    // Local identifiers bound to the `@testing-library/user-event` module
    // (default / namespace import, or the named `userEvent` re-export).
    const namespaces = new Set();
    // Candidate member calls, filtered against `namespaces` at Program:exit so
    // the result never depends on the import appearing before the call.
    const candidates = [];

    return {
      ImportDeclaration(node) {
        if (node.source.value !== USER_EVENT_MODULE) return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportDefaultSpecifier" ||
            specifier.type === "ImportNamespaceSpecifier"
          ) {
            namespaces.add(specifier.local.name);
            continue;
          }
          if (specifier.type === "ImportSpecifier") {
            const imported = specifier.imported.name ?? specifier.imported.value;
            if (imported === "userEvent") namespaces.add(specifier.local.name);
          }
        }
      },

      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.object.type !== "Identifier") return;
        if (callee.property.type !== "Identifier") return;
        candidates.push({
          objectName: callee.object.name,
          property: callee.property,
        });
      },

      "Program:exit"() {
        const offenders = candidates.filter(
          (candidate) =>
            namespaces.has(candidate.objectName) &&
            candidate.property.name !== FACTORY_METHOD,
        );
        if (offenders.length <= allowed) return;
        const count = offenders.length;
        for (const offender of offenders.slice(allowed)) {
          context.report({
            node: offender.property,
            messageId: "directApi",
            data: {
              method: offender.property.name,
              file,
              count,
              allowed,
            },
          });
        }
      },
    };
  },
};

export default rule;
