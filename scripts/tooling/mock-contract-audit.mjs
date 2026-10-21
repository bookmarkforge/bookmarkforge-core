#!/usr/bin/env node
/**
 * mock-contract-audit.mjs — mock-contract ratchet (P1).
 *
 * Context: the original AST sweep (`vi.mock` vs the module's contract, 59
 * files / 613 findings of which 22 were direct-import) ran on the real
 * checkout and was NEVER committed — it does not exist in this snapshot. This
 * file reconstructs the verifiable part here: it pins the 22 P1 findings
 * (docs/PENDING-ITEMS.md § P1) so no factory can lose those members again.
 *
 * Usage:
 *   node scripts/tooling/mock-contract-audit.mjs            # all
 *   node scripts/tooling/mock-contract-audit.mjs <substr>   # filter by path
 *
 * Verifies by AST the path of each member inside the value the `vi.mock`
 * factory actually returns. It follows objects bound by identifier, including
 * factories that return a `vi.hoisted` object; comments and mentions outside
 * the factory do not satisfy the contract.
 *
 * This ratchet only pins the known P1 cases: it is not the general AST sweep
 * of every transitive mock in the repository.
 *
 * Output: one `ok:`/`FAIL:` line per mocked module + summary. Exit 0 if all pass.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(SCRIPT_DIR, "..", "..");
const ROOT = resolve(process.env.BMF_MOCK_CONTRACT_ROOT ?? DEFAULT_ROOT);

/** @type {Array<{file: string, mocks: Array<{module: string, paths: string[]}>}>} */
const CONTRACTS = [
  {
    file: "src/tests/security/p0-legacy-share-mismatch.regression.test.ts",
    mocks: [
      {
        module: "../../services/SecureStorage",
        paths: [
          // The 10 P1.1 findings (SecureStorage as SecurityVault uses it):
          "secureStorage.purgeExpiredPendingKeys",
          "secureStorage.migrateFromLocalStorage",
          "secureStorage.getWrappedDeviceKeyBlob",
          "secureStorage.ensureDeviceKeyMaterialized",
          "secureStorage.isDeviceKeyMaterialized",
          "secureStorage.getVerificationIntegrity",
          "secureStorage.storeVerificationIntegrity",
          "secureStorage.restoreWrappedDeviceKeyBlob",
          "secureStorage.restoreVerificationToken",
          "secureStorage.storeVerificationTokenWithIntegrity",
        ],
      },
    ],
  },
  {
    file: "src/tests/security/p0-vault-rotation-rollback-drill.test.ts",
    mocks: [
      // P1.2: guard `typeof auditLog.verifyIntegrity` — without it the H2
      // hook is silently skipped.
      { module: "../../services/AuditLogService", paths: ["auditLog.verifyIntegrity"] },
    ],
  },
  {
    file: "src/tests/services/SecurityVault.test.ts",
    mocks: [
      { module: "../../services/AuditLogService", paths: ["auditLog.verifyIntegrity"] },
    ],
  },
  {
    file: "src/tests/services/AuditLogService.test.ts",
    mocks: [
      {
        module: "../../services/SecureStorage",
        // P1.3: gate de device-key de recoverFallbackEntries().
        paths: ["secureStorage.isDeviceKeyWrapped", "secureStorage.isDeviceKeyMaterialized"],
      },
    ],
  },
  {
    file: "src/tests/services/verifyBridgeMessage.test.ts",
    mocks: [
      {
        module: "../../services/SecurityVault",
        // P1.4: re-export consumido por BroadcastBridgeService.handleSyncSettings.
        paths: ["SECURE_STORAGE_KEYS"],
      },
    ],
  },
  {
    file: "src/tests/services/AnalyticsService.test.ts",
    mocks: [
      {
        module: "../../store/safeStorage",
        // P1.5: AnalyticsService.revoke().
        paths: ["safeRemove"],
      },
    ],
  },
  {
    file: "src/tests/services/ai/warmup-latch.integration.test.ts",
    mocks: [
      {
        module: "../../../services/ai/ResourceManager",
        // P1.6: second conjunct of the DUAL GATE (resolveProvider).
        paths: ["resourceManager.isHighEndDevice"],
      },
      {
        module: "../../../services/ai/utils",
        // P1.6: contrato que WebLLMService consume en chat.
        paths: ["buildSafeUserContent"],
      },
    ],
  },
  {
    file: "src/tests/services/integrations/cloudSync.integrity.test.ts",
    mocks: [
      {
        module: "../../../services/pro-access",
        // P1.7: loader de la copia a disco del auto-backup (F0-1).
        paths: ["loadDiskBackupService"],
      },
    ],
  },
  {
    file: "src/tests/services/integrations/cloudSync.offsite-backup.test.ts",
    mocks: [
      { module: "../../../services/pro-access", paths: ["loadDiskBackupService"] },
    ],
  },
  {
    file: "src/tests/memory/MemoryEngine.lifecycle.test.ts",
    mocks: [
      {
        module: "../../memory/MemoryPipeline",
        // P1.8: user-message route (MemoryEngine.addMessage).
        paths: ["memoryPipeline.onNewMessage"],
      },
    ],
  },
  {
    file: "src/tests/services/ai/SemanticCacheService.test.ts",
    mocks: [
      {
        module: "../../../utils/logger",
        // P1.9: rutas de error de EncryptionService.
        paths: ["redactSecrets"],
      },
    ],
  },
];

function unwrapExpression(node) {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function propertyKey(name) {
  if (name && ts.isComputedPropertyName(name)) {
    const expression = unwrapExpression(name.expression);
    return ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)
      ? expression.text
      : null;
  }
  if (name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name))) {
    return name.text;
  }
  return null;
}

function findReturnExpression(body) {
  if (!body || !ts.isBlock(body)) return null;
  let result = null;
  let returnCount = 0;
  let unsupportedReturn = false;
  const visit = (node) => {
    if (node !== body && (ts.isFunctionLike(node) || ts.isClassLike(node))) return;
    if (ts.isReturnStatement(node)) {
      returnCount++;
      if (node.parent !== body || !node.expression || returnCount > 1) {
        unsupportedReturn = true;
      } else {
        result = node.expression;
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return unsupportedReturn || returnCount !== 1 ? null : result;
}

function callbackResult(callback) {
  callback = unwrapExpression(callback);
  if (ts.isArrowFunction(callback)) {
    return ts.isBlock(callback.body) ? findReturnExpression(callback.body) : callback.body;
  }
  if (ts.isFunctionExpression(callback) || ts.isFunctionDeclaration(callback)) {
    return findReturnExpression(callback.body);
  }
  return null;
}

function findVariableDeclaration(reference) {
  const name = reference.text;
  const findInScope = (scope) => {
    let result = null;
    const visit = (node) => {
      if (result) return;
      if (node !== scope && (ts.isFunctionLike(node) || ts.isBlock(node) || ts.isClassLike(node))) {
        return;
      }
      if (ts.isVariableDeclaration(node)) {
        if (ts.isIdentifier(node.name) && node.name.text === name) {
          result = { initializer: node.initializer, bindingProperty: null };
          return;
        }
        if (ts.isObjectBindingPattern(node.name)) {
          const binding = node.name.elements.find(
            (element) => ts.isIdentifier(element.name) && element.name.text === name,
          );
          if (binding) {
            result = {
              initializer: node.initializer,
              bindingProperty: propertyKey(binding.propertyName ?? binding.name),
            };
            return;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(scope);
    return result;
  };

  for (let scope = reference.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(
      (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name,
    )) {
      return null;
    }
    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      const declaration = findInScope(scope);
      if (declaration) return declaration;
    }
  }
  return null;
}

function resolveObjectExpression(node, sourceFile, seen = new Set()) {
  if (!node) return null;
  node = unwrapExpression(node);

  if (ts.isObjectLiteralExpression(node)) return node;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
    return resolveObjectExpression(callbackResult(node), sourceFile, seen);
  }
  if (ts.isCallExpression(node)) {
    if (node.expression.getText(sourceFile) === "vi.hoisted" && node.arguments[0]) {
      return resolveObjectExpression(node.arguments[0], sourceFile, seen);
    }
    return null;
  }
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return null;
    seen.add(node.text);
    const declaration = findVariableDeclaration(node);
    if (!declaration?.initializer) return null;
    const object = resolveObjectExpression(declaration.initializer, sourceFile, seen);
    if (!object || !declaration.bindingProperty) return object;
    return findProperty(object, declaration.bindingProperty, sourceFile, seen)?.value ?? null;
  }
  return null;
}

function findProperty(expression, key, sourceFile, seen = new Set()) {
  const object = resolveObjectExpression(expression, sourceFile, seen);
  if (!object) return null;
  for (let index = object.properties.length - 1; index >= 0; index--) {
    const property = object.properties[index];
    if (ts.isSpreadAssignment(property)) {
      if (!resolveObjectExpression(property.expression, sourceFile, new Set(seen))) {
        return null;
      }
      const inherited = findProperty(property.expression, key, sourceFile, new Set(seen));
      if (inherited) return inherited;
      continue;
    }
    const name =
      ts.isPropertyAssignment(property) ||
      ts.isMethodDeclaration(property) ||
      ts.isGetAccessorDeclaration(property) ||
      ts.isSetAccessorDeclaration(property) ||
      ts.isShorthandPropertyAssignment(property)
        ? property.name
        : null;
    if (
      ts.isComputedPropertyName(name) &&
      !propertyKey(name) &&
      (ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property) ||
        ts.isMethodDeclaration(property) ||
        ts.isGetAccessorDeclaration(property) ||
        ts.isSetAccessorDeclaration(property))
    ) {
      return null;
    }
    if (propertyKey(name) !== key) continue;
    const value = ts.isPropertyAssignment(property)
      ? property.initializer
      : ts.isShorthandPropertyAssignment(property)
        ? property.name
        : property;
    return { property, value };
  }
  return null;
}

function resolvePropertyValue(property) {
  if (!ts.isShorthandPropertyAssignment(property)) return property.initializer;
  const declaration = findVariableDeclaration(property.name);
  return declaration?.initializer ? unwrapExpression(declaration.initializer) : null;
}

function pathExists(factory, path, sourceFile) {
  const parts = path.split(".");
  let current = callbackResult(factory);
  for (let index = 0; index < parts.length; index++) {
    const property = findProperty(current, parts[index], sourceFile);
    if (!property) return false;
    if (index === parts.length - 1) {
      if (
        !ts.isPropertyAssignment(property.property) &&
        !ts.isShorthandPropertyAssignment(property.property)
      ) {
        return true;
      }
      const value = resolvePropertyValue(property.property);
      return Boolean(value) &&
        !(ts.isIdentifier(value) && value.text === "undefined") &&
        value.kind !== ts.SyntaxKind.NullKeyword;
    }
    current = property.value;
  }
  return false;
}

function moduleMocks(sourceFile, modulePath) {
  const matches = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === "vi.mock" &&
      node.arguments.length >= 2 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === modulePath
    ) {
      matches.push(node.arguments[1]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches;
}

function auditMock(source, file, modulePath, paths) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx?$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    return { missing: paths, error: "TypeScript parse failed; cannot verify mock shape" };
  }
  const factories = moduleMocks(sourceFile, modulePath);
  if (factories.length === 0) {
    return { missing: paths, error: `missing vi.mock("${modulePath}")` };
  }
  if (factories.length > 1) {
    return {
      missing: paths,
      error: `found ${factories.length} vi.mock factories for "${modulePath}"; cannot verify which one is effective`,
    };
  }
  const missing = paths.filter((path) => !pathExists(factories[0], path, sourceFile));
  return { missing, error: null };
}

const filter = process.argv[2];
let checked = 0;
let failed = 0;

for (const { file, mocks } of CONTRACTS) {
  if (filter && !file.includes(filter)) continue;

  let text;
  try {
    text = readFileSync(join(ROOT, file), "utf8");
  } catch {
    console.log(`FAIL ${file} — fichero no encontrado`);
    failed++;
    continue;
  }

  for (const { module: modulePath, paths } of mocks) {
    checked += paths.length;
    const { missing, error } = auditMock(text, file, modulePath, paths);
    if (error) {
      console.log(`FAIL ${file} [${modulePath}] — ${error}`);
      failed += paths.length;
    } else if (missing.length > 0) {
      console.log(`FAIL ${file} [${modulePath}] — missing mock member path: ${missing.join(", ")}`);
      failed += missing.length;
    } else {
      console.log(`ok:   ${file} [${modulePath}] — ${paths.length} mock path(s)`);
    }
  }
}

console.log(
  `\nmock-contract-audit: ${checked - failed}/${checked} mock paths present` +
    (filter ? ` (filter: ${filter})` : ""),
);
process.exit(failed === 0 ? 0 : 1);
