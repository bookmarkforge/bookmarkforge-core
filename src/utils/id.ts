export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return fallbackUUID();
}

function fallbackUUID(): string {
  const arr = new Uint8Array(16);
  // Audit M-01: generateId()'s caller guard only checks randomUUID — a
  // missing crypto entirely must fail with a domain error, not a TypeError.
  if (
    typeof crypto === "undefined" ||
    typeof crypto.getRandomValues !== "function"
  ) {
    throw new Error(
      "CRYPTO_UNAVAILABLE: crypto.getRandomValues is required for generateId",
    );
  }
  crypto.getRandomValues(arr);
  arr[6] = (arr[6]! & 0x0f) | 0x40;
  arr[8] = (arr[8]! & 0x3f) | 0x80;
  // Optimized: single loop without intermediate array, direct hex conversion
  const hex = new Array(32);
  for (let i = 0; i < 16; i++) {
    const b = arr[i]!;
    const hi = (b >> 4).toString(16);
    const lo = (b & 0xf).toString(16);
    hex[i * 2] = hi;
    hex[i * 2 + 1] = lo;
  }
  const hexStr = hex.join("");
  return `${hexStr.slice(0, 8)}-${hexStr.slice(8, 12)}-${hexStr.slice(12, 16)}-${hexStr.slice(16, 20)}-${hexStr.slice(20)}`;
}
