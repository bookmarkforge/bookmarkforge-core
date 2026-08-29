import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import noUnboundedText from "./eslint-rules/no-unbounded-text.mjs";
import noUnboundedCardHeader from "./eslint-rules/no-unbounded-card-header.mjs";
import noSecurityVaultMockWithoutLock from "./eslint-rules/require-securityvault-mock-lock-unlock.mjs";
import noUnexplainedTestSkip from "./eslint-rules/no-unexplained-test-skip.mjs";
import noUnboundedLoop from "./eslint-rules/no-unbounded-loop.mjs";
import reactCompiler from "eslint-plugin-react-compiler";

const SOURCE_TS = ["**/*.{ts,tsx,mts,cts}"];
const SOURCE_JS = ["**/*.{js,mjs,cjs}"];
const VITEST_GLOBALS = {
  afterAll: "readonly", afterEach: "readonly", beforeAll: "readonly",
  beforeEach: "readonly", describe: "readonly", expect: "readonly",
  it: "readonly", test: "readonly", vi: "readonly",
};
const BROWSER_EXTENSION_GLOBALS = { chrome: "readonly", browser: "readonly" };

export default tseslint.config(
  { ignores: ["**/node_modules/**", "dist/**", "dist-extension/**", "coverage/**", "playwright-report*/**", "test-results/**", "*.min.js"] },
  {
    files: SOURCE_JS,
    ...js.configs.recommended,
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...BROWSER_EXTENSION_GLOBALS, lucide: "readonly" } },
    rules: { "no-unused-vars": ["error", { args: "all", argsIgnorePattern: "^_", caughtErrors: "all", caughtErrorsIgnorePattern: "^_" }] },
  },
  {
    files: SOURCE_TS,
    languageOptions: { parser: tseslint.parser, sourceType: "module", globals: { ...globals.browser, ...globals.worker, ...globals.node, ...BROWSER_EXTENSION_GLOBALS } },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      ...tseslint.configs.recommended[1].rules,
      ...tseslint.configs.recommended[2].rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { args: "all", argsIgnorePattern: "^_", caughtErrors: "all", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  { files: ["**/*.{test,spec}.{ts,tsx,mts,cts}"], languageOptions: { globals: { ...globals.node, ...globals.browser, ...VITEST_GLOBALS, ...BROWSER_EXTENSION_GLOBALS } } },
  {
    files: ["src/tests/**", "tests/e2e/**", "**/*.{test,spec}.{ts,tsx,mts,cts}"],
    rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-unused-vars": "off", "@typescript-eslint/no-unsafe-assignment": "off", "@typescript-eslint/no-unsafe-member-access": "off", "@typescript-eslint/no-unsafe-argument": "off", "@typescript-eslint/no-unsafe-function-type": "off", "prefer-const": "off" },
  },
  { files: ["src/declarations.d.ts", "src/types/*.d.ts", "src/**/*.d.ts"], rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-unused-vars": "off" } },
  { files: ["src/env.config.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
  {
    files: ["src/**/*.{ts,tsx}", "tests/e2e/**/*.{ts,tsx}"],
    plugins: { bmf: { rules: { "no-unbounded-text": noUnboundedText, "no-unbounded-card-header": noUnboundedCardHeader, "no-securityvault-mock-without-lock": noSecurityVaultMockWithoutLock, "no-unexplained-test-skip": noUnexplainedTestSkip, "no-unbounded-loop": noUnboundedLoop } } },
  },
  { files: ["src/**/*.tsx"], rules: { "bmf/no-unbounded-text": "error", "bmf/no-unbounded-card-header": "error" } },
  { files: ["src/tests/**/*.{ts,tsx}"], rules: { "bmf/no-securityvault-mock-without-lock": "error" } },
  { files: ["tests/e2e/**/*.{ts,tsx}"], rules: { "bmf/no-unexplained-test-skip": "error" } },
  { files: ["src/services/**/*.{ts,tsx}", "src/workers/**/*.{ts,tsx}", "src/utils/**/*.{ts,tsx}", "src/tests/**/*.{ts,tsx}"], rules: { "bmf/no-unbounded-loop": "error" } },
  { files: ["src/**/*.{ts,tsx}"], plugins: { "react-compiler": reactCompiler }, rules: { "react-compiler/react-compiler": "warn" } },
);
