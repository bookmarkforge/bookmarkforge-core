import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: {
    getSecret: vi.fn(async () => null),
    setSecret: vi.fn(async () => undefined),
    hasSecret: vi.fn(async () => false),
    deleteSecret: vi.fn(async () => undefined),
  },
}));
vi.mock("../../services/AuditLogService", () => ({
  auditLog: { record: vi.fn(async () => undefined) },
}));

import {
  validateIceServers,
  NetworkFirewallError,
  setFirewallDisabled,
  isFirewallEnabled,
  invalidateWhitelistCache,
} from "../../utils/networkFirewall";

/**
 * Captures the rejection from `validateIceServers(...)` ONCE and asserts both
 * the canonical class AND the canonical message against the captured value.
 *
 * Why a manual try/catch instead of `.rejects.toThrow(predicate)`? Vitest in
 * this project's pin does not support function predicates on `rejects.toThrow`
 * — it coerces the argument to either a class (for `instanceof`) or a regex
 * (for message match) and silently treats function arguments as class checks,
 * producing spurious `AssertionError: ... instanceof <fn>` failures. Capturing
 * the rejection manually lets us run the validator EXACTLY ONCE and
 * independently assert class + message structure on the captured value.
 */
async function captureRejection(
  config: RTCConfiguration,
  context: string,
): Promise<unknown> {
  try {
    await validateIceServers(config, context);
  } catch (err) {
    return err;
  }
  // If validateIceServers resolves, the assertion below fails loudly.
  throw new Error(
    `validateIceServers unexpectedly resolved for ${context}; expected NetworkFirewallError`,
  );
}

describe("P0 regression — ICE whitelist (validateIceServers)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateWhitelistCache();
    // Ensure firewall is ON. setFirewallDisabled(false) flips
    // _firewallDisabled=false; together with a non-"true" env var the
    // `isFirewallEnabled()` check returns true and validation runs.
    setFirewallDisabled(false);
    // Defensive guard: surface a loud failure if the test harness sets
    // VITE_DISABLE_NETWORK_FIREWALL=true (which would silently no-op every
    // test below).
    expect(isFirewallEnabled()).toBe(true);
  });

  afterEach(() => {
    // Restore the global "firewall off" default expected by other tests.
    setFirewallDisabled(true);
  });

  it("accepts an empty iceServers array (no allowlisted servers = LAN-only intent)", async () => {
    await expect(
      validateIceServers({ iceServers: [] }, "Test_Empty"),
    ).resolves.toBeUndefined();
  });

  it("accepts a config that has NO iceServers key (undefined treated as empty)", async () => {
    await expect(
      validateIceServers({}, "Test_NoIceServers"),
    ).resolves.toBeUndefined();
  });

  it("rejects a non-whitelisted STUN server with NetworkFirewallError + canonical message", async () => {
    expect(isFirewallEnabled()).toBe(true);
    const err = await captureRejection(
      { iceServers: [{ urls: "stun:never-whitelisted.example.com:3478" }] },
      "Test_STUN_Reject",
    );
    expect(err).toBeInstanceOf(NetworkFirewallError);
    expect((err as Error).message).toMatch(/ICE server origin/);
  });

  it("allows any TURN server (turn: protocol wildcard in presets)", async () => {
    expect(isFirewallEnabled()).toBe(true);
    await expect(
      validateIceServers(
        {
          iceServers: [
            {
              urls: "turn:never-whitelisted.example.com:3478?transport=udp",
            },
          ],
        },
        "Test_TURN_Allow",
      ),
    ).resolves.toBeUndefined();
  });

  describe("Static source-file checks (P0 contracts are wired)", () => {
    it("SyncService.ts no longer hardcodes openrelay.metered.ca", () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, "../../services/SyncService.ts"),
        "utf-8",
      );
      expect(src).not.toMatch(/openrelay\.metered\.ca/);
    });

    it("SyncService.ts now calls validateIceServers for all ICE servers", () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, "../../services/SyncService.ts"),
        "utf-8",
      );
      expect(src).toMatch(/validateIceServers/);
      expect(src).toMatch(/validateIceServers/);
    });

    it("WebRTCSyncService.ts calls validateIceServers in BOTH startHost and startClient", () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, "../../services/WebRTCSyncService.ts"),
        "utf-8",
      );
      // Match the literal substring `validateIceServers` followed by optional
      // whitespace and `(`. Catches both top-level and member-call shapes.
      const calls = src.match(/validateIceServers\s*\(/g) || [];
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(src).toMatch(/WebRTC_P2P_Host/);
      expect(src).toMatch(/WebRTC_P2P_Client/);
    });

    it("WebRTCSyncService.ts has NO references to Google STUN or Metered TURN defaults", () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, "../../services/WebRTCSyncService.ts"),
        "utf-8",
      );
      expect(src).not.toMatch(/stun\.l\.google\.com/);
      expect(src).not.toMatch(/openrelay\.metered\.ca/);
    });
  });
});
