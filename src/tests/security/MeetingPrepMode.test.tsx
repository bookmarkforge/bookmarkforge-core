import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { MeetingPrepMode } from "../../components/knowledge/MeetingPrepMode";
import { logger } from "../../utils/logger";
import type { TFunction } from "i18next";
import { MAX_KNOWLEDGE_SCAN_ITEMS } from "../../utils/knowledgeCardBounds";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const tMock = vi.fn((k: string, d?: unknown) =>
  d && typeof d === "object"
    ? ((d as Record<string, unknown>).defaultValue ?? k)
    : ((d as unknown) ?? k),
) as unknown as TFunction;

const safeStorage = vi.hoisted(() => ({ safeGet: vi.fn(), safeSet: vi.fn() }));
vi.mock("../../store/safeStorage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../store/safeStorage")>();
  return {
    ...actual,
    safeGet: safeStorage.safeGet,
    safeSet: safeStorage.safeSet,
  };
});

const dbMock = vi.hoisted(() => ({ initDB: vi.fn() }));
vi.mock("../../db/database", () => ({ initDB: dbMock.initDB }));

const agent = vi.hoisted(() => ({ globalChat: vi.fn() }));
vi.mock("../../services/ai/AgentService", () => ({ agentService: agent }));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

const t = (k: string, d?: unknown) =>
  d && typeof d === "object"
    ? ((d as Record<string, unknown>).defaultValue ?? k)
    : ((d as unknown) ?? k);

const makeDb = (rows: unknown[]) => {
  const find = vi.fn(() => ({
    sort: vi.fn(() => ({
      limit: vi.fn(() => ({ exec: async () => rows })),
    })),
  }));
  return { bookmarks: { find } };
};

describe("MeetingPrepMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeStorage.safeGet.mockReturnValue(undefined);
    dbMock.initDB.mockResolvedValue(makeDb([]));
  });

  it("renders the title with a disabled generate button when empty", async () => {
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Meeting Prep Mode")).toBeInTheDocument();
    expect(screen.getByLabelText("Meeting topic")).toBeInTheDocument();
    expect(screen.getByText("Generate Briefing")).toBeDisabled();
  });

  it("loads recent topics from storage", async () => {
    safeStorage.safeGet.mockReturnValue(JSON.stringify(["Old Topic"]));
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    expect(await screen.findByText("Old Topic")).toBeInTheDocument();
  });

  it("generates a briefing via AI", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([{ id: "1", title: "ML Book", tags: ["ml"], visitCount: 3 }]),
    );
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify({
        topic: "Q3 ML",
        keyPoints: ["kp1", "kp2"],
        relevantBookmarks: ["ML Book"],
        talkingPoints: ["tp1"],
        questionsToAsk: ["q1"],
        summary: "A concise summary.",
      }),
    });
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    fireEvent.change(await screen.findByLabelText("Meeting topic"), {
      target: { value: "Q3 ML" },
    });
    fireEvent.click(screen.getByText("Generate Briefing"));
    expect(await screen.findByText("A concise summary.")).toBeInTheDocument();
    expect(screen.getByText(/kp1/)).toBeInTheDocument();
    expect(screen.getAllByText("Q3 ML").length).toBeGreaterThan(0);
    expect(safeStorage.safeSet).toHaveBeenCalledWith(
      "bookmarkforge_briefing_Q3 ML",
      expect.any(String),
    );
  });

  it("does not generate with an empty topic", async () => {
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    fireEvent.click(screen.getByText("Generate Briefing"));
    expect(agent.globalChat).not.toHaveBeenCalled();
  });

  it("limits the bookmark materialized for a briefing", async () => {
    const db = makeDb([{ id: "1", title: "ML Book", visitCount: 3 }]);
    dbMock.initDB.mockResolvedValue(db);
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify({
        topic: "Bounded",
        keyPoints: [],
        relevantBookmarks: [],
        talkingPoints: [],
        questionsToAsk: [],
        summary: "Bounded summary.",
      }),
    });
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    fireEvent.change(await screen.findByLabelText("Meeting topic"), {
      target: { value: "Bounded" },
    });
    fireEvent.click(screen.getByText("Generate Briefing"));
    await screen.findByText("Bounded summary.");
    expect(db.bookmarks.find).toHaveBeenCalledWith({
      selector: { isDeleted: false, isPrivate: false },
    });
    expect(db.bookmarks.find.mock.results[0]?.value.sort).toHaveBeenCalledWith({
      updatedAt: "desc",
    });
    expect(
      db.bookmarks.find.mock.results[0]?.value.sort.mock.results[0]?.value.limit,
    ).toHaveBeenCalledWith(MAX_KNOWLEDGE_SCAN_ITEMS);
  });

  it("handles generation failure gracefully", async () => {
    agent.globalChat.mockRejectedValue(new Error("ai down"));
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    fireEvent.change(await screen.findByLabelText("Meeting topic"), {
      target: { value: "Q3 ML" },
    });
    fireEvent.click(screen.getByText("Generate Briefing"));
    await waitFor(() => expect(agent.globalChat).toHaveBeenCalled());
    expect(screen.getByText("Meeting Prep Mode")).toBeInTheDocument();
    expect(screen.queryByText("A concise summary.")).not.toBeInTheDocument();
  });

  it("triggers generate on Enter key in the topic input", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([{ id: "1", title: "Test", tags: [], visitCount: 1 }]),
    );
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify({
        topic: "Enter Test",
        keyPoints: ["kp"],
        relevantBookmarks: ["Test"],
        talkingPoints: ["tp"],
        questionsToAsk: ["q"],
        summary: "Enter summary.",
      }),
    });
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    const input = await screen.findByLabelText("Meeting topic");
    fireEvent.change(input, { target: { value: "Enter Test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Enter summary.")).toBeInTheDocument();
  });

  it("downloads the briefing as a text file", async () => {
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    agent.globalChat.mockResolvedValue({
      text: JSON.stringify({
        topic: "Download Test",
        keyPoints: ["kp1"],
        relevantBookmarks: ["Test"],
        talkingPoints: ["tp1"],
        questionsToAsk: ["q1"],
        summary: "Download summary.",
      }),
    });
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    fireEvent.change(await screen.findByLabelText("Meeting topic"), {
      target: { value: "Download Test" },
    });
    fireEvent.click(screen.getByText("Generate Briefing"));
    expect(await screen.findByText("Download summary.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Download Briefing"));
    expect(createObjectURL).toHaveBeenCalled();
    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    });
  });

  it("handles invalid JSON in recent topics storage", async () => {
    safeStorage.safeGet.mockReturnValue("not-json");
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    await screen.findByText("Meeting Prep Mode");
    // Should not crash, and no recent topics should be shown
    expect(screen.queryByText("not-json")).not.toBeInTheDocument();
  });

  it("ignores non-array parsed recent topics", async () => {
    safeStorage.safeGet.mockReturnValue(JSON.stringify({ topic: "Obj" }));
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    await screen.findByText("Meeting Prep Mode");
    expect(screen.queryByText("Obj")).not.toBeInTheDocument();
  });

  it("sets topic when clicking a recent topic", async () => {
    safeStorage.safeGet.mockReturnValue(JSON.stringify(["Q3 ML"]));
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    const chip = await screen.findByText("Q3 ML");
    fireEvent.click(chip);
    const input = screen.getByLabelText("Meeting topic") as HTMLInputElement;
    expect(input.value).toBe("Q3 ML");
  });

  it("persists deduplicated recent topics limited to 5", async () => {
    safeStorage.safeGet.mockReturnValue(JSON.stringify(["Old Topic"]));
    dbMock.initDB.mockResolvedValue(makeDb([]));
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify({
        topic: "Q3 ML",
        keyPoints: ["kp"],
        relevantBookmarks: [],
        talkingPoints: [],
        questionsToAsk: [],
        summary: "s",
      }),
    });
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    await screen.findByText("Old Topic");
    fireEvent.change(screen.getByLabelText("Meeting topic"), {
      target: { value: "Q3 ML" },
    });
    fireEvent.click(screen.getByText("Generate Briefing"));
    await waitFor(() => {
      expect(safeStorage.safeSet).toHaveBeenCalledWith(
        "bookmarkforge_recent_topics",
        JSON.stringify(["Q3 ML", "Old Topic"]),
      );
    });
  });

  it("shows Generating state while the agent responds", async () => {
    let resolveChat: (v: unknown) => void;
    agent.globalChat.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveChat = resolve;
        }),
    );
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    fireEvent.change(await screen.findByLabelText("Meeting topic"), {
      target: { value: "Q3 ML" },
    });
    fireEvent.click(screen.getByText("Generate Briefing"));
    expect(await screen.findByText("Generating...")).toBeInTheDocument();
    resolveChat!({
      text: JSON.stringify({
        topic: "Q3 ML",
        keyPoints: [],
        relevantBookmarks: [],
        talkingPoints: [],
        questionsToAsk: [],
        summary: "done",
      }),
    });
    expect(await screen.findByText("done")).toBeInTheDocument();
  });

  it("logs error when the agent returns invalid JSON", async () => {
    dbMock.initDB.mockResolvedValue(makeDb([]));
    agent.globalChat.mockResolvedValue({ text: "not-json" });
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    fireEvent.change(await screen.findByLabelText("Meeting topic"), {
      target: { value: "Q3 ML" },
    });
    fireEvent.click(screen.getByText("Generate Briefing"));
    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        "[MeetingPrepMode] generate failed",
        expect.any(Error),
      );
    });
  });

  it("logs error when initDB fails during generate", async () => {
    dbMock.initDB.mockRejectedValueOnce(new Error("db down"));
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    fireEvent.change(await screen.findByLabelText("Meeting topic"), {
      target: { value: "Q3 ML" },
    });
    fireEvent.click(screen.getByText("Generate Briefing"));
    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        "[MeetingPrepMode] generate failed",
        expect.any(Error),
      );
    });
  });

  it("supports bookmarks without visitCount or tags in the source material", async () => {
    dbMock.initDB.mockResolvedValue(
      makeDb([
        { id: "1", title: "With Meta", tags: ["ml"], visitCount: 3 },
        { id: "2", title: "No Meta", tags: undefined, visitCount: undefined },
      ]),
    );
    agent.globalChat.mockResolvedValue({
      text: JSON.stringify({
        topic: "Q3 ML",
        keyPoints: ["kp"],
        relevantBookmarks: [],
        talkingPoints: [],
        questionsToAsk: [],
        summary: "Meta handled.",
      }),
    });
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    fireEvent.change(await screen.findByLabelText("Meeting topic"), {
      target: { value: "Q3 ML" },
    });
    fireEvent.click(screen.getByText("Generate Briefing"));
    // No crash: (b.visitCount || 0) y (b.tags || []) manejan campos ausentes
    expect(await screen.findByText("Meta handled.")).toBeInTheDocument();
  });

  it("the download is ignored without a briefing", async () => {
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    safeStorage.safeGet.mockReturnValue(JSON.stringify(["Old Topic"]));
    render(<MeetingPrepMode cardVariants={{}} t={tMock} />);
    await screen.findByText("Old Topic");
    // Without a briefing the download button does not exist and there is no blob
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
