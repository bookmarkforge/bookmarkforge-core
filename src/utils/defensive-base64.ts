/**
 * Single defensive Base64 decoder shared by every backup-restore path
 * (cloud restore, auto-restore from SecureStorage, future importers).
 *
 * Design contract (defense against hostile/manipulated restore sources):
 * 1. Validate BEFORE any allocation: length multiple of 4, allowed charset,
 *    valid padding. A malformed payload never reaches `atob`.
 * 2. Compute the exact decoded length arithmetically and refuse to decode
 *    (or reserve memory for) payloads above `maxBytes`.
 * 3. Keep decoding bounded: aligned chunks are decoded one at a time and
 *    written straight into a single pre-sized output buffer, so no
 *    intermediate binary string for the whole payload is ever created
 *    (unlike a bare `atob(whole)` which peaks at ~2x the payload size).
 * 4. Non-blocking: yields to the event loop between chunks so a large but
 *    legitimate restore cannot freeze the UI thread.
 */

/** Error carrying a machine-readable reason for callers that branch on it. */
export class DefensiveBase64Error extends Error {
  constructor(
    public readonly reason:
      | "invalid-format"
      | "too-large"
      | "decode-failed",
    message: string,
  ) {
    super(message);
    this.name = "DefensiveBase64Error";
  }
}

const BASE64_CHARSET = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Validates a Base64 payload and returns its exact decoded byte length
 * without decoding. Throws {@link DefensiveBase64Error} on any violation.
 */
export function assertValidBase64(
  data: string,
  maxBytes: number,
): { decodedLength: number; padding: number } {
  if (
    data.length === 0 ||
    data.length % 4 !== 0 ||
    !BASE64_CHARSET.test(data) ||
    (data.includes("=") && !/={1,2}$/.test(data))
  ) {
    throw new DefensiveBase64Error(
      "invalid-format",
      "Invalid backup encoding",
    );
  }

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const decodedLength = (data.length / 4) * 3 - padding;
  if (decodedLength > maxBytes) {
    throw new DefensiveBase64Error(
      "too-large",
      "Backup exceeds the maximum decoded size",
    );
  }
  return { decodedLength, padding };
}

/**
 * Decodes a strictly-validated Base64 string into bytes, bounding both the
 * output allocation (`maxBytes`) and the intermediate working memory
 * (`chunkBytes`, must be a positive multiple of 4 so each `atob` slice has
 * no partial padding). Validation happens before any allocation; a chunk
 * that `atob` rejects despite passing charset validation surfaces as
 * `decode-failed` (belt-and-braces — cannot happen for charset-clean input
 * on standard implementations).
 */
export function decodeDefensiveBase64(
  data: string,
  maxBytes: number,
  chunkBytes: number,
): Uint8Array {
  const { decodedLength } = assertValidBase64(data, maxBytes);

  const bytes = new Uint8Array(decodedLength);
  let written = 0;
  const alignedChunk = chunkBytes - (chunkBytes % 4);

  for (let offset = 0; offset < data.length; offset += alignedChunk) {
    const end = Math.min(offset + alignedChunk, data.length);
    let binaryChunk: string;
    try {
      binaryChunk = atob(data.slice(offset, end));
    } catch {
      throw new DefensiveBase64Error(
        "decode-failed",
        "Invalid backup encoding",
      );
    }
    for (let i = 0; i < binaryChunk.length; i++) {
      bytes[written++] = binaryChunk.charCodeAt(i);
    }
  }

  // `assertValidBase64` already computed the exact decoded length, so the
  // buffer is always filled exactly; kept as an invariant check.
  if (written !== decodedLength) {
    throw new DefensiveBase64Error(
      "decode-failed",
      "Decoded length mismatch",
    );
  }
  return bytes;
}

/**
 * Decode a `data:` URL into raw bytes with strict, pre-allocation validation
 * of the Base64 payload. Returns `null` when the URL is malformed, the
 * payload is not valid Base64, or the decoded size exceeds `maxBytes` —
 * callers treat `null` as "leave the reference untouched" rather than
 * guessing.
 *
 * Percent-encoded (non-Base64) data URLs are intentionally NOT handled here;
 * callers that support them decode with `decodeURIComponent` separately and
 * apply their own size bound.
 */
export function decodeDataUrlToBytes(
  dataUrl: string,
  maxBytes: number,
): { bytes: Uint8Array; mimeType: string } | null {
  if (!dataUrl.startsWith("data:")) {return null;}
  const comma = dataUrl.indexOf(",");
  if (comma === -1) {return null;}
  const header = dataUrl.slice(5, comma);
  const semi = header.indexOf(";");
  const mimeType = (semi === -1 ? header : header.slice(0, semi)).toLowerCase();
  if (!header.toLowerCase().endsWith(";base64")) {return null;}
  const payload = dataUrl.slice(comma + 1);
  try {
    return {
      bytes: decodeDefensiveBase64(payload, maxBytes, 1024 * 1024),
      mimeType,
    };
  } catch {
    return null;
  }
}

/**
 * Async variant that yields to the event loop between chunks. Matches the
 * responsiveness contract of the previous auto-backup chunked decoder.
 */
export async function decodeDefensiveBase64Async(
  data: string,
  maxBytes: number,
  chunkBytes = 1024 * 1024,
): Promise<Uint8Array> {
  const { decodedLength } = assertValidBase64(data, maxBytes);

  const bytes = new Uint8Array(decodedLength);
  let written = 0;
  const alignedChunk = chunkBytes - (chunkBytes % 4);

  for (let offset = 0; offset < data.length; offset += alignedChunk) {
    const end = Math.min(offset + alignedChunk, data.length);
    let binaryChunk: string;
    try {
      binaryChunk = atob(data.slice(offset, end));
    } catch {
      throw new DefensiveBase64Error(
        "decode-failed",
        "Invalid backup encoding",
      );
    }
    for (let i = 0; i < binaryChunk.length; i++) {
      bytes[written++] = binaryChunk.charCodeAt(i);
    }
    if (end < data.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  if (written !== decodedLength) {
    throw new DefensiveBase64Error(
      "decode-failed",
      "Decoded length mismatch",
    );
  }
  return bytes;
}

