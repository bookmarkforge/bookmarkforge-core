/**
 * eslint-rules/require-securityvault-mock-lock-unlock.mjs
 *
 * Detects vitest `vi.mock` calls that mock the SecurityVault module
 * without providing `onLock` and `onUnlock` in the returned object.
 *
 * Context: ProviderManager, TTSService, SemanticCacheService,
 * VaultIntegration, AgentService, and TaggingService all call
 * `securityVault.onLock()` / `securityVault.onUnlock()` in their
 * constructors or module scope.  A mock that omits these methods
 * causes a `TypeError: X.onLock is not a function` at import time.
 */

const VAULT_PATH_RE = /(^|\/)SecurityVault$/;

function isSecurityVaultMock(callExpr) {
  if (callExpr.callee.type !== "MemberExpression") return false;
  const obj = callExpr.callee.object;
  const prop = callExpr.callee.property;
  if (!obj || obj.type !== "Identifier" || obj.name !== "vi") return false;
  if (!prop || prop.type !== "Identifier" || prop.name !== "mock") return false;
  const arg0 = callExpr.arguments[0];
  if (!arg0 || arg0.type !== "Literal" || typeof arg0.value !== "string") return false;
  return VAULT_PATH_RE.test(arg0.value);
}

/** Return true when the object expression contains any SpreadElement. */
function hasSpread(objExpr) {
  if (!objExpr || objExpr.type !== "ObjectExpression") return false;
  return objExpr.properties.some((p) => p.type === "SpreadElement");
}

/** Collect top-level string-keyed property names from an object expression. */
function collectKeys(objExpr) {
  if (!objExpr || objExpr.type !== "ObjectExpression") return new Set();
  const keys = new Set();
  for (const prop of objExpr.properties) {
    if (prop.type === "Property" && prop.key.type === "Identifier") {
      keys.add(prop.key.name);
    } else if (prop.type === "Property" && prop.key.type === "Literal" && typeof prop.key.value === "string") {
      keys.add(prop.key.value);
    }
  }
  return keys;
}

/**
 * Given the factory argument of vi.mock(), return the object expression
 * it returns, or null if not statically analyzable (async factory,
 * spread-only object, unresolvable variable reference).
 *
 * The factory object is usually `{ securityVault: { onLock, ... } }`; we
 * drill into the `securityVault` property when present. When the property
 * value is an identifier (`securityVault: vaultMock`), we resolve it
 * through the module scope to the variable's initializer object — the
 * common pattern in this repo's tests (mocks built as module-level
 * consts so assertions can reach the spies).
 */
function getReturnedObject(factory, scope) {
  if (!factory) return null;

  const unwrap = (obj) => {
    // Drill into one level of wrapper: { securityVault: { ... } }
    // Prefer the 'securityVault' property if present (most common pattern).
    // Fall back to the first non-empty ObjectExpression property.
    let fallback = null;
    for (const prop of obj.properties) {
      if (prop.type === "Property") {
        if (prop.key.type === "Identifier" && prop.key.name === "securityVault") {
          if (prop.value.type === "ObjectExpression") return prop.value;
          if (prop.value.type === "Identifier") {
            const resolved = resolveIdentifierObject(prop.value, scope);
            if (resolved) return resolved;
          }
        }
      }
    }
    // No explicit securityVault property — try the first ObjectExpression
    for (const prop of obj.properties) {
      if (prop.type === "Property") {
        if (prop.value.type === "ObjectExpression") {
          if (!fallback) fallback = prop.value;
        }
        if (prop.value.type === "Identifier") {
          const resolved = resolveIdentifierObject(prop.value, scope);
          if (resolved) return resolved;
        }
      }
    }
    return fallback || obj;
  };

  const analyze = (expr) => {
    if (!expr) return null;
    if (expr.type === "ObjectExpression") return unwrap(expr);
    if (expr.type === "Identifier") {
      return unwrap(resolveIdentifierObject(expr, scope) || expr);
    }
    return null;
  };

  // () => ({ ... })  /  () => vaultMock
  if (factory.type === "ArrowFunctionExpression" && factory.expression) {
    return analyze(factory.body);
  }

  // () => { return { ... } } / function() { return { ... } }
  if (
    (factory.type === "ArrowFunctionExpression" ||
      factory.type === "FunctionExpression") &&
    factory.body.type === "BlockStatement"
  ) {
    const ret = factory.body.body.find((s) => s.type === "ReturnStatement");
    return ret && ret.argument ? analyze(ret.argument) : null;
  }

  // async factories are dynamic — unverifiable
  if (factory.type === "ArrowFunctionExpression" && factory.async) {
    return null;
  }

  return null;
}

/** Resolve an identifier to its initializer object expression via scope. */
function resolveIdentifierObject(idNode, scope) {
  if (!idNode || idNode.type !== "Identifier" || !scope) return null;
  for (let s = scope; s; s = s.upper) {
    const variable = s.variables && s.variables.find((v) => v.name === idNode.name);
    if (!variable || !variable.defs || !variable.defs[0]) continue;
    const init = variable.defs[0].node.init;
    if (!init) return null;
    if (init.type === "ObjectExpression") return init;
    // vi.hoisted(() => ({ ... })) — the vitest pattern for mocks that
    // must exist before the module body runs. The hoisted factory is
    // statically analyzable; analyze its argument object directly.
    if (
      init.type === "CallExpression" && init.callee.type === "MemberExpression" &&
      init.callee.object.type === "Identifier" && init.callee.object.name === "vi" &&
      init.callee.property.type === "Identifier" && init.callee.property.name === "hoisted"
    ) {
      const arg = init.arguments[0];
      if (arg && arg.type === "ArrowFunctionExpression" && arg.expression) {
        return arg.body.type === "ObjectExpression" ? arg.body : null;
      }
      if (arg && arg.type === "ArrowFunctionExpression" && arg.body.type === "BlockStatement") {
        const ret = arg.body.body.find((s) => s.type === "ReturnStatement");
        if (ret && ret.argument && ret.argument.type === "ObjectExpression") {
          return ret.argument;
        }
      }
      return null;
    }
    return null;
  }
  return null;
}

export const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require onLock and onUnlock in vitest mocks of SecurityVault.",
    },
    schema: [],
    messages: {
      missingOnLock:
        "SecurityVault mock is missing 'onLock'. Add `onLock: vi.fn(() => () => {})`.",
      missingOnUnlock:
        "SecurityVault mock is missing 'onUnlock'. Add `onUnlock: vi.fn(() => () => {})`.",
      missingBoth:
        "SecurityVault mock is missing 'onLock' and 'onUnlock'. Add both.",
      unverifiable:
        "SecurityVault mock factory cannot be statically verified (async / spread). Ensure 'onLock' and 'onUnlock' are present.",
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (!isSecurityVaultMock(node)) return;

        const factory = node.arguments[1];
        if (!factory) return;

        // Async factories are unverifiable
        if (factory.async) {
          context.report({ node, messageId: "unverifiable" });
          return;
        }

        // ESLint 9 flat config: scope lookup lives on sourceCode (the
        // legacy context.getScope() was removed).
        const scope = context.sourceCode.getScope(node);
        const returned = getReturnedObject(factory, scope);

        if (!returned) {
          context.report({ node, messageId: "unverifiable" });
          return;
        }

        // Spread elements make the object unverifiable
        if (hasSpread(returned)) {
          context.report({ node, messageId: "unverifiable" });
          return;
        }

        const keys = collectKeys(returned);
        const missingOnLock = !keys.has("onLock");
        const missingOnUnlock = !keys.has("onUnlock");

        if (missingOnLock && missingOnUnlock) {
          context.report({ node, messageId: "missingBoth" });
        } else if (missingOnLock) {
          context.report({ node, messageId: "missingOnLock" });
        } else if (missingOnUnlock) {
          context.report({ node, messageId: "missingOnUnlock" });
        }
      },
    };
  },
};

export default rule;
