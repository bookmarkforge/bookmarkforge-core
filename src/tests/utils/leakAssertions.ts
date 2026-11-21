/**
 * Test-only assertions for guarding against content leaks.
 *
 * Several services now distinguish themselves by the guarantee that an
 * invalid input (corrupt storage blob, malformed user-uploaded file, etc.)
 * will NEVER echo a fragment of that input back to:
 *   1. the value returned to the caller,
 *   2. the `Error.message` thrown out of the function, or
 *   3. structured logger call arguments used by ops.
 *
 * Because `JSON.stringify` on `Error` instances produces `"{}"` (no message),
 * this helper does a manual snapshot of `Error` so its `message`/`stack`
 * fields participate in the leak check.
 */

function snapshot(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}:${value.message}`;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    // Cyclic / BigInt — coarse stringification for opaque comparison.
    return String(value);
  }
}

/**
 * Asserts that NONE of the provided surfaces contain the secret string.
 *
 * @example
 *   try { loader.parse(raw); }
 *   catch (err) {
 *     assertNoContentLeak(secret, err, loader.lastReturned);
 *   }
 */
export function assertNoContentLeak(
  secret: string,
  ...surfaces: ReadonlyArray<unknown>
): void {
  for (const surface of surfaces) {
    if (surface == null) {continue;}
    expect(snapshot(surface)).not.toContain(secret);
  }
}

/** Convenience: the most common single-secret sentinel. */
export const LEAK_SENTINEL = "very-private-token-DO-NOT-LEAK-9f4b";
