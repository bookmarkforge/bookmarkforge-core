/**
 * src/services/security-vault/compare.ts
 *
 * Constant-time comparison primitive for the master-password vault.
 * Extracted from SecurityVault.ts (refactor, no behavior change).
 */

import { zeroPasswordBytes } from "../../utils/crypto-core";

/**
 * Constant-time comparison of two strings using byte arrays.
 * Avoids string-level short-circuiting and JIT optimizations.
 * Zeroizes intermediate buffers in finally block.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

try {
    const maxLen = Math.max(aBytes.length, bBytes.length);
    let result = 0;
    for (let i = 0; i < maxLen; i++) {
      result |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
    }
    result |= aBytes.length ^ bBytes.length;
    return result === 0;
  } finally {
    zeroPasswordBytes(aBytes);
    zeroPasswordBytes(bBytes);
  }
}
