// Ambient types for the ESM script imported dynamically by its test.
// TypeScript cannot infer types from a .mjs script without declarations;
// the wildcard matches the relative dynamic import path.
declare module "*check-coverage-by-area.mjs" {
  export function toRelativeKey(absPath: string): string;
  export function fileMetrics(
    entry: unknown,
  ): {
    statements: [number, number];
    branches: [number, number];
    functions: [number, number];
    lines: [number, number];
  };
  export function evaluateAreaCoverage(
    coverageMap: Record<string, unknown>,
    budgets: { areas: Record<string, Record<string, number>> },
  ): {
    ok: boolean;
    oks: string[];
    failures: string[];
    report: Array<{
      area: string;
      percents: Record<string, number>;
      gated: boolean;
    }>;
  };
}
