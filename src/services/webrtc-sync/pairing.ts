// M2 (WebRTC peer authentication): mutual pairing proof for
// the manual QR sync. Possession of the SDP blob alone must not grant
// read/write access to the vault; a pairing secret established out-of-band
// (inside the QR payload, or typed by the user as a short code) gates the
// data channel behind an HMAC handshake plus a short authentication string
// the user compares on both screens.
//
// Wire contract (stable): the QR payload stays a single LZString-compressed
// JSON object. New senders MAY add `pair: {v:1, m:"verify", s:<hex64>}` or
// `pair: {v:1, m:"code"}` to the OFFER description only; receivers that
// predate this feature ignore the unknown field and keep working (legacy
// mode). Data-channel messages `bmf_pair_hello` / `bmf_pair_confirm` are
// only exchanged when BOTH peers armed pairing — a legacy peer simply never
// answers and the pairing session fails closed after a bounded timeout.

const textEncoder = new TextEncoder();

/** Roles on the pairing channel. The offer sender is always "host". */
export type PairingRole = "host" | "client";
export type PairingMode = "verify" | "code";

/** 16 random bytes → 128-bit pairing secret carried inside the QR (verify). */
const PAIR_SECRET_BYTES = 16;
/** Typed-code alphabet: Crockford-style, no I/L/O/U so codes survive being
 * read aloud or retyped from a screen. 32 symbols × 12 chars ≈ 60 bits. */
export const PAIRING_CODE_ALPHABET =
  "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PAIRING_CODE_LENGTH = 12;

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function bytesToHex(bytes: Uint8Array): string {
  return toHex(bytes);
}

export function hexToBytes(hex: string): Uint8Array | null {
  if (typeof hex !== "string" || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Random 128-bit secret for "verify" mode (travels inside the QR). */
export function generatePairSecretBytes(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(PAIR_SECRET_BYTES));
}

/** Random per-session nonce (128-bit, hex). */
export function generatePairingNonce(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Generate the short pairing code shown on the host screen ("code" mode).
 * 12 symbols from a 32-char unambiguous alphabet ≈ 60 bits of entropy —
 * far beyond what an online guessing attack can reach inside the pairing
 * window, and the code itself is never the HMAC key: it is hashed into one.
 */
export function generatePairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PAIRING_CODE_LENGTH));
  let out = "";
  for (const b of bytes) {
    out += PAIRING_CODE_ALPHABET[b % PAIRING_CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Canonicalize user-typed input: uppercase, strip everything that is not an
 * alphabet character (dashes/spaces the UI inserts are ignored). Returns the
 * 12-symbol code or null when the input cannot be a valid code.
 */
export function normalizePairingCode(input: string): string | null {
  if (typeof input !== "string") return null;
  const clean = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (clean.length !== PAIRING_CODE_LENGTH) return null;
  for (const ch of clean) {
    if (!PAIRING_CODE_ALPHABET.includes(ch)) return null;
  }
  return clean;
}

/**
 * Derive the 256-bit pairing secret from a typed code. Domain-separated so
 * a code can never be confused with any other SHA-256 input in the app.
 */
export async function pairSecretFromCode(code: string): Promise<Uint8Array> {
  const normalized = normalizePairingCode(code);
  if (!normalized) {
    throw new Error("Invalid pairing code format");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`bmf-pair-code:v1:${normalized}`),
  );
  return new Uint8Array(digest);
}

async function importHmacKey(
  secret: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  // Copy into a fresh ArrayBuffer — subtle.importKey does not retain the
  // caller's view, and the caller zeroizes `secret` on session teardown.
  const copy = new Uint8Array(secret);
  try {
    return await crypto.subtle.importKey(
      "raw",
      copy,
      { name: "HMAC", hash: "SHA-256" },
      false,
      usages,
    );
  } finally {
    copy.fill(0);
  }
}

/**
 * MAC proving knowledge of the pairing secret for the hello frame:
 * HMAC-SHA256(secret, `bmf-pair-hello:v1:${role}:${nonce}`).
 */
export async function pairHelloMac(
  secret: Uint8Array,
  role: PairingRole,
  nonce: string,
): Promise<string> {
  const key = await importHmacKey(secret, ["sign"]);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(`bmf-pair-hello:v1:${role}:${nonce}`),
  );
  return toHex(sig);
}

/**
 * Derive the per-session context once both nonces are known:
 * sessionKey = HKDF-SHA256(secret, salt = hostNonce || clientNonce,
 * info = "bmf-p2p-session:v1")
 * sas = HMAC-SHA256(sessionKey, "bmf-p2p-sas:v1") → 6 digits
 * Binding the salt to BOTH nonces means a relay that swaps one side's hello
 * produces a different SAS on each screen — exactly what the user compares.
 */
export async function derivePairingSession(
  secret: Uint8Array,
  hostNonceHex: string,
  clientNonceHex: string,
): Promise<{ sessionKey: CryptoKey; sas: string }> {
  const hostNonce = hexToBytes(hostNonceHex);
  const clientNonce = hexToBytes(clientNonceHex);
  if (!hostNonce || !clientNonce) {
    throw new Error("Invalid pairing nonce");
  }
  const salt = new Uint8Array(hostNonce.length + clientNonce.length);
  salt.set(hostNonce, 0);
  salt.set(clientNonce, hostNonce.length);
  try {
    const hkdfKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(secret),
      "HKDF",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: textEncoder.encode("bmf-p2p-session:v1"),
      },
      hkdfKey,
      256,
    );
    const sessionKey = await crypto.subtle.importKey(
      "raw",
      bits,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const sasSig = await crypto.subtle.sign(
      "HMAC",
      sessionKey,
      textEncoder.encode("bmf-p2p-sas:v1"),
    );
    const view = new DataView(sasSig);
    const sasNumber = view.getUint32(0) % 1_000_000;
    return { sessionKey, sas: String(sasNumber).padStart(6, "0") };
  } finally {
    salt.fill(0);
    hostNonce.fill(0);
    clientNonce.fill(0);
  }
}
