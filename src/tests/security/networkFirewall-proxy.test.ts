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
  firewalledFetch,
  invalidateWhitelistCache,
  setFirewallDisabled,
  addToWhitelist,
  removeFromWhitelist,
  getWhitelistedOrigins,
  NetworkFirewallError,
} from "../../utils/networkFirewall";

describe("NetworkFirewall — S5 fetch proxy (ADR-017)", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    invalidateWhitelistCache();
    setFirewallDisabled(false);
    mockFetch = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    setFirewallDisabled(true);
    vi.unstubAllGlobals();
    // Clean up proxy env var
    vi.unstubAllEnvs();
  });

  describe("firewalledFetch proxy routing", () => {
    it("routes external requests through proxy when VITE_FETCH_PROXY_URL is set", async () => {
      vi.stubEnv("VITE_FETCH_PROXY_URL", "https://proxy.example.com/fetch");
      await addToWhitelist("https://api.openai.com");

      await firewalledFetch("https://api.openai.com/v1/chat", {}, "test");

      // Should call fetch with proxy URL, not original
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // The mock was called exactly once (asserted above), so the call
      // entry exists; `!` narrows the index-signature type.
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://proxy.example.com/fetch");

      // Should set X-Target-Url header with original URL
      const headers = init.headers as Headers;
      expect(headers.get("X-Target-Url")).toBe(
        "https://api.openai.com/v1/chat",
      );
      expect(headers.get("X-Fetch-Context")).toBe("test");

      await removeFromWhitelist("https://api.openai.com");
    });

    it("does NOT proxy local/origin URLs", async () => {
      vi.stubEnv("VITE_FETCH_PROXY_URL", "https://proxy.example.com/fetch");

      // Same-origin request should go direct
      const localUrl = `${self.location.origin}/api/local`;
      await firewalledFetch(localUrl, {}, "test");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      // The mock was called exactly once (asserted above); `!` narrows the
      // index-signature type on the destructuring source.
      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe(localUrl);
    });

    it("does NOT proxy localhost requests", async () => {
      vi.stubEnv("VITE_FETCH_PROXY_URL", "https://proxy.example.com/fetch");

      await firewalledFetch("http://localhost:11434/api", {}, "ollama");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe("http://localhost:11434/api");
    });

    it("does NOT proxy 127.0.0.1 requests", async () => {
      vi.stubEnv("VITE_FETCH_PROXY_URL", "https://proxy.example.com/fetch");

      await firewalledFetch("http://127.0.0.1:3000/api", {}, "test");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe("http://127.0.0.1:3000/api");
    });

    it("fires firewall check BEFORE proxy rewrite (blocks first)", async () => {
      vi.stubEnv("VITE_FETCH_PROXY_URL", "https://proxy.example.com/fetch");

      // This URL is not whitelisted — firewall should block it
      await expect(
        firewalledFetch("https://evil.example.com/steal", {}, "test"),
      ).rejects.toThrow(NetworkFirewallError);

      // Fetch should NOT have been called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("goes direct when proxy is not set", async () => {
      // No VITE_FETCH_PROXY_URL set
      await addToWhitelist("https://api.openai.com");

      await firewalledFetch("https://api.openai.com/v1/chat", {}, "test");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://api.openai.com/v1/chat");

      await removeFromWhitelist("https://api.openai.com");
    });

    it("preserves original request method and body in proxy mode", async () => {
      vi.stubEnv("VITE_FETCH_PROXY_URL", "https://proxy.example.com/fetch");
      await addToWhitelist("https://api.openai.com");

      const body = JSON.stringify({ model: "gpt-4", messages: [] });
      await firewalledFetch(
        "https://api.openai.com/v1/chat",
        { method: "POST", body, headers: { "Content-Type": "application/json" } },
        "gemini-api",
      );

      const [, init] = mockFetch.mock.calls[0]!;
      expect(init.method).toBe("POST");
      expect(init.body).toBe(body);
      expect((init.headers as Headers).get("Content-Type")).toBe(
        "application/json",
      );
      // The proxy adds X-Target-Url and X-Fetch-Context on top
      expect((init.headers as Headers).get("X-Target-Url")).toBe(
        "https://api.openai.com/v1/chat",
      );
      expect((init.headers as Headers).get("X-Fetch-Context")).toBe(
        "gemini-api",
      );

      await removeFromWhitelist("https://api.openai.com");
    });

    it("does not set X-Fetch-Context when context is undefined", async () => {
      vi.stubEnv("VITE_FETCH_PROXY_URL", "https://proxy.example.com/fetch");
      await addToWhitelist("https://api.openai.com");

      await firewalledFetch("https://api.openai.com/v1/chat");

      const [, init] = mockFetch.mock.calls[0]!;
      const headers = init.headers as Headers;
      expect(headers.has("X-Fetch-Context")).toBe(false);
      expect(headers.get("X-Target-Url")).toBe(
        "https://api.openai.com/v1/chat",
      );

      await removeFromWhitelist("https://api.openai.com");
    });
  });

  describe("TURN URL presets in ICE whitelist", () => {
    it("allows stun: protocol URLs in ICE validation", async () => {
      const { validateIceServers } = await import(
        "../../utils/networkFirewall"
      );
      // stun: is a preset — should not throw
      await expect(
        validateIceServers({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        }),
      ).resolves.toBeUndefined();
    });

    it("allows turn: protocol URLs in ICE validation", async () => {
      const { validateIceServers } = await import(
        "../../utils/networkFirewall"
      );
      // turn: is a preset origin — should not throw for the protocol check
      // (the full URL will be checked against the protocol prefix)
      await expect(
        validateIceServers({
          iceServers: [{ urls: "turn:my-server.example.com:3478" }],
        }),
      ).resolves.toBeUndefined();
    });

    it("allows turns: protocol URLs in ICE validation", async () => {
      const { validateIceServers } = await import(
        "../../utils/networkFirewall"
      );
      await expect(
        validateIceServers({
          iceServers: [{ urls: "turns:my-server.example.com:5349" }],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("Preset origins (lazy getters — now testable with vi.stubEnv)", () => {
    // Tests 1-2 verify default presets — complementan los del main test file
    it("includes default p2p signaling presets in whitelist", async () => {
      invalidateWhitelistCache();
      const origins = await getWhitelistedOrigins();
      expect(origins).toContain("wss://signaling.rxdb.info");
      expect(origins).toContain("wss://signaling.pubnub.com");
    });

    it("includes ollama preset and default ICE presets", async () => {
      invalidateWhitelistCache();
      const origins = await getWhitelistedOrigins();
      expect(origins).toContain("http://localhost:11434");
      expect(origins).toContain("stun:stun.l.google.com:19302");
      expect(origins).toContain("stun:stun1.l.google.com:19302");
      expect(origins).toContain("turn:");
      expect(origins).toContain("turns:");
    });

    it("prepends custom p2p signaling URL via VITE_P2P_SIGNALING_URL", async () => {
      vi.stubEnv("VITE_P2P_SIGNALING_URL", "wss://custom-p2p.example.com");
      // resetModules + dynamic import: forces re-evaluation of env.config
      // so registryEnv.p2pSignalingUrl reads the current stub
      vi.resetModules();
      const nf = await import("../../utils/networkFirewall");
      nf.invalidateWhitelistCache();
      const origins = await nf.getWhitelistedOrigins();
      expect(origins).toContain("wss://custom-p2p.example.com");
      vi.unstubAllEnvs();
    });

    it("custom p2p URL already in presets is not duplicated", async () => {
      vi.stubEnv(
        "VITE_P2P_SIGNALING_URL",
        "wss://signaling.rxdb.info",
      );
      vi.resetModules();
      const nf = await import("../../utils/networkFirewall");
      nf.invalidateWhitelistCache();
      const origins = await nf.getWhitelistedOrigins();
      expect(origins.filter((o) => o === "wss://signaling.rxdb.info")).toHaveLength(1);
      vi.unstubAllEnvs();
    });

    it("handles custom TURN URL with valid URL format", async () => {
      vi.stubEnv(
        "VITE_TURN_URL",
        "turn:my-turn.example.com:3478?transport=tcp",
      );
      vi.resetModules();
      const nf = await import("../../utils/networkFirewall");
      nf.invalidateWhitelistCache();
      const origins = await nf.getWhitelistedOrigins();
      expect(origins).toContain("turn:my-turn.example.com:3478");
      vi.unstubAllEnvs();
    });

    it("handles invalid TURN URL by using the raw string", async () => {
      vi.stubEnv("VITE_TURN_URL", "not-a-valid-url");
      vi.resetModules();
      const nf = await import("../../utils/networkFirewall");
      nf.invalidateWhitelistCache();
      const origins = await nf.getWhitelistedOrigins();
      expect(origins).toContain("not-a-valid-url");
      vi.unstubAllEnvs();
    });
  });
});
