import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  redactSecrets: (value: string) => value,
}));

import {
  fetchIceServersFromSignaling,
} from "../../services/sync/signaling";
import {
  validateIceServers,
  addToWhitelist,
  setFirewallDisabled,
  isFirewallEnabled,
  invalidateWhitelistCache,
  NetworkFirewallError,
} from "../../utils/networkFirewall";

/**
 * Wiring contract: the signaling server's `init` frame can carry ephemeral
 * coturn REST TURN relays (server/src/index.ts: buildTurnIceServers). The P2P
 * stack must be able to use them, and the firewall policy must stay
 * consistent for ICE servers:
 *
 *   - turn:/turns: are PROTOCOL WILDCARDS by design (networkFirewall.ts
 *     preset list). Any TURN relay is allowed without a whitelist entry:
 *     WebRTC data/media is DTLS-encrypted end-to-end, so a relay only sees
 *     ciphertext (it cannot read or forge payloads). TURN relays are also
 *     operator-configured (self-hosted coturn), so blocking unknown relays
 *     would break legitimate deployments for no confidentiality gain.
 *   - stun: is NOT a wildcard — only the exact whitelisted Google STUN
 *     endpoints (and any explicit user grant) pass. STUN leaks the client's
 *     reflexive IP to the server, so arbitrary STUN hosts must be blocked
 *     (P0 regression: p0-ice-whitelist.regression.test.ts).
 */
describe("signaling → firewall ICE authorization", () => {
  // Class-based WebSocket mock (same pattern as networkFirewall.test.ts):
  // `firewalledWebSocket` does `new globalThis.WebSocket(...)`, and a
  // constructor must be a real function/class for `new` to behave.
  class MockWebSocket {
    static instance: MockWebSocket | undefined;
    close = vi.fn();
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_url: string, _protocols?: string | string[]) {
      MockWebSocket.instance = this;
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    invalidateWhitelistCache();
    setFirewallDisabled(false);
    expect(isFirewallEnabled()).toBe(true);
    vi.stubGlobal("WebSocket", MockWebSocket);
    // The probe goes through checkNetworkRequest(url, "TURN_Probe") on the
    // REAL firewall — whitelist the signaling origin so the probe passes.
    await addToWhitelist("wss://signaling.example.com");
  });

  afterEach(() => {
    setFirewallDisabled(true);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns the relays advertised in the init frame", async () => {
    // Simulate the server's init frame arriving asynchronously.
    setTimeout(() => {
      MockWebSocket.instance?.onmessage?.({
        data: JSON.stringify({
          type: "init",
          yourPeerId: "peer-1",
          iceServers: [
            {
              urls: "turn:relay.example.com:3478?transport=udp",
              username: "expiry:turn",
              credential: "abc123",
            },
          ],
        }),
      });
    }, 5);

    const servers = await fetchIceServersFromSignaling(
      "wss://signaling.example.com",
    );
    expect(servers).toHaveLength(1);
    expect(servers[0]!.urls).toBe("turn:relay.example.com:3478?transport=udp");
  });

  it("allows TURN relays not advertised by the signaling server (protocol wildcard by design)", async () => {
    // turn:/turns: are deliberate protocol wildcards — a relay that was never
    // in the init frame (e.g. a self-hosted coturn the user configured) must
    // still pass the firewall: DTLS protects everything WebRTC sends through
    // it, so rejecting unknown relays adds no confidentiality.
    await expect(
      validateIceServers({
        iceServers: [{ urls: "turn:relay.example.com:5349" }],
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a STUN server that is not whitelisted (stun: is NOT a wildcard)", async () => {
    // Unlike turn:/turns:, stun: has no protocol wildcard — an arbitrary
    // STUN host must fail closed with NetworkFirewallError.
    await expect(
      validateIceServers({
        iceServers: [{ urls: "stun:never-whitelisted.example.com:3478" }],
      }),
    ).rejects.toThrow(NetworkFirewallError);
  });
});
