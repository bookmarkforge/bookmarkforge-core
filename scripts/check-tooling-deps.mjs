#!/usr/bin/env node
/**
 * check-tooling-deps — build/test tooling must stay in devDependencies.
 *
 * Why this exists: packages like @testing-library/*, vitest, playwright,
 * typescript, vite plugins, tsx, pdfkit and the type packages are only ever
 * imported by tests, scripts, configs and the bundler — never by code that
 * ships in the browser bundle. If one lands in `dependencies`, it gets
 * installed for every consumer of the package and (for libraries that ship
 * Node APIs) can silently break the browser surface or bloat installs.
 *
 * Invariant: no package matching TOOLING is declared in `dependencies`.
 * Moving a package the other way (tooling -> dependencies) is the failure
 * this gate exists to catch; the reverse (a runtime dep misfiled as
 * devDependency) is not checked here — knip/dependency-cruiser cover usage.
 *
 * Retiring an entry: if a package genuinely becomes runtime code, remove it
 * from TOOLING in the same commit that moves it to `dependencies`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** Exact package names that are tooling-only. */
const TOOLING_EXACT = new Set([
  "@eslint/js",
  "@playwright/test",
  "@rollup/wasm-node",
  "@tailwindcss/vite",
  "@testing-library/dom",
  "@testing-library/jest-dom",
  "@testing-library/react",
  "@testing-library/user-event",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "@vitejs/plugin-basic-ssl",
  "@vitejs/plugin-react",
  "@vitest/coverage-v8",
  "eslint",
  "eslint-plugin-react-hooks",
  "husky",
  "jsdom",
  "knip",
  "lint-staged",
  "pdfkit",
  "playwright",
  "postcss",
  "prettier",
  "tailwindcss",
  "tsx",
  "typescript",
  "vite",
  "vitest",
]);

/** Scoped prefixes that are tooling-only regardless of sub-package. */
const TOOLING_PREFIXES = [
  "@eslint/",
  "@playwright/",
  "@testing-library/",
  "@types/",
  "@vitejs/",
  "@vitest/",
];

const isTooling = (name) =>
  TOOLING_EXACT.has(name) || TOOLING_PREFIXES.some((p) => name.startsWith(p));

const offenders = Object.keys(pkg.dependencies ?? {}).filter(isTooling);

if (offenders.length > 0) {
  console.error(
    "check-tooling-deps FAILED — tooling packages declared in dependencies:",
  );
  for (const name of offenders) {
    console.error(`  - ${name} (move to devDependencies)`);
  }
  process.exit(1);
}

console.log(
  `check-tooling-deps OK — ${Object.keys(pkg.dependencies ?? {}).length} runtime deps, no tooling leaked.`,
);
