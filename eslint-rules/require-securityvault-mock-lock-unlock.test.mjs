/**
 * eslint-rules/require-securityvault-mock-lock-unlock.test.mjs
 */

import { RuleTester } from "eslint";
import rule from "./require-securityvault-mock-lock-unlock.mjs";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

tester.run("require-securityvault-mock-lock-unlock", rule, {
  valid: [
    // Inline mock with both onLock and onUnlock at top level
    {
      code: `
import { vi } from "vitest";
vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
    hasSecret: vi.fn(),
  },
}));
      `,
    },
    // Both onLock and onUnlock as direct properties (no wrapper object)
    {
      code: `
import { vi } from "vitest";
vi.mock("./SecurityVault", () => ({
  onLock: vi.fn(() => () => {}),
  onUnlock: vi.fn(() => () => {}),
  hasSecret: vi.fn(),
}));
      `,
    },
    // Variable reference: const mock = { onLock, onUnlock } resolved via scope
    {
      code: `
import { vi } from "vitest";
const mockSecurityVault = {
  onLock: vi.fn(() => () => {}),
  onUnlock: vi.fn(() => () => {}),
  isLocked: vi.fn(),
};
vi.mock("../../services/SecurityVault", () => ({
  securityVault: mockSecurityVault,
}));
      `,
    },
    // vi.hoisted() factory: variable is only visible through the hoisted scope
    {
      code: `
import { vi } from "vitest";
vi.mock("../../services/SecurityVault", () => ({
  securityVault: vaultMock,
}));
const vaultMock = vi.hoisted(() => ({
  onLock: vi.fn(() => () => {}),
  onUnlock: vi.fn(() => () => {}),
}));
      `,
    },
    // Block body return
    {
      code: `
import { vi } from "vitest";
vi.mock("../services/SecurityVault", () => {
  return {
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  };
});
      `,
    },
    // Not a SecurityVault mock (different path)
    {
      code: `
import { vi } from "vitest";
vi.mock("../services/SecureStorage", () => ({
  getItem: vi.fn(),
}));
      `,
    },
    // Not vi.mock at all
    {
      code: `
const securityVault = {
  onLock: () => {},
};
      `,
    },
  ],

  invalid: [
    // Missing onLock (has onUnlock)
    {
      code: `
import { vi } from "vitest";
vi.mock("./SecurityVault", () => ({
  securityVault: {
    onUnlock: vi.fn(() => () => {}),
    hasSecret: vi.fn(),
  },
}));
      `,
      errors: [{ messageId: "missingOnLock" }],
    },
    // Missing onUnlock (has onLock)
    {
      code: `
import { vi } from "vitest";
vi.mock("../services/SecurityVault", () => ({
  securityVault: {
    onLock: vi.fn(() => () => {}),
  },
}));
      `,
      errors: [{ messageId: "missingOnUnlock" }],
    },
    // Missing both
    {
      code: `
import { vi } from "vitest";
vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    hasSecret: vi.fn(),
    decryptSecret: vi.fn(),
  },
}));
      `,
      errors: [{ messageId: "missingBoth" }],
    },
    // Unverifiable factory (async / variable-based return)
    {
      code: `
import { vi } from "vitest";
vi.mock("./SecurityVault", async () => {
  const mod = await vi.importActual("./SecurityVault");
  return { ...mod };
});
      `,
      errors: [{ messageId: "unverifiable" }],
    },
    // Direct object missing both
    {
      code: `
vi.mock("../../services/SecurityVault", () => ({
  hasMasterPassword: vi.fn(),
}));
      `,
      errors: [{ messageId: "missingBoth" }],
    },
  ],
});

console.log("require-securityvault-mock-lock-unlock: all tests passed");
