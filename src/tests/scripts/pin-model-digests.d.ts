// Ambient types for the ESM script imported dynamically by its test.
// TypeScript cannot infer types from a .mjs script without declarations;
// the wildcard matches the relative dynamic import path.
declare module "*pin-model-digests.mjs" {
  export function resolveDigest(
    model: string,
    revision: string,
    filePath: string,
  ): Promise<string>;
  export function verifyManifest(manifest: unknown): Promise<string[]>;
  export function regenerateManifest(manifest: unknown): Promise<unknown>;
  export function loadManifest(): unknown;
  export const MANIFEST_PATH: string;
}
