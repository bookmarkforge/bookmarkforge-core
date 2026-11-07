import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

const t = (k: string, d?: unknown) => {
  const def =
    d && typeof d === "object"
      ? (d as Record<string, unknown>).defaultValue
      : (d as string | undefined);
  return def ?? k;
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t, i18n: { language: "en" } }),
}));

import React from "react";
import { KnowledgeMigration } from "../../components/knowledge/KnowledgeMigration";
import type { TFunction } from "i18next";

const tMock = vi.fn((k: string, d?: unknown) =>
  d && typeof d === "object"
    ? ((d as Record<string, unknown>).defaultValue ?? k)
    : ((d as unknown) ?? k),
) as unknown as TFunction;

function setRows(rows: any[]) {
  dbMock.initDB.mockResolvedValue({
    bookmarks: { find: () => ({ exec: async () => rows }) },
  });
}

describe("KnowledgeMigration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the no-data message with a single month of bookmarks", async () => {
    setRows([{ createdAt: "2023-01-15T00:00:00Z", tags: ["alpha"] }]);
    render(<KnowledgeMigration cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Knowledge Migration")).toBeInTheDocument();
    expect(screen.getByText(/Not enough data yet/i)).toBeInTheDocument();
  });

  it("renders migrations across multiple periods", async () => {
    setRows([
      { createdAt: "2023-01-15T00:00:00Z", tags: ["alpha"] },
      { createdAt: "2023-02-15T00:00:00Z", tags: ["beta"] },
    ]);
    render(<KnowledgeMigration cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Knowledge Migration")).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("filters migrations by selected period", async () => {
    setRows([
      { createdAt: "2023-01-15T00:00:00Z", tags: ["alpha"] },
      { createdAt: "2023-02-15T00:00:00Z", tags: ["beta"] },
      { createdAt: "2023-03-15T00:00:00Z", tags: ["gamma"] },
    ]);
    render(<KnowledgeMigration cardVariants={{}} t={tMock} />);
    await screen.findByText("Knowledge Migration");
    fireEvent.click(screen.getByRole("button", { name: "2023-02 → 2023-03" }));
    await waitFor(() => expect(screen.getByText("gamma")).toBeInTheDocument());
    expect(screen.queryByText("alpha")).toBeNull();
  });

  it("handles load failure gracefully", async () => {
    dbMock.initDB.mockRejectedValue(new Error("boom"));
    render(<KnowledgeMigration cardVariants={{}} t={tMock} />);
    expect(await screen.findByText(/Not enough data yet/i)).toBeInTheDocument();
  });
});
