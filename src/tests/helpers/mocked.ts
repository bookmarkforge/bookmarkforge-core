/**
 * Test-mock boundary helpers.
 *
 * Used by 5 test files as a structural widening for vitest 4.x mock factories
 * that hit `ModuleMockFactoryWithHelper<typeof import(...)>` narrowing.
 *
 * Kept after codemod regression; the manual migration in BookmarksTable.test.tsx
 * imports `mockedPartial` here. Several other test files use `mockT`,
 * `mockEmpty` for similar widening.
 */
import type { TFunction } from "i18next";

/**
 * Accept a partial shape; return it. Runtime identity preserved (no transform).
 * Use at factory boundaries to widen TS-shaped partials into T-shaped ones.
 */
export function mockedPartial<T>(partial: T): T {
  return partial;
}

/**
 * Empty-shape mock marker \u2014 documents intent at the call site.
 */
export function mockEmpty(): Record<string, never> {
  return {} as Record<string, never>;
}

/**
 * TFunction-brand-compliant passthrough translation. Accepts (key, def?) and
 * returns the default if provided, else the key. Runtime-controllable brand
 * ensures i18next 17.x runtime checks pass.
 */
export function mockT(): TFunction {
  const fn = ((key: string, def?: unknown) =>
    (def as string | undefined) ?? key) as TFunction;
  (fn as unknown as { $TFunctionBrand?: never }).$TFunctionBrand =
    undefined as never;
  return fn;
}
