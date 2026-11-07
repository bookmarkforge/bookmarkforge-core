import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  configureNetworkFirewall,
  checkNetworkRequest,
  addToWhitelist,
  removeFromWhitelist,
  getWhitelistedOrigins,
  invalidateWhitelistCache,
  setFirewallDisabled,
  isFirewallEnabled,
  firewalledFetch,
  NetworkFirewallError,
} from "../../utils/networkFirewall";

vi.mock("../../env.config", () => ({
  env: { disableNetworkFirewall: false },
  readDynamicEnv: vi.fn((name: string) => {
    if (name === "PROD") return "false";
    return undefined;
  }),
  parseBool: vi.fn((val: string | undefined) => val === "true"),
}));

vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
  redactSecrets: vi.fn((x: string) => x),
}));

vi.mock("../../utils/ipSecurity", () => ({
  isLoopbackHost: vi.fn(() => false),
}));

const mockSecureStorage = {
  getSecret: vi.fn<() => Promise<string | null>>(),
  setSecret: vi.fn<() => Promise<void>>(),
};

const mockAuditLog = {
  record: vi.fn<() => Promise<void>>(),
};

describe("networkFirewall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureNetworkFirewall({
      secureStorage: mockSecureStorage,
      auditLog: mockAuditLog,
    });
    invalidateWhitelistCache();
    setFirewallDisabled(false);
    mockSecureStorage.getSecret.mockResolvedValue(null);
    mockSecureStorage.setSecret.mockResolvedValue(undefined);
    mockAuditLog.record.mockResolvedValue(undefined);
  });

  afterEach(() => {
    setFirewallDisabled(false);
  });

  describe("configureNetworkFirewall", () => {
    it("injects dependencies", () => {
      expect(() => {
        configureNetworkFirewall({
          secureStorage: mockSecureStorage,
          auditLog: mockAuditLog,
        });
      }).not.toThrow();
    });
  });

  describe("setFirewallDisabled / isFirewallEnabled", () => {
    it("enables firewall by default", () => {
      expect(isFirewallEnabled()).toBe(true);
    });

    it("can be disabled in non-prod", () => {
      setFirewallDisabled(true);
      expect(isFirewallEnabled()).toBe(false);
    });

    it("can be re-enabled", () => {
      setFirewallDisabled(true);
      setFirewallDisabled(false);
      expect(isFirewallEnabled()).toBe(true);
    });
  });

  describe("addToWhitelist", () => {
    it("rejects invalid entries", async () => {
      await expect(addToWhitelist("")).rejects.toThrow();
      await expect(addToWhitelist("not a url")).rejects.toThrow();
      await expect(addToWhitelist("http://user:pass@example.com")).rejects.toThrow();
    });

    it("accepts valid HTTP origins", async () => {
      await expect(addToWhitelist("https://example.com")).resolves.not.toThrow();
      expect(mockSecureStorage.setSecret).toHaveBeenCalled();
    });

    it("accepts valid HTTPS origins", async () => {
      await expect(addToWhitelist("https://api.example.com")).resolves.not.toThrow();
    });

    it("accepts WebSocket origins", async () => {
      await expect(addToWhitelist("wss://example.com")).resolves.not.toThrow();
    });

    it("accepts ICE server URLs", async () => {
      await expect(addToWhitelist("stun:stun.example.com:3478")).resolves.not.toThrow();
      await expect(addToWhitelist("turn:turn.example.com:3478")).resolves.not.toThrow();
    });
  });

  describe("removeFromWhitelist", () => {
    it("rejects invalid entries", async () => {
      await expect(removeFromWhitelist("")).rejects.toThrow();
    });

    it("removes user-added origins", async () => {
      mockSecureStorage.getSecret.mockResolvedValue(JSON.stringify(["https://example.com"]));
      await expect(removeFromWhitelist("https://example.com")).resolves.not.toThrow();
    });

    it("ignores preset origins", async () => {
      await expect(removeFromWhitelist("http://localhost:11434")).resolves.not.toThrow();
    });
  });

  describe("getWhitelistedOrigins", () => {
    it("returns empty array when no whitelist", async () => {
      const origins = await getWhitelistedOrigins();
      expect(Array.isArray(origins)).toBe(true);
    });

    it("returns preset origins", async () => {
      const origins = await getWhitelistedOrigins();
      expect(origins).toContain("http://localhost:11434");
    });
  });

  describe("invalidateWhitelistCache", () => {
    it("clears the cache", () => {
      expect(() => invalidateWhitelistCache()).not.toThrow();
    });
  });

  describe("checkNetworkRequest", () => {
    it("allows same-origin requests", async () => {
      await expect(checkNetworkRequest("http://localhost:3000/api")).resolves.not.toThrow();
    });

    it("allows blob URLs", async () => {
      await expect(checkNetworkRequest("blob:https://example.com/abc")).resolves.not.toThrow();
    });

    it("allows data URLs", async () => {
      await expect(checkNetworkRequest("data:text/plain;base64,SGVsbG8=")).resolves.not.toThrow();
    });

    it("blocks non-whitelisted origins", async () => {
      await expect(checkNetworkRequest("https://evil.com")).rejects.toThrow(NetworkFirewallError);
    });

    it("allows whitelisted origins", async () => {
      await addToWhitelist("https://trusted.com");
      await expect(checkNetworkRequest("https://trusted.com/api")).resolves.not.toThrow();
    });
  });

  describe("firewalledFetch", () => {
    it("calls checkNetworkRequest when enabled", async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response());
      await expect(firewalledFetch("https://example.com")).rejects.toThrow(NetworkFirewallError);
    });

    it("bypasses firewall when disabled", async () => {
      setFirewallDisabled(true);
      global.fetch = vi.fn().mockResolvedValue(new Response());
      await expect(firewalledFetch("https://example.com")).resolves.toBeInstanceOf(Response);
    });
  });

  describe("NetworkFirewallError", () => {
    it("creates error with message", () => {
      const error = new NetworkFirewallError("https://example.com", "test reason");
      expect(error.name).toBe("NetworkFirewallError");
      expect(error.message).toContain("NETWORK BLOCKED");
    });
  });
});
