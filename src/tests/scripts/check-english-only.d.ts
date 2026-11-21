// Ambient types for the ESM script imported dynamically by its test.
// TypeScript cannot infer types from a .mjs script without declarations;
// the wildcard matches the relative dynamic import path.
declare module "*check-english-only.mjs" {
  export type EnglishFinding = {
    scope: string;
    line: number;
    fullText: string;
    text: string;
    signal: string;
  };

  export function analyzeText(
    text: string,
  ): { signal: string } | null;

  export function scanFile(src: string): EnglishFinding[];
}
