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
  const hex = Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
