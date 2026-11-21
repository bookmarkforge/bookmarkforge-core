import { describe, it, expect } from "vitest";
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  bytesToHex,
  derivePairingSession,
  generatePairingCode,
  generatePairingNonce,
  generatePairSecretBytes,
  hexToBytes,
  normalizePairingCode,
  pairHelloMac,
  pairSecretFromCode,
} from "../../../services/webrtc-sync/pairing";

describe("webrtc-sync pairing helpers", () => {
  describe("pairing codes", () => {
    it("generates 12-symbol codes from the unambiguous alphabet", () => {
      for (let i = 0; i < 50; i++) {
        const code = generatePairingCode();
        expect(code).toHaveLength(PAIRING_CODE_LENGTH);
        for (const ch of code) {
          expect(PAIRING_CODE_ALPHABET).toContain(ch);
        }
      }
    });

    it("normalizePairingCode accepts dashes/spaces and mixed case", () => {
      const code = generatePairingCode();
      const dashed = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
      expect(normalizePairingCode(dashed)).toBe(code);
      expect(normalizePairingCode(`  ${code.toLowerCase()}  `)).toBe(code);
    });

    it("normalizePairingCode rejects wrong length and foreign characters", () => {
      expect(normalizePairingCode("SHORT")).toBeNull();
      expect(normalizePairingCode("AAAA-AAAA-AAAA-AAAAA")).toBeNull();
      // 'I', 'L', 'O', 'U' are not in the alphabet.
      expect(normalizePairingCode("IIIIIIIIIIII")).toBeNull();
      expect(normalizePairingCode("OOOOOOOOOOOO")).toBeNull();
      expect(normalizePairingCode("")).toBeNull();
      expect(normalizePairingCode(null as unknown as string)).toBeNull();
    });

    it("pairSecretFromCode is deterministic and code-sensitive", async () => {
      const code = generatePairingCode();
      const dashed = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
      const a = await pairSecretFromCode(code);
      const b = await pairSecretFromCode(dashed.toLowerCase());
      const other = await pairSecretFromCode(generatePairingCode());
      expect(a).toHaveLength(32);
      expect(bytesToHex(a)).toBe(bytesToHex(b));
      expect(bytesToHex(a)).not.toBe(bytesToHex(other));
    });

    it("pairSecretFromCode rejects malformed codes", async () => {
      await expect(pairSecretFromCode("NOPE")).rejects.toThrow();
      await expect(pairSecretFromCode("IIIIIIIIIIII")).rejects.toThrow();
    });
  });

  describe("secrets and nonces", () => {
    it("generatePairSecretBytes returns 16 random bytes", () => {
      const a = generatePairSecretBytes();
      const b = generatePairSecretBytes();
      expect(a).toHaveLength(16);
      expect(bytesToHex(a)).not.toBe(bytesToHex(b));
    });

    it("generatePairingNonce returns 32 lowercase hex chars", () => {
      const nonce = generatePairingNonce();
      expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    });

    it("hex roundtrip preserves bytes", () => {
      const bytes = generatePairSecretBytes();
      const back = hexToBytes(bytesToHex(bytes));
      expect(back).not.toBeNull();
      expect(bytesToHex(back!)).toBe(bytesToHex(bytes));
      expect(hexToBytes("zz")).toBeNull();
      expect(hexToBytes("abc")).toBeNull();
    });
  });

  describe("hello MAC", () => {
    it("is deterministic and binds role + nonce + secret", async () => {
      const secret = generatePairSecretBytes();
      const mac1 = await pairHelloMac(secret, "host", "a".repeat(32));
      const mac2 = await pairHelloMac(secret, "host", "a".repeat(32));
      const macOtherRole = await pairHelloMac(secret, "client", "a".repeat(32));
      const macOtherNonce = await pairHelloMac(secret, "host", "b".repeat(32));
      const macOtherSecret = await pairHelloMac(
        generatePairSecretBytes(),
        "host",
        "a".repeat(32),
      );
      expect(mac1).toBe(mac2);
      expect(mac1).toMatch(/^[0-9a-f]{64}$/);
      expect(mac1).not.toBe(macOtherRole);
      expect(mac1).not.toBe(macOtherNonce);
      expect(mac1).not.toBe(macOtherSecret);
    });
  });

  describe("session derivation / SAS", () => {
    it("both roles derive the SAME sas when given host||client nonce order", async () => {
      const secret = generatePairSecretBytes();
      const hostNonce = generatePairingNonce();
      const clientNonce = generatePairingNonce();
      const hostSide = await derivePairingSession(
        secret,
        hostNonce,
        clientNonce,
      );
      const clientSide = await derivePairingSession(
        secret,
        hostNonce,
        clientNonce,
      );
      expect(hostSide.sas).toBe(clientSide.sas);
      expect(hostSide.sas).toMatch(/^\d{6}$/);
    });

    it("different secrets or nonces produce different SAS values", async () => {
      const secret = generatePairSecretBytes();
      const hostNonce = generatePairingNonce();
      const clientNonce = generatePairingNonce();
      const base = await derivePairingSession(secret, hostNonce, clientNonce);
      const otherSecret = await derivePairingSession(
        generatePairSecretBytes(),
        hostNonce,
        clientNonce,
      );
      const otherNonce = await derivePairingSession(
        secret,
        hostNonce,
        generatePairingNonce(),
      );
      expect(base.sas).not.toBe(otherSecret.sas);
      expect(base.sas).not.toBe(otherNonce.sas);
    });
  });
});
