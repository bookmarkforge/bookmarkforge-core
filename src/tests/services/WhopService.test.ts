import { describe, it, expect, beforeEach, vi } from "vitest";
import { validateAccess, getUserMemberships } from "../../services/WhopService";

// Mock the Whop SDK.
//
// Two hard requirements for this mock:
//  1. `WhopService` calls `new WhopClient(...)` at module load, so the mock
//     implementation MUST be a `function`/`class` — an arrow throws
//     "is not a constructor" and the whole suite dies at collection.
//  2. The constructor must return a SINGLETON: the tests configure mocks
//     via their own `new WhopClient(...)` while the service holds the
//     module-level instance — only a shared object makes both the same.
const { mockWhopClient } = vi.hoisted(() => ({
  mockWhopClient: {
    users: {
      checkAccess: vi.fn(),
    },
    memberships: {
      list: vi.fn(),
      cancel: vi.fn(),
      extend: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("@whop/sdk", () => ({
  WhopClient: vi.fn().mockImplementation(function WhopClientMock() {
    return mockWhopClient;
  }),
}));

describe("WhopService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WHOP_API_KEY = "test_whop_key";
  });

  describe("validateAccess", () => {
    it("should validate user access successfully", async () => {
      const { WhopClient } = await import("@whop/sdk");
      const mockWhop = new WhopClient({ token: "test_key" });
      
      // validateAccess resolves access through ACTIVE MEMBERSHIPS for the
      // product — users.checkAccess is not on the current code path.
      vi.mocked(mockWhop.memberships.list).mockResolvedValue({
        data: [
          {
            id: "mem_123",
            status: "active",
            user_id: "user_123",
            product_id: "prod_test",
            license_key: "ABC-123-XYZ",
            current_period_end: "2026-12-31T00:00:00.000Z",
          },
        ],
      } as any);

      const result = await validateAccess("user_123", "prod_test");

      expect(result.has_access).toBe(true);
      expect(result.access_level).toBe("customer");
      expect(result.membership_id).toBe("mem_123");
    });

    it("should return no_access when user lacks access", async () => {
      const { WhopClient } = await import("@whop/sdk");
      const mockWhop = new WhopClient({ token: "test_key" });
      
      // A membership exists but for a DIFFERENT product → no access.
      vi.mocked(mockWhop.memberships.list).mockResolvedValue({
        data: [
          {
            id: "mem_other",
            status: "active",
            user_id: "user_123",
            product_id: "prod_other",
          },
        ],
      } as any);

      const result = await validateAccess("user_123", "prod_test");

      expect(result.has_access).toBe(false);
      expect(result.access_level).toBe("no_access");
    });

    it("should handle API errors gracefully", async () => {
      const { WhopClient } = await import("@whop/sdk");
      const mockWhop = new WhopClient({ token: "test_key" });
      
      vi.mocked(mockWhop.memberships.list).mockRejectedValue(new Error("API error"));

      const result = await validateAccess("user_123", "prod_test");

      expect(result.has_access).toBe(false);
      expect(result.access_level).toBe("no_access");
    });
  });

  describe("getUserMemberships", () => {
    it("should return user memberships", async () => {
      const { WhopClient } = await import("@whop/sdk");
      const mockWhop = new WhopClient({ token: "test_key" });
      
      const mockPage = {
        data: [
          {
            id: "mem_123",
            status: "active",
            user_id: "user_123",
            product_id: "prod_test",
            plan_id: "plan_123",
            license_key: "ABC-123-XYZ",
            cancel_at_period_end: false,
            current_period_end: "2026-12-31T00:00:00.000Z",
            metadata: {},
            created_at: "2026-01-01T00:00:00.000Z",
            account: {} as any,
            member: {} as any,
            phone_number: null,
          },
        ],
        rawResponse: {} as any,
        response: {} as any,
        hasNextPage: false,
        loadNextPage: vi.fn(),
        getNextPage: vi.fn(),
        iterMessages: vi.fn(),
        getItems: vi.fn(),
        [Symbol.asyncIterator]: vi.fn(),
      };
      
      vi.mocked(mockWhop.memberships.list).mockResolvedValue(mockPage as any);

      const memberships = await getUserMemberships("user_123");

      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.id).toBe("mem_123");
      expect(memberships[0]?.status).toBe("active");
    });

    it("should return empty array on API error", async () => {
      const { WhopClient } = await import("@whop/sdk");
      const mockWhop = new WhopClient({ token: "test_key" });
      
      vi.mocked(mockWhop.memberships.list).mockRejectedValue(new Error("API error"));

      const memberships = await getUserMemberships("user_123");

      expect(memberships).toEqual([]);
    });

    it("should handle empty membership list", async () => {
      const { WhopClient } = await import("@whop/sdk");
      const mockWhop = new WhopClient({ token: "test_key" });
      
      const mockPage = {
        data: [],
        rawResponse: {} as any,
        response: {} as any,
        hasNextPage: false,
        loadNextPage: vi.fn(),
        getNextPage: vi.fn(),
        iterMessages: vi.fn(),
        getItems: vi.fn(),
        [Symbol.asyncIterator]: vi.fn(),
      };
      
      vi.mocked(mockWhop.memberships.list).mockResolvedValue(mockPage as any);

      const memberships = await getUserMemberships("user_123");

      expect(memberships).toEqual([]);
    });

    it("should handle null user_id", async () => {
      const { WhopClient } = await import("@whop/sdk");
      const mockWhop = new WhopClient({ token: "test_key" });
      
      const mockPage = {
        data: [
          {
            id: "mem_123",
            status: "active",
            user_id: null,
            product_id: "prod_test",
            plan_id: "plan_123",
            license_key: "ABC-123-XYZ",
            cancel_at_period_end: false,
            current_period_end: "2026-12-31T00:00:00.000Z",
            metadata: {},
            created_at: "2026-01-01T00:00:00.000Z",
            account: {} as any,
            member: {} as any,
            phone_number: null,
          },
        ],
        rawResponse: {} as any,
        response: {} as any,
        hasNextPage: false,
        loadNextPage: vi.fn(),
        getNextPage: vi.fn(),
        iterMessages: vi.fn(),
        getItems: vi.fn(),
        [Symbol.asyncIterator]: vi.fn(),
      };
      
      vi.mocked(mockWhop.memberships.list).mockResolvedValue(mockPage as any);

      const memberships = await getUserMemberships("user_123");

      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.user_id).toBe("");
    });
  });
});
