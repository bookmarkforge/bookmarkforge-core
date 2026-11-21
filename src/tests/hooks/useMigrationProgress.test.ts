import { describe, it, expect } from "vitest";
import { useMigrationProgress } from "../../hooks/useMigrationProgress";

vi.mock("../../services/migrationProgressService", () => ({
  getMigrationProgress: vi.fn(() => ({ completed: 0, total: 100 })),
  subscribeMigrationProgress: vi.fn(() => vi.fn()),
}));

describe("useMigrationProgress", () => {
  it("exports the hook function", () => {
    expect(typeof useMigrationProgress).toBe("function");
  });
});
