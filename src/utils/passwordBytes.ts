/**
 * passwordBytes.ts — byte ownership helpers for credential material.
 *
 * AGENTS.md §2: master-password material stays bytes end to end. A JS string
 * is immutable and cannot be zeroized, so it is only ever a BOUNDARY
 * representation — the value of an <input>, a legacy API or a test fixture —
 * and is encoded immediately. Every helper below returns an OWNED copy: the
 * receiver is responsible for zeroizing it (via `zeroPasswordBytes`), and no
 * helper ever aliases the caller's buffer.
 */

import { zeroPasswordBytes } from "./crypto-core";

/**
 * ASCII whitespace removed by `String.prototype.trim()` for password-shaped
 * input: TAB, LF, VT, FF, CR and SPACE. Byte callers get the same trimming
 * semantics as the string path without an intermediate string.
 */
const ASCII_WHITESPACE = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]);

/**
 * UTF-8 code-point count of a byte credential, without decoding it back into a
 * string (which would create an un-zeroizable copy). Continuation bytes
 * (`10xxxxxx`) do not start a code point. Used to keep the minimum-length
 * policy equivalent to the legacy `String.prototype.length` check: measuring
 * raw bytes would let a short multibyte password pass (4 emoji = 16 bytes but
 * only 8 UTF-16 units).
 */
export function passwordCodePointLength(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) {
    if ((byte & 0xc0) !== 0x80) {
      count += 1;
    }
  }
  return count;
}

/** Owned copy of credential material; never aliases the caller's buffer. */
export function copyPasswordBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === "string"
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
}

/**
 * Owned, ASCII-trimmed copy of a credential.
 *
 * Preserves the legacy unlock semantics (" a" and "a" open the same vault —
 *) for BOTH input shapes: a string is encoded first and the bytes
 * are trimmed, so a byte caller no longer needs to decode to a string to
 * reproduce the behaviour. The intermediate untrimmed buffer is zeroized
 * before returning.
 */
export function normalizePasswordBytes(input: string | Uint8Array): Uint8Array {
  const raw = copyPasswordBytes(input);
  let start = 0;
  let end = raw.length;
  while (start < end && ASCII_WHITESPACE.has(raw[start]!)) {
    start += 1;
  }
  while (end > start && ASCII_WHITESPACE.has(raw[end - 1]!)) {
    end -= 1;
  }
  if (start === 0 && end === raw.length) {
    return raw;
  }
  const trimmed = raw.slice(start, end);
  zeroPasswordBytes(raw);
  return trimmed;
}
