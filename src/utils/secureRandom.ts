function generateSecureRandomBytes(length: number): Uint8Array {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return array;
  }

  throw new Error(
    "CRYPTO_UNAVAILABLE: Web Crypto API (crypto.getRandomValues) is required for secure random generation",
  );
}

export function generateSecureToken(length: number = 32): string {
  const bytes = generateSecureRandomBytes(length);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
