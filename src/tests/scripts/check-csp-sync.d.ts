// Ambient types for the ESM script imported dynamically by its test.
// TypeScript cannot infer types from a .mjs script without declarations;
// the wildcard matches the relative dynamic import path.
declare module "*check-csp-sync.mjs" {
  export const FORBIDDEN_HOSTS: string[];
  export function runCspSyncChecks(input: {
    cspModerate: string;
    cspOpen: string;
    cspStrict: string;
    coep: string;
    coop: string;
    forbiddenHosts?: string[];
    copies: Array<{ label: string; content: string | null }>;
  }): { ok: boolean; oks: string[]; failures: string[] };
}
