// Ambient types for the ESM script imported dynamically by its test.
// TypeScript cannot infer types from a .mjs script without declarations;
// the wildcard matches the relative dynamic import path.
declare module "*check-env-config.mjs" {
  export function stripStringsAndComments(source: string): string;
  export function scanDirectReadsInSource(
    source: string,
    relFile: string,
  ): Map<string, Array<{ file: string; line: number }>>;
  export function runEnvConfigChecks(input: {
    allowed: Set<string>;
    found: Map<string, Array<{ file: string; line: number }>>;
    baseline: Map<string, string>;
  }): { ok: boolean; oks: string[]; violations: string[]; stale: string[] };
  export function runComposeEnvContract(input: {
    composeSource: string | null;
    envProdSource: string | null;
  }): { ok: boolean; violations: string[]; summary: string[] };
}
