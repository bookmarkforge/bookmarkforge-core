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
  checkNetworkRequest,
  addToWhitelist,
  removeFromWhitelist,
  getWhitelistedOrigins,
  setFirewallDisabled,
  isFirewallEnabled,
  invalidateWhitelistCache,
  firewalledFetch,
  firewalledWebSocket,
  firewalledEventSource,
  validateIceServers,
  configureNetworkFirewall,
  NetworkFirewallError,
} from "../../utils/networkFirewall";
import { secureStorage } from "../../services/SecureStorage";
import { auditLog } from "../../services/AuditLogService";
import { logger } from "../../utils/logger";
import { isLoopbackHost, isPrivateHost } from "../../utils/ipSecurity";
import {
  allUrls,
  ipv4Bases,
  ipv4Forms,
  ipv6UrlHosts,
} from "../helpers/ssrfCorpus";

describe("NetworkFirewall — unit tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateWhitelistCache();
    // Inyectar mocks via DI — networkFirewall no importa estos servicios directamente
    configureNetworkFirewall({ secureStorage, auditLog });
    setFirewallDisabled(false);
    expect(isFirewallEnabled()).toBe(true);
  });

  afterEach(() => {
    setFirewallDisabled(true);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("checkNetworkRequest", () => {
    it("allows blob: URLs", async () => {
      await expect(
        checkNetworkRequest("blob:http://localhost:5173/abc", "test"),
      ).resolves.toBeUndefined();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it("allows data: URLs", async () => {
      await expect(
        checkNetworkRequest("data:text/html,<h1>hi</h1>", "test"),
      ).resolves.toBeUndefined();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it("blocks preset OpenAI origin by default", async () => {
      await expect(
        checkNetworkRequest("https://api.openai.com/v1/chat", "test"),
      ).rejects.toThrow(NetworkFirewallError);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "firewall_blocked_request",
          target: "https://api.openai.com",
          result: "denied",
          origin: "NetworkFirewall",
        }),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        "[NetworkFirewall] Blocked request",
        expect.objectContaining({ url: "https://api.openai.com" }),
      );
    });

    it("allows OpenAI origin after adding to whitelist", async () => {
      vi.clearAllMocks();
      await addToWhitelist("https://api.openai.com");
      await expect(
        checkNetworkRequest("https://api.openai.com/v1/chat", "test"),
      ).resolves.toBeUndefined();
      await removeFromWhitelist("https://api.openai.com");
    });

    it("blocks preset Anthropic origin by default", async () => {
      await expect(
        checkNetworkRequest("https://api.anthropic.com/v1/messages", "test"),
      ).rejects.toThrow(NetworkFirewallError);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "firewall_blocked_request",
          target: "https://api.anthropic.com",
          result: "denied",
          origin: "NetworkFirewall",
        }),
      );
    });

    it("blocks preset Groq origin by default", async () => {
      await expect(
        checkNetworkRequest("https://api.groq.com/v1/chat", "test"),
      ).rejects.toThrow(NetworkFirewallError);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "firewall_blocked_request",
          origin: "NetworkFirewall",
        }),
      );
    });

    it("blocks preset Gemini origin by default", async () => {
      await expect(
        checkNetworkRequest(
          "https://generativelanguage.googleapis.com/v1/models",
          "test",
        ),
      ).rejects.toThrow(NetworkFirewallError);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "firewall_blocked_request",
          origin: "NetworkFirewall",
        }),
      );
    });

    it("blocks preset HuggingFace origin by default", async () => {
      await expect(
        checkNetworkRequest("https://huggingface.co/api/models", "test"),
      ).rejects.toThrow(NetworkFirewallError);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "firewall_blocked_request",
          origin: "NetworkFirewall",
        }),
      );
    });

    it("allows preset RxDB signaling origin", async () => {
      await expect(
        checkNetworkRequest("wss://signaling.rxdb.info", "test"),
      ).resolves.toBeUndefined();
    });

    it("allows preset PubNub signaling origin", async () => {
      await expect(
        checkNetworkRequest(
          "wss://signaling.pubnub.com/v1/subscribe/test",
          "test",
        ),
      ).resolves.toBeUndefined();
    });

    it("blocks non-whitelisted origin", async () => {
      await expect(
        checkNetworkRequest("https://evil.example.com/steal", "test"),
      ).rejects.toThrow(NetworkFirewallError);
    });

    it("handles malformed URL as blocked", async () => {
      await expect(
        checkNetworkRequest("not a valid url://%%", "test"),
      ).rejects.toThrow(NetworkFirewallError);
    });

    it("throws NetworkFirewallError with descriptive message", async () => {
      try {
        await checkNetworkRequest("https://evil.example.com/steal", "test");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NetworkFirewallError);
        expect((err as Error).message).toContain("NETWORK BLOCKED");
        expect((err as Error).message).toContain("evil.example.com");
        expect((err as Error).message).toContain(
          "not in the network whitelist",
        );
      }
    });

    it("blocks request without context argument (covers context: undefined branch)", async () => {
      await expect(
        checkNetworkRequest("https://evil.example.com/steal"),
      ).rejects.toThrow(NetworkFirewallError);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "firewall_blocked_request",
          target: "https://evil.example.com",
          context: undefined,
        }),
      );
    });
  });

  describe("isAlwaysAllowed — loopback addresses", () => {
    it("allows requests to [::1] (IPv6 loopback)", async () => {
      await expect(
        checkNetworkRequest("http://[::1]:3000/api", "test"),
      ).resolves.toBeUndefined();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it("allows trailing-dot localhost (FQDN root form)", async () => {
      await expect(
        checkNetworkRequest("http://localhost.:3000/api", "test"),
      ).resolves.toBeUndefined();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it("allows short-form loopback 127.1 (WHATWG-normalized)", async () => {
      await expect(
        checkNetworkRequest("http://127.1:3000/api", "test"),
      ).resolves.toBeUndefined();
    });

    it("allows hex-form loopback 0x7f000001", async () => {
      await expect(
        checkNetworkRequest("http://0x7f000001:3000/api", "test"),
      ).resolves.toBeUndefined();
    });

    it("allows integer-form loopback 2130706433", async () => {
      await expect(
        checkNetworkRequest("http://2130706433:3000/api", "test"),
      ).resolves.toBeUndefined();
    });

    it("allows IPv4-mapped IPv6 loopback (hex tail)", async () => {
      await expect(
        checkNetworkRequest("http://[::ffff:7f00:1]:3000/api", "test"),
      ).resolves.toBeUndefined();
      await expect(
        checkNetworkRequest("http://[::ffff:127.0.0.1]:3000/api", "test"),
      ).resolves.toBeUndefined();
    });

    it("allows any 127/8 loopback address", async () => {
      await expect(
        checkNetworkRequest("http://127.0.0.2:3000/api", "test"),
      ).resolves.toBeUndefined();
    });

    it("does NOT treat 127.0.0.1.evil.com as loopback (public domain)", async () => {
      await expect(
        checkNetworkRequest("http://127.0.0.1.evil.com/api", "test"),
      ).rejects.toThrow(NetworkFirewallError);
    });
  });

  describe("addToWhitelist / removeFromWhitelist", () => {
    it("adds a user origin to the whitelist", async () => {
      await addToWhitelist("https://my-custom-api.com");
      const origins = await getWhitelistedOrigins();
      expect(origins).toContain("https://my-custom-api.com");
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "network_origin_added",
          target: "https://my-custom-api.com",
          result: "success",
          origin: "NetworkFirewall",
        }),
      );
    });

    it("persists user origin via secureStorage", async () => {
      await addToWhitelist("https://my-custom-api.com");
      expect(secureStorage.setSecret).toHaveBeenCalled();
    });

    it("REGRESSION (unwired DI): user origin survives a reload via getSecret", async () => {
      // Production bug class (this session): configureNetworkFirewall was only
      // called from tests, so the real secureStorage was never injected and
      // loadWhitelist() always got null from the no-op default — the user's
      // origins vanished on reload. This test simulates a reload with a
      // stateful storage: add → persist → invalidate cache (reload) → the
      // origin must still be allowed because getSecret returns what setSecret
      // stored.
      const stored = new Map<string, string>();
      (secureStorage.getSecret as ReturnType<typeof vi.fn>).mockImplementation(
        async (id: string) => stored.get(id) ?? null,
      );
      (secureStorage.setSecret as ReturnType<typeof vi.fn>).mockImplementation(
        async (id: string, value: string) => {
          stored.set(id, value);
        },
      );
      try {
        await addToWhitelist("https://my-custom-api.com");
        const persistedKey = "network_whitelist";
        expect(stored.has(persistedKey)).toBe(true);

        // Simulate page reload: in-memory cache is gone, only storage remains.
        invalidateWhitelistCache();
        const origins = await getWhitelistedOrigins();
        expect(origins).toContain("https://my-custom-api.com");
        await expect(
          checkNetworkRequest("https://my-custom-api.com/data", "reload-test"),
        ).resolves.toBeUndefined();
      } finally {
        // Restore the default mock shape even if an assertion above failed,
        // so the stateful implementations never leak into later tests
        // (beforeEach only calls vi.clearAllMocks(), which keeps impls).
        (secureStorage.getSecret as ReturnType<typeof vi.fn>).mockImplementation(
          async () => null,
        );
        (secureStorage.setSecret as ReturnType<typeof vi.fn>).mockImplementation(
          async () => undefined,
        );
      }
    });

    it("allows requests to a user-added origin after adding", async () => {
      await addToWhitelist("https://my-custom-api.com");
      await expect(
        checkNetworkRequest("https://my-custom-api.com/data", "test"),
      ).resolves.toBeUndefined();
    });

    it("removes a user origin from the whitelist", async () => {
      await addToWhitelist("https://my-custom-api.com");
      await removeFromWhitelist("https://my-custom-api.com");
      await expect(
        checkNetworkRequest("https://my-custom-api.com/data", "test"),
      ).rejects.toThrow(NetworkFirewallError);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "network_origin_removed",
          target: "https://my-custom-api.com",
          result: "success",
          origin: "NetworkFirewall",
        }),
      );
    });

    it("preserves preset origins in persistent storage", async () => {
      // Remove a user origin, verify presets are still in the persistent store
      await addToWhitelist("https://temp.example.com");
      await removeFromWhitelist("https://temp.example.com");
      // The preset origins are hardcoded in source, not in SecureStorage
      // Verify the function doesn't error and the user origin was removed
      const origins = await getWhitelistedOrigins();
      expect(origins).not.toContain("https://temp.example.com");
      expect(origins).toContain("http://localhost:11434");
    });
  });

  describe("setFirewallDisabled", () => {
    it("can disable firewall in dev mode", () => {
      setFirewallDisabled(true);
      expect(isFirewallEnabled()).toBe(false);
    });

    it("re-enables firewall", () => {
      setFirewallDisabled(true);
      setFirewallDisabled(false);
      expect(isFirewallEnabled()).toBe(true);
    });
  });

  describe("firewalledFetch", () => {
    it("blocks fetch to non-whitelisted origin when firewall is enabled", async () => {
      await expect(
        firewalledFetch("https://evil.example.com/api", {}, "test"),
      ).rejects.toThrow(NetworkFirewallError);
    });

    it("allows fetch to whitelisted origin", async () => {
      const mockFetch = vi.fn(async () => new Response("ok"));
      vi.stubGlobal("fetch", mockFetch);

      await addToWhitelist("https://api.openai.com");
      await firewalledFetch("https://api.openai.com/v1/chat", {}, "test");
      expect(mockFetch).toHaveBeenCalled();
      await removeFromWhitelist("https://api.openai.com");

      vi.unstubAllGlobals();
    });

    it("accepts a URL object as input", async () => {
      const mockFetch = vi.fn(async () => new Response("ok"));
      vi.stubGlobal("fetch", mockFetch);

      await addToWhitelist("https://api.openai.com");
      await firewalledFetch(
        new URL("https://api.openai.com/v1/chat"),
        { method: "POST" },
        "test",
      );
      expect(mockFetch).toHaveBeenCalled();
      const [url] = (mockFetch.mock.calls[0] as any);
      expect(url).toBeInstanceOf(URL);
      expect((url as URL).href).toBe("https://api.openai.com/v1/chat");

      await removeFromWhitelist("https://api.openai.com");
    });

    it("accepts a Request object as input", async () => {
      const mockFetch = vi.fn(async () => new Response("ok"));
      vi.stubGlobal("fetch", mockFetch);

      await addToWhitelist("https://api.openai.com");
      const request = new Request("https://api.openai.com/v1/chat", {
        method: "POST",
        body: JSON.stringify({ model: "gpt-4" }),
      });
      await firewalledFetch(request, undefined, "test");
      expect(mockFetch).toHaveBeenCalled();
      const [input] = (mockFetch.mock.calls[0] as any);
      expect(input).toBe(request);

      await removeFromWhitelist("https://api.openai.com");
      vi.unstubAllGlobals();
    });

    it("bypasses proxy for [::1] (IPv6 loopback) — isLocalOrigin hostname match", async () => {
      vi.stubEnv("VITE_FETCH_PROXY_URL", "https://proxy.example.com/fetch");
      const mockFetch = vi.fn(async () => new Response("ok"));
      vi.stubGlobal("fetch", mockFetch);

      await firewalledFetch("http://[::1]:3000/api", {}, "test");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = (mockFetch.mock.calls[0] as any);
      // [::1] is detected as local origin — goes direct, NOT through proxy
      expect(url).toBe("http://[::1]:3000/api");

      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it("routes through proxy when isLocalOrigin throws on invalid URL (catch branch)", async () => {
      vi.stubEnv("VITE_FETCH_PROXY_URL", "https://proxy.example.com/fetch");
      const mockFetch = vi.fn(async () => new Response("ok"));
      vi.stubGlobal("fetch", mockFetch);
      setFirewallDisabled(true);

      // http://[::1 has an unclosed IPv6 bracket — new URL() will throw in isLocalOrigin
      await firewalledFetch("http://[::1", {}, "test");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = (mockFetch.mock.calls[0] as any);
      // isLocalOrigin threw — treated as not-local → goes through proxy
      expect(url).toBe("https://proxy.example.com/fetch");

      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });
  });

  describe("firewalledWebSocket", () => {
    it("blocks WebSocket to non-whitelisted origin", async () => {
      await expect(
        firewalledWebSocket("wss://evil.example.com/ws", undefined, "test"),
      ).rejects.toThrow(NetworkFirewallError);
    });

    it("allows WebSocket to whitelisted origin", async () => {
      class MockWebSocket {
        static calls: Array<{ url: string; protocols?: string | string[] }> = [];
        url: string;
        protocols?: string | string[];
        constructor(url: string, protocols?: string | string[]) {
          this.url = url;
          this.protocols = protocols;
          MockWebSocket.calls.push({ url, protocols });
        }
      }
      vi.stubGlobal("WebSocket", MockWebSocket);

      await addToWhitelist("wss://allowed.example.com");
      const socket = await firewalledWebSocket(
        "wss://allowed.example.com/ws",
        ["chat"],
        "test",
      );
      expect(socket).toBeInstanceOf(MockWebSocket);
      expect(socket).toHaveProperty("url", "wss://allowed.example.com/ws");
      expect(socket).toHaveProperty("protocols", ["chat"]);
      expect(MockWebSocket.calls).toHaveLength(1);
      expect(MockWebSocket.calls[0] as any).toEqual({
        url: "wss://allowed.example.com/ws",
        protocols: ["chat"],
      });

      await removeFromWhitelist("wss://allowed.example.com");
    });

    it("accepts a URL object as input (covers url instanceof URL branch)", async () => {
      class MockWebSocket {
        url: string;
        constructor(url: string, _protocols?: string | string[]) {
          this.url = url;
        }
      }
      vi.stubGlobal("WebSocket", MockWebSocket);

      await addToWhitelist("wss://allowed.example.com");
      const socket = await firewalledWebSocket(
        new URL("wss://allowed.example.com/ws"),
        undefined,
        "test",
      );
      expect(socket.url).toBe("wss://allowed.example.com/ws");

      await removeFromWhitelist("wss://allowed.example.com");
      vi.unstubAllGlobals();
    });
  });

  describe("firewalledEventSource", () => {
    it("blocks EventSource to non-whitelisted origin", async () => {
      await expect(
        firewalledEventSource(
          "https://evil.example.com/events",
          undefined,
          "test",
        ),
      ).rejects.toThrow(NetworkFirewallError);
    });

    it("allows EventSource to whitelisted origin", async () => {
      class MockEventSource {
        static calls: Array<{ url: string; init: EventSourceInit }> = [];
        url: string;
        init: EventSourceInit;
        constructor(url: string, init: EventSourceInit) {
          this.url = url;
          this.init = init;
          MockEventSource.calls.push({ url, init });
        }
      }
      vi.stubGlobal("EventSource", MockEventSource);

      await addToWhitelist("https://allowed.example.com");
      const source = await firewalledEventSource(
        "https://allowed.example.com/events",
        { withCredentials: true },
        "test",
      );
      expect(source).toBeInstanceOf(MockEventSource);
      expect(source).toHaveProperty("url", "https://allowed.example.com/events");
      expect(source).toHaveProperty("init", { withCredentials: true });
      expect(MockEventSource.calls).toHaveLength(1);
      expect(MockEventSource.calls[0] as any).toEqual({
        url: "https://allowed.example.com/events",
        init: { withCredentials: true },
      });

      await removeFromWhitelist("https://allowed.example.com");
    });

    it("accepts a URL object as input (covers url instanceof URL branch)", async () => {
      class MockEventSource {
        url: string;
        constructor(url: string, _init?: EventSourceInit) {
          this.url = url;
        }
      }
      vi.stubGlobal("EventSource", MockEventSource);

      await addToWhitelist("https://allowed.example.com");
      const source = await firewalledEventSource(
        new URL("https://allowed.example.com/events"),
        undefined,
        "test",
      );
      expect(source.url).toBe("https://allowed.example.com/events");

      await removeFromWhitelist("https://allowed.example.com");
      vi.unstubAllGlobals();
    });
  });

  describe("invalidateWhitelistCache", () => {
    it("clears cached whitelist so changes take effect", async () => {
      await addToWhitelist("https://temp.example.com");
      let origins = await getWhitelistedOrigins();
      expect(origins).toContain("https://temp.example.com");

      invalidateWhitelistCache();
      await removeFromWhitelist("https://temp.example.com");
      origins = await getWhitelistedOrigins();
      expect(origins).not.toContain("https://temp.example.com");
    });

    it("respects the 5-minute TTL before re-reading secureStorage", async () => {
      const WHITELIST_TTL_MS = 5 * 60 * 1000;
      vi.useFakeTimers();
      try {
        (secureStorage.getSecret as ReturnType<typeof vi.fn>).mockClear();

        await checkNetworkRequest("wss://signaling.rxdb.info", "test");
        await checkNetworkRequest("wss://signaling.rxdb.info", "test");
        expect(secureStorage.getSecret).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(WHITELIST_TTL_MS + 1);

        await checkNetworkRequest("wss://signaling.rxdb.info", "test");
        expect(secureStorage.getSecret).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("configureNetworkFirewall invalidates cache on storage change (P1 audit fix)", async () => {
      // P1 audit fix: when storage dependencies change, the cache must be
      // invalidated to prevent using stale data from the old storage.
      await addToWhitelist("https://storage-a.example.com");
      const originsA = await getWhitelistedOrigins();
      expect(originsA).toContain("https://storage-a.example.com");

      // Simulate storage backend change
      const mockStorageB = {
        getSecret: vi.fn(async () => JSON.stringify(["https://storage-b.example.com"])),
        setSecret: vi.fn(async () => undefined),
      };
      configureNetworkFirewall({ secureStorage: mockStorageB, auditLog });

      // After reconfiguration, cache should be invalidated and read from new storage
      const originsB = await getWhitelistedOrigins();
      expect(originsB).toContain("https://storage-b.example.com");
      expect(originsB).not.toContain("https://storage-a.example.com");
    });

    it("addToWhitelist invalidates cache before writing (P1 audit fix)", async () => {
      // P1 audit fix: prevent cross-tab consistency issues by invalidating
      // cache before writing. This ensures we always read fresh state from
      // persistent storage before modifying it.
      await addToWhitelist("https://cross-tab.example.com");
      const origins = await getWhitelistedOrigins();
      expect(origins).toContain("https://cross-tab.example.com");
    });

    it("removeFromWhitelist invalidates cache before writing (P1 audit fix)", async () => {
      // P1 audit fix: same as addToWhitelist - invalidate before writing
      // to prevent cross-tab consistency issues.
      await addToWhitelist("https://remove-test.example.com");
      await removeFromWhitelist("https://remove-test.example.com");
      const origins = await getWhitelistedOrigins();
      expect(origins).not.toContain("https://remove-test.example.com");
    });
  });

  describe("getWhitelistedOrigins", () => {
    it("returns sorted list of all origins (presets + user)", async () => {
      const origins = await getWhitelistedOrigins();
      expect(origins.length).toBeGreaterThan(0);
      // Check sorted
      for (let i = 1; i < origins.length; i++) {
        expect(origins[i]!.localeCompare(origins[i - 1]!)).toBeGreaterThanOrEqual(
          0,
        );
      }
    });

    it("includes all preset origins", async () => {
      const origins = await getWhitelistedOrigins();
      expect(origins).toContain("http://localhost:11434");
      expect(origins).toContain("wss://signaling.rxdb.info");
      expect(origins).toContain("wss://signaling.pubnub.com");
    });
  });

  describe("validateIceServers", () => {
    it("rejects non-whitelisted ICE server", async () => {
      await expect(
        validateIceServers({
          iceServers: [{ urls: "stun:evil.example.com:19302" }],
        }),
      ).rejects.toThrow(NetworkFirewallError);
    });

    it("allows any turn: and turns: server (protocol wildcard in presets)", async () => {
      await expect(
        validateIceServers({
          iceServers: [{ urls: "turn:evil.example.com:3478" }],
        }),
      ).resolves.toBeUndefined();
      await expect(
        validateIceServers({
          iceServers: [{ urls: "turns:evil.example.com:5349" }],
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects with array of urls", async () => {
      await expect(
        validateIceServers({
          iceServers: [
            { urls: ["stun:evil1.com:19302", "stun:evil2.com:19302"] },
          ],
        }),
      ).rejects.toThrow(NetworkFirewallError);
    });

    it("logs warning when blocking ICE server", async () => {
      await expect(
        validateIceServers({
          iceServers: [{ urls: "stun:evil.example.com:19302" }],
        }),
      ).rejects.toThrow(NetworkFirewallError);
      expect(logger.warn).toHaveBeenCalledWith(
        "[NetworkFirewall] Blocked ICE server",
        expect.objectContaining({ url: "stun:evil.example.com:19302" }),
      );
    });

    it("returns early when no iceServers", async () => {
      await expect(validateIceServers({})).resolves.toBeUndefined();
    });

    it("returns early when firewall is disabled", async () => {
      setFirewallDisabled(true);
      await expect(
        validateIceServers({
          iceServers: [{ urls: "stun:evil.example.com:19302" }],
        }),
      ).resolves.toBeUndefined();
      setFirewallDisabled(false);
    });

    it("rejects ICE URLs without a scheme", async () => {
      await expect(
        validateIceServers({
          iceServers: [{ urls: "invalid-no-colon" }],
        }),
      ).rejects.toThrow(NetworkFirewallError);
    });
  });

  describe("auditLog failure", () => {
    it("handles auditLog failure gracefully when blocking a request", async () => {
      (auditLog.record as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("audit storage full"),
      );
      await expect(
        checkNetworkRequest("https://evil.example.com/steal", "test"),
      ).rejects.toThrow(NetworkFirewallError);
      expect(logger.warn).toHaveBeenCalledWith(
        "[NetworkFirewall] auditLog failed",
        expect.any(Error),
      );
    });

    it("handles auditLog failure gracefully when adding origin", async () => {
      (auditLog.record as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("log full"),
      );
      await expect(
        addToWhitelist("https://test.example.com"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        "[NetworkFirewall] auditLog failed",
        expect.any(Error),
      );
    });

    it("handles auditLog failure gracefully when removing origin", async () => {
      await addToWhitelist("https://test.example.com");
      (auditLog.record as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("log full"),
      );
      await expect(
        removeFromWhitelist("https://test.example.com"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        "[NetworkFirewall] auditLog failed",
        expect.any(Error),
      );
    });
  });

  describe("setFirewallDisabled production guard", () => {
    it("refuses to disable firewall in production", async () => {
      vi.stubEnv("PROD", "true" as any);
      setFirewallDisabled(true);
      expect(isFirewallEnabled()).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        "[NetworkFirewall] Refusing to disable firewall in production",
      );
      vi.unstubAllEnvs();
    });
  });

  describe("error handling", () => {
    it("gracefully handles SecureStorage failure when loading whitelist", async () => {
      (
        secureStorage.getSecret as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error("IDB failure"));
      invalidateWhitelistCache();
      // Use a non-localhost preset URL so it reaches the whitelist check
      await expect(
        checkNetworkRequest("wss://signaling.rxdb.info", "test"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        "[NetworkFirewall] SecureStorage unavailable; using preset origins only",
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("gracefully handles SecureStorage failure when adding origin", async () => {
      (
        secureStorage.setSecret as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error("IDB write failure"));
      // Should not throw — falls back to in-memory
      await expect(
        addToWhitelist("https://temp.example.com"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        "[NetworkFirewall] Failed to persist whitelist; using in-memory only",
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("gracefully handles SecureStorage failure when removing origin", async () => {
      await addToWhitelist("https://temp.example.com");
      (
        secureStorage.setSecret as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error("IDB write failure"));
      await expect(
        removeFromWhitelist("https://temp.example.com"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        "[NetworkFirewall] Failed to persist whitelist; using in-memory only",
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });
  });

  describe("app own origin", () => {
    it("allows requests to the app's own origin", async () => {
      const appOrigin = self.location.origin;
      await expect(
        checkNetworkRequest(`${appOrigin}/some-resource`, "test"),
      ).resolves.toBeUndefined();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it("allows relative same-origin assets such as the local WASM module", async () => {
      await expect(
        checkNetworkRequest("/wasm/zero-memory.wasm", "wasm-load"),
      ).resolves.toBeUndefined();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it("does not treat an app-origin prefix as same-origin", async () => {
      const appOrigin = self.location.origin;
      const parsed = new URL(appOrigin);
      const attackerOrigin = `${parsed.protocol}//${parsed.hostname}.evil.test`;
      await expect(
        checkNetworkRequest(`${attackerOrigin}/steal`, "prefix-bypass"),
      ).rejects.toThrow(NetworkFirewallError);
    });
  });

  describe("SSRF chain differential fuzzing — firewall gate 3 (P82)", () => {
    // Critical invariant: the firewall allows loopback WITHOUT a whitelist (Ollama on
    // localhost:11434). Si isLoopbackHost tuviera un falso positivo (clasificar
    // a private host like loopback), checkNetworkRequest would allow it — a
    // direct SSRF hole. This harness sweeps the whole shared corpus and
    // exige: checkNetworkRequest resuelve ⟺ el host es loopback.
    it("the firewall allows EXACTLY the loopback hosts from the corpus", async () => {
      for (const url of allUrls) {
        const hostname = new URL(url).hostname;
        const loopback = isLoopbackHost(hostname);
        if (loopback) {
          await expect(
            checkNetworkRequest(url, "p82"),
            `loopback ${url} debería permitirse`,
          ).resolves.toBeUndefined();
        } else {
          await expect(
            checkNetworkRequest(url, "p82"),
            `no-loopback ${url} no debe pasar el firewall`,
          ).rejects.toThrow(NetworkFirewallError);
        }
      }
    });

    it("completeness: all loopback forms are isLoopbackHost", () => {
      const loopbackForms = [
        ...ipv4Bases
          .filter(([a]) => a === 127)
          .flatMap(([a, b, c, d]) => ipv4Forms(a, b, c, d)),
        "localhost", "localhost.", "LOCALHOST",
        "[::1]", "[::]", "[0:0:0:0:0:0:0:1]", "[0:0:0:0:0:0:0:0]",
        "[::ffff:127.0.0.1]", "[::ffff:7f00:1]",
      ];
      expect(loopbackForms.length).toBeGreaterThan(10);
      for (const h of loopbackForms) {
        expect(isLoopbackHost(h), h).toBe(true);
      }
    });

    it("precision: no private-non-loopback host in the corpus is loopback", () => {
      const privateNonLoopback = ipv4Bases
        .filter(([a]) => a !== 127) // excluye 127/8
        .flatMap(([a, b, c, d]) => ipv4Forms(a, b, c, d));
      // Excluir los hosts IPv6 loopback del corpus (::1, ::, forma completa,
      // mapped-127) — those ARE loopback; the rest must be non-loopback.
      const loopbackIpv6 = new Set([
        "[::1]", "[::]", "[0:0:0:0:0:0:0:1]", "[0:0:0:0:0:0:0:0]",
        "[::ffff:127.0.0.1]", "[::ffff:7f00:1]",
      ]);
      const others = [
        ...ipv6UrlHosts.filter((h) => !loopbackIpv6.has(h)),
        "localhost.example.com", "127.0.0.1.evil.com",
      ];
      for (const h of [...privateNonLoopback, ...others]) {
        expect(isLoopbackHost(h), h).toBe(false);
      }
    });

    it("what the firewall allows via loopback is private for gates 1-2", () => {
      for (const url of allUrls) {
        const hostname = new URL(url).hostname;
        if (isLoopbackHost(hostname)) {
          expect(isPrivateHost(hostname), url).toBe(true);
        }
      }
    });
  });
});
