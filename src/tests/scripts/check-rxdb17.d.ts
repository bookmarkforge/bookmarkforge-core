// Ambient types for the ESM script imported dynamically by its test.
// TypeScript cannot infer types from a .mjs script without declarations;
// the wildcard matches the relative dynamic import path.
declare module "*check-rxdb17.mjs" {
  export function majorOf(spec: string | null | undefined): number | null;
  export function majorLabel(spec: string | null | undefined): string;
  export function runRxdb17Checks(input: {
    pkgSpec: string | null | undefined;
    lockVersion: string | null | undefined;
    installedVersion: string | null | undefined;
    treeFiles: Map<string, string>;
  }): { ok: boolean; oks: string[]; failures: string[] };
}
