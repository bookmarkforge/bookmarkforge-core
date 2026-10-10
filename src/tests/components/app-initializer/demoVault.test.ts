import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = {
  collections: {
    documents: {
      find: vi.fn(),
      insert: vi.fn(),
    },
    bookmarks: {
      find: vi.fn(),
      insert: vi.fn(),
    },
    flashcards: {
      find: vi.fn(),
      insert: vi.fn(),
    },
  },
};

const mockInitDB = vi.fn().mockResolvedValue(mockDb);
vi.mock("../../../db/database", () => ({ initDB: vi.fn(() => mockInitDB()) }));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockSafeGet = vi.fn().mockReturnValue(null);
const mockSafeSet = vi.fn();
vi.mock("../../../store/safeStorage", () => ({
  safeGet: (...args: any[]) => mockSafeGet(...args),
  safeSet: (...args: any[]) => mockSafeSet(...args),
}));

import { createDemoVault } from "../../../components/app-initializer/demoVault";

describe("createDemoVault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // P93: the demo vault only seeds when the user opted into demo mode.
    // DEMO_ACTIVE ("forge_demo_active") returns "true", everything else null.
    mockSafeGet.mockImplementation((key: string) =>
      key === "forge_demo_active" ? "true" : null,
    );
    mockDb.collections.documents.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    });
    mockDb.collections.bookmarks.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    });
    mockDb.collections.flashcards.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    });
    mockInitDB.mockResolvedValue(mockDb);
  });

  it("P93: seeds nothing when the user is NOT in demo mode", async () => {
    mockSafeGet.mockImplementation(() => null);
    await createDemoVault();
    expect(mockInitDB).not.toHaveBeenCalled();
    expect(mockDb.collections.documents.insert).not.toHaveBeenCalled();
    expect(mockDb.collections.bookmarks.insert).not.toHaveBeenCalled();
  });

  it("should skip if demo vault already created", async () => {
    mockSafeGet.mockReturnValue("true");
    await createDemoVault();
    expect(mockDb.collections.documents.insert).not.toHaveBeenCalled();
  });

  it("should skip if collections already have data", async () => {
    mockDb.collections.documents.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue([{ id: "existing" }]),
    });
    mockDb.collections.bookmarks.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    });
    await createDemoVault();
    expect(mockDb.collections.documents.insert).not.toHaveBeenCalled();
  });

  it("should skip if documents or bookmarks collection is missing", async () => {
    const partialDb = {
      collections: { bookmarks: mockDb.collections.bookmarks },
    } as any;
    (partialDb as any).bookmarks = mockDb.collections.bookmarks;
    mockInitDB.mockResolvedValue(partialDb);
    await createDemoVault();
    expect(mockDb.collections.documents.insert).not.toHaveBeenCalled();
  });

  it("should insert demo data when vault is empty", async () => {
    mockDb.collections.documents.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    });
    mockDb.collections.bookmarks.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    });
    await createDemoVault();
    expect(mockDb.collections.documents.insert).toHaveBeenCalled();
    expect(mockDb.collections.bookmarks.insert).toHaveBeenCalled();
    expect(mockSafeSet).toHaveBeenCalledWith("forge_demo_vault_created", "true");
  });

  it("should insert flashcards when collection exists", async () => {
    await createDemoVault();
    expect(mockDb.collections.flashcards.insert).toHaveBeenCalled();
  });

  it("should handle errors gracefully", async () => {
    mockInitDB.mockRejectedValue(new Error("db fail"));
    await expect(createDemoVault()).resolves.toBeUndefined();
  });
});

// Regression: the demo-mode path must log init failures (security copy assert)
import { logger } from "../../../utils/logger";

describe("createDemoVault error logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeGet.mockImplementation((key: string) =>
      key === "forge_demo_active" ? "true" : null,
    );
    mockInitDB.mockRejectedValue(new Error("db down"));
  });

  it("logs the failure when demo mode is on and init fails", async () => {
    await createDemoVault();
    expect(logger.error).toHaveBeenCalled();
  });
});
