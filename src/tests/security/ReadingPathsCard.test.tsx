import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { ReadingPathsCard } from "../../components/knowledge/ReadingPathsCard";
import type { TFunction } from "i18next";
import {
  MAX_KNOWLEDGE_SCAN_ITEMS,
  MAX_PROMPT_TITLES,
} from "../../utils/knowledgeCardBounds";

const tMock = vi.fn((k: string, d?: unknown) =>
  d && typeof d === "object"
    ? ((d as Record<string, unknown>).defaultValue ?? k)
    : ((d as unknown) ?? k),
) as unknown as TFunction;

const safeStorage = vi.hoisted(() => ({ safeGet: vi.fn(), safeSet: vi.fn() }));
vi.mock("../../store/safeStorage", () => ({
  safeGet: safeStorage.safeGet,
  safeSet: safeStorage.safeSet,
}));

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

const agent = vi.hoisted(() => ({ globalChat: vi.fn() }));
vi.mock("../../services/ai/AgentService", () => ({
  agentService: agent,
}));

const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock("../../utils/logger", () => ({ logger }));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

const t = (k: string, d?: unknown) =>
  d && typeof d === "object"
    ? ((d as Record<string, unknown>).defaultValue ?? k)
    : ((d as unknown) ?? k);

const paths = [
  {
    id: "p1",
    title: "Path A",
    steps: [{ title: "Step 1", description: "Desc 1" }],
  },
];

describe("ReadingPathsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeStorage.safeGet.mockReturnValue(undefined);
    dbMock.initDB.mockResolvedValue(makeDb());
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify(paths),
    });
  });

  const makeDb = () => {
    const find = vi.fn(() => ({
      sort: vi.fn(() => ({
        limit: vi.fn(() => ({
          exec: async () => [{ title: "B1" }, { title: "B2" }],
        })),
      })),
    }));
    return { bookmarks: { find } };
  };

  it("shows the empty state when there are no cached paths", async () => {
    render(<ReadingPathsCard cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("No reading paths yet")).toBeInTheDocument();
    expect(screen.getByText("Generate Reading Paths")).toBeInTheDocument();
  });

  it("renders cached paths loaded from storage", async () => {
    safeStorage.safeGet.mockReturnValue(JSON.stringify(paths));
    render(<ReadingPathsCard cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Path A")).toBeInTheDocument();
    expect(screen.getByText("Step 1")).toBeInTheDocument();
  });

  it("generates reading paths from the AI agent and persists them", async () => {
    render(<ReadingPathsCard cardVariants={{}} t={tMock} />);
    const btn = await screen.findByText("Generate Reading Paths");
    fireEvent.click(btn);
    expect(await screen.findByText("Path A")).toBeInTheDocument();
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(agent.globalChat).toHaveBeenCalled();
    expect(safeStorage.safeSet).toHaveBeenCalled();
  });

  it("bounds both bookmark materialization and prompt titles", async () => {
    const db = makeDb();
    dbMock.initDB.mockResolvedValue(db);
    render(<ReadingPathsCard cardVariants={{}} t={tMock} />);
    fireEvent.click(await screen.findByText("Generate Reading Paths"));
    await screen.findByText("Path A");
    expect(
      db.bookmarks.find.mock.results[0]?.value.sort,
    ).toHaveBeenCalledWith({
      updatedAt: "desc",
    });
    expect(
      db.bookmarks.find.mock.results[0]?.value.sort.mock.results[0]?.value.limit,
    ).toHaveBeenCalledWith(MAX_KNOWLEDGE_SCAN_ITEMS);
    const prompt = agent.globalChat.mock.calls[0]?.[0] as string;
    expect(prompt.split(", ").length).toBeLessThanOrEqual(MAX_PROMPT_TITLES + 1);
  });

  it("logs an error when generation fails", async () => {
    agent.globalChat.mockRejectedValue(new Error("agent down"));
    render(<ReadingPathsCard cardVariants={{}} t={tMock} />);
    const btn = await screen.findByText("Generate Reading Paths");
    fireEvent.click(btn);
    await waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(screen.getByText("No reading paths yet")).toBeInTheDocument();
  });
});
