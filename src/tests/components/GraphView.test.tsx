import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) => options?.defaultValue || key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

const useThemeMock = vi.hoisted(() => ({ isDark: false }));
vi.mock("../../contexts/ThemeContext", () => ({
  useTheme: () => useThemeMock,
}));

const mockInitDB = vi.fn();
vi.mock("../../db/database", () => ({ initDB: mockInitDB }));

const simState = vi.hoisted(() => ({
  tickHandler: null as (() => void) | null,
  sim: null as Record<string, any> | null,
  linkAttrCalls: [] as Array<{ attr: string; value: any }>,
  nodeTransformCalls: [] as string[],
  nodeClickHandler: null as ((d: any) => void) | null,
  nodeTestData: [] as any[],
  linkTestData: [] as any[],
  invokeFnOnNode: null as ((fn: Function) => void) | null,
  clear() {
    this.tickHandler = null;
    this.sim = null;
    this.linkAttrCalls = [];
    this.nodeTransformCalls = [];
    this.nodeClickHandler = null;
    this.nodeTestData = [];
    this.linkTestData = [];
    this.invokeFnOnNode = null;
  },
}));

function invokeNodeFn(fn: Function) {
  const data =
    simState.nodeTestData.length > 0 ? simState.nodeTestData : [{}, {}];
  if (data.every((d: any) => d === undefined)) return;
  for (const d of data) {
    try {
      fn(d, 0);
    } catch {
      /* INTENTIONAL SILENCE: mock data may be incomplete in this fixture. */
    }
  }
}

function invokeLinkFn(fn: Function) {
  const data = simState.linkTestData.length > 0 ? simState.linkTestData : [{}];
  for (const d of data) {
    try {
      fn(d, 0);
    } catch {
      /* INTENTIONAL SILENCE: mock data may be incomplete in this fixture. */
    }
  }
}

function createLinkSelection() {
  const selection = {
    data: vi.fn((data?: any) => {
      if (data && Array.isArray(data)) simState.linkTestData = data;
      return selection;
    }),
    enter: vi.fn(() => ({ append: vi.fn(() => createLinkSelection()) })),
    remove: vi.fn(),
    attr: vi.fn((name: string, value?: any) => {
      simState.linkAttrCalls.push({ attr: name, value });
      if (typeof value === "function") invokeLinkFn(value);
      return selection;
    }),
    style: vi.fn().mockReturnThis(),
    text: vi.fn((value?: any) => {
      if (typeof value === "function") invokeLinkFn(value);
      return selection;
    }),
    call: vi.fn(),
    append: vi.fn(() => createLinkSelection()),
    selectAll: vi.fn(() => createLinkSelection()),
  };
  return selection;
}

function createNodeSelection() {
  const selection = {
    data: vi.fn((data?: any) => {
      if (data && Array.isArray(data)) simState.nodeTestData = data;
      return selection;
    }),
    enter: vi.fn(() => ({ append: vi.fn(() => createNodeSelection()) })),
    remove: vi.fn(),
    attr: vi.fn((name: string, value?: any) => {
      if (name === "transform") {
        simState.nodeTransformCalls.push(
          typeof value === "function" ? value : value,
        );
      }
      if (typeof value === "function") invokeNodeFn(value);
      return selection;
    }),
    style: vi.fn().mockReturnThis(),
    text: vi.fn((value?: any) => {
      if (typeof value === "function") invokeNodeFn(value);
      return selection;
    }),
    call: vi.fn(),
    append: vi.fn(() => createNodeSelection()),
    selectAll: vi.fn(() => createNodeSelection()),
    on: vi.fn((event: string, handler?: any) => {
      if (event === "click") simState.nodeClickHandler = handler;
      return selection;
    }),
  };
  return selection;
}

function createBaseSelection() {
  return {
    data: vi.fn((data?: any) => {
      if (data && Array.isArray(data)) {
        if (data.length > 0 && data[0].source !== undefined) {
          simState.linkTestData = data;
        } else {
          simState.nodeTestData = data;
        }
      }
      return createBaseSelection();
    }),
    enter: vi.fn(() => ({
      append: vi.fn((type: string) =>
        type === "line" ? createLinkSelection() : createNodeSelection(),
      ),
    })),
    remove: vi.fn(),
    attr: vi.fn().mockReturnThis(),
    style: vi.fn().mockReturnThis(),
    text: vi.fn((value?: any) => {
      if (typeof value === "function") invokeNodeFn(value);
      return createBaseSelection();
    }),
    call: vi.fn(),
    on: vi.fn().mockReturnThis(),
    append: vi.fn(() => createBaseSelection()),
    selectAll: vi.fn(() => createBaseSelection()),
  };
}

const mockSelect = vi.fn();
const mockSvg = createBaseSelection();
mockSelect.mockReturnValue(mockSvg);

const mockForceSimulation = vi.hoisted(() =>
  vi.fn(() => {
    const s = {
      force: vi.fn().mockReturnThis(),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === "tick") simState.tickHandler = handler;
      }),
      stop: vi.fn(),
    };
    simState.sim = s;
    return s;
  }),
);

vi.mock("d3-selection", () => ({
  select: (...args: unknown[]) => mockSelect(...args),
}));

vi.mock("d3-zoom", () => ({
  zoom: vi.fn(() => {
    const zoomObj = {
      scaleExtent: vi.fn(() => zoomObj),
      on: vi.fn((_event: string, handler?: any) => {
        if (handler) handler({ transform: "translate(0,0) scale(1)" });
        return zoomObj;
      }),
    };
    return zoomObj;
  }),
}));

vi.mock("d3-force", () => ({
  forceSimulation: mockForceSimulation,
  forceLink: vi.fn(() => ({
    id: vi.fn().mockReturnThis(),
    distance: vi.fn().mockReturnThis(),
  })),
  forceManyBody: vi.fn(() => ({ strength: vi.fn().mockReturnThis() })),
  forceCenter: vi.fn(),
  forceCollide: vi.fn(() => ({ radius: vi.fn().mockReturnThis() })),
}));

vi.mock("lucide-react", () => {
  const Share2 = (props: any) => <svg data-testid="icon-Share2" {...props} />;
  return { Share2 };
});

describe("detectClusters", () => {
  it("preserves duplicate-tag priority while assigning clusters", async () => {
    const { detectClusters } = await import("../../hooks/useGraphSimulation");
    const nodes = [
      {
        id: "a",
        title: "A",
        tags: ["shared", "shared", "alternate"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
      {
        id: "b",
        title: "B",
        tags: ["shared"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
      {
        id: "c",
        title: "C",
        tags: ["alternate"],
        type: "bookmark" as const,
        similarity: 0,
        cluster: -1,
      },
    ];

    expect(detectClusters(nodes as any)).toEqual(["shared", "alternate"]);
    expect(nodes[0]?.cluster).toBe(0);
    expect(nodes[1]?.cluster).toBe(0);
    expect(nodes[2]?.cluster).toBe(1);
  });
});

describe("buildLinksFromTags", () => {
  it("creates links between nodes sharing tags", async () => {
    const { buildLinksFromTags } = await import("../../hooks/useGraphSimulation");
    const nodes = [
      {
        id: "a",
        title: "A",
        tags: ["tag1", "tag2"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
      {
        id: "b",
        title: "B",
        tags: ["tag1"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
      {
        id: "c",
        title: "C",
        tags: ["tag3", "tag4"],
        type: "bookmark" as const,
        similarity: 0,
        cluster: -1,
      },
    ];
    const links = buildLinksFromTags(nodes as any);
    expect(links).toHaveLength(1);
    expect(links[0]!.source).toBe("a");
    expect(links[0]!.target).toBe("b");
    expect(links[0]!.type).toBe("semantic");
  });

  it("calculates link value based on common tag count", async () => {
    const { buildLinksFromTags } = await import("../../hooks/useGraphSimulation");
    const nodes = [
      {
        id: "a",
        title: "A",
        tags: ["t1", "t2", "t3"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
      {
        id: "b",
        title: "B",
        tags: ["t1", "t2"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
    ];
    const links = buildLinksFromTags(nodes as any);
    expect(links).toHaveLength(1);
    expect(links[0]!.value).toBeCloseTo(0.5);
  });

  it("preserves duplicate-tag scoring semantics", async () => {
    const { buildLinksFromTags } = await import("../../hooks/useGraphSimulation");
    const nodes = [
      {
        id: "a",
        title: "A",
        tags: ["t1", "t1"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
      {
        id: "b",
        title: "B",
        tags: ["t1"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
    ];
    const links = buildLinksFromTags(nodes as any);
    expect(links[0]?.value).toBeCloseTo(0.5);
  });

  it("does not let repeated tags change the generated relationships", async () => {
    const { buildLinksFromTags } = await import("../../hooks/useGraphSimulation");
    const baseNodes = [
      {
        id: "a",
        title: "A",
        tags: ["shared", "alpha"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
      {
        id: "b",
        title: "B",
        tags: ["shared", "beta"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
      {
        id: "c",
        title: "C",
        tags: ["alpha", "beta"],
        type: "bookmark" as const,
        similarity: 0,
        cluster: -1,
      },
    ];
    const repeatedNodes = baseNodes.map((node) => ({
      ...node,
      tags: [...node.tags, node.tags[0]!],
    }));

    const repeatedLinks = buildLinksFromTags(repeatedNodes as any);
    const baseLinks = buildLinksFromTags(baseNodes as any);

    expect(repeatedLinks.map(({ source, target }) => ({ source, target }))).toEqual(
      baseLinks.map(({ source, target }) => ({ source, target })),
    );
    // Duplicate tags remain part of the historical score contract; only the
    // candidate-pair generation is deduplicated.
    expect(repeatedLinks.find((link) => link.source === "a" && link.target === "b")?.value)
      .toBeCloseTo(0.5);
  });

  it("returns empty array when no tags overlap", async () => {
    const { buildLinksFromTags } = await import("../../hooks/useGraphSimulation");
    const nodes = [
      {
        id: "a",
        title: "A",
        tags: ["x"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
      {
        id: "b",
        title: "B",
        tags: ["y"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
    ];
    const links = buildLinksFromTags(nodes as any);
    expect(links).toEqual([]);
  });

  it("handles empty nodes array", async () => {
    const { buildLinksFromTags } = await import("../../hooks/useGraphSimulation");
    const links = buildLinksFromTags([]);
    expect(links).toEqual([]);
  });

  it("deduplicates links between same nodes", async () => {
    const { buildLinksFromTags } = await import("../../hooks/useGraphSimulation");
    const nodes = [
      {
        id: "a",
        title: "A",
        tags: ["tag1", "tag2"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
      {
        id: "b",
        title: "B",
        tags: ["tag1", "tag2"],
        type: "doc" as const,
        similarity: 0,
        cluster: -1,
      },
    ];
    const links = buildLinksFromTags(nodes as any);
    expect(links).toHaveLength(1);
  });

  it("caps combinatorial links from a highly popular tag", async () => {
    const { buildLinksFromTags, MAX_GRAPH_LINKS } =
      await import("../../hooks/useGraphSimulation");
    const nodes = Array.from({ length: 1000 }, (_, index) => ({
      id: `node-${index}`,
      title: `Node ${index}`,
      tags: ["popular"],
      type: "doc" as const,
      similarity: 0,
      cluster: -1,
    }));

    const links = buildLinksFromTags(nodes as any);

    expect(links).toHaveLength(MAX_GRAPH_LINKS);
  });
});

describe("GraphView", () => {
  let GraphView: React.FC;

  beforeEach(async () => {
    vi.clearAllMocks();
    useThemeMock.isDark = false;
    simState.nodeTestData = [];
    simState.linkTestData = [];
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    const mod = await import("../../components/GraphView");
    GraphView = mod.default;
  });

  it("renders the title", () => {
    const { unmount } = render(<GraphView />);
    expect(screen.getByText("app_knowledgeGraph")).toBeTruthy();
    unmount();
  });

  it("renders SVG container", () => {
    const { container, unmount } = render(<GraphView />);
    expect(container.querySelector("svg")).toBeTruthy();
    unmount();
  });

  it("renders loading spinner initially", () => {
    const { unmount } = render(<GraphView />);
    expect(document.querySelector(".animate-spin")).toBeTruthy();
    unmount();
  });

  it("handles errors from renderGraph gracefully", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi.fn().mockRejectedValue(new Error("find fail")),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(document.querySelector(".animate-spin")).toBeFalsy();
    });
  });

  it("handles errors from initDB gracefully", async () => {
    mockInitDB.mockRejectedValue(new Error("DB fail"));
    render(<GraphView />);
    await waitFor(() => {
      expect(document.querySelector(".animate-spin")).toBeFalsy();
    });
  });

  it("renders node and link stats", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([
            { id: "d1", title: "Doc1", tags: ["tag1"] },
            { id: "d2", title: "Doc2", tags: [] },
          ]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    render(<GraphView />);
    await waitFor(
      () => {
        expect(screen.getByText(/: 2/)).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });

  it("removes loading spinner after data loads", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(document.querySelector(".animate-spin")).toBeFalsy();
    });
  });

  it("includes bookmarks in stats", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
      bookmarks: {
        find: vi.fn(() => ({
          exec: vi
            .fn()
            .mockResolvedValue([{ id: "b1", title: "BM1", tags: ["tag1"] }]),
        })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText(/: 1/)).toBeTruthy();
    });
  });

  it("handles documents with null tags", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi
            .fn()
            .mockResolvedValue([{ id: "d1", title: "Doc1", tags: null }]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText(/: 1/)).toBeTruthy();
    });
  });

  it("handles bookmarks with null title and null tags", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
      bookmarks: {
        find: vi.fn(() => ({
          exec: vi
            .fn()
            .mockResolvedValue([{ id: "b1", title: null, tags: null }]),
        })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText(/: 1/)).toBeTruthy();
    });
  });

  it("stops simulation on unmount", async () => {
    const mockStop = vi.fn();
    mockForceSimulation.mockReturnValueOnce({
      force: vi.fn().mockReturnThis(),
      on: vi.fn(),
      stop: mockStop,
    });
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    const { unmount } = render(<GraphView />);
    await waitFor(() => {
      expect(document.querySelector(".animate-spin")).toBeFalsy();
    });
    unmount();
    expect(mockStop).toHaveBeenCalled();
    expect(mockSvg.on).toHaveBeenCalledWith(".zoom", null);
  });

  it("fires tick handler updates node and link positions", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi
            .fn()
            .mockResolvedValue([{ id: "d1", title: "Doc1", tags: ["tag1"] }]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText(/: 1/)).toBeTruthy();
    });
    expect(simState.tickHandler).toBeTruthy();
    simState.tickHandler!();
  });

  it("tick handler updates link x1, y1, x2, y2 attributes", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([
            { id: "d1", title: "Doc1", tags: ["tag1"] },
            { id: "d2", title: "Doc2", tags: ["tag1"] },
          ]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText(/: 2/)).toBeTruthy();
    });
    expect(simState.tickHandler).toBeTruthy();

    simState.linkAttrCalls = [];
    simState.tickHandler!();

    expect(simState.linkAttrCalls.some((c) => c.attr === "x1")).toBe(true);
    expect(simState.linkAttrCalls.some((c) => c.attr === "y1")).toBe(true);
    expect(simState.linkAttrCalls.some((c) => c.attr === "x2")).toBe(true);
    expect(simState.linkAttrCalls.some((c) => c.attr === "y2")).toBe(true);
  });

  it("tick handler updates nodeGroup transform attribute", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi
            .fn()
            .mockResolvedValue([{ id: "d1", title: "Doc1", tags: ["tag1"] }]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText(/: 1/)).toBeTruthy();
    });
    expect(simState.tickHandler).toBeTruthy();

    simState.nodeTransformCalls = [];
    simState.tickHandler!();

    expect(simState.nodeTransformCalls.length).toBeGreaterThan(0);
    // D3 passes a function for transform: d => `translate(${d.x},${d.y})`
    const transformArg = simState.nodeTransformCalls[0];
    expect(typeof transformArg).toBe("function");
    const result = (transformArg as any)({ x: 100, y: 200 });
    expect(result).toMatch(/^translate\(100,200\)$/);
  });

  it("handles tick with multiple nodes and links", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([
            { id: "d1", title: "Doc1", tags: ["tag1", "tag2"] },
            { id: "d2", title: "Doc2", tags: ["tag1"] },
            { id: "d3", title: "Doc3", tags: ["tag2", "tag3"] },
          ]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({
          exec: vi
            .fn()
            .mockResolvedValue([{ id: "b1", title: "BM1", tags: ["tag1"] }]),
        })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText(/: 4/)).toBeTruthy();
    });
    expect(simState.tickHandler).toBeTruthy();

    simState.linkAttrCalls = [];
    simState.nodeTransformCalls = [];
    simState.tickHandler!();

    expect(simState.linkAttrCalls.length).toBeGreaterThan(0);
    expect(simState.nodeTransformCalls.length).toBeGreaterThan(0);
  });

  it("zoom behavior is initialized", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi
            .fn()
            .mockResolvedValue([{ id: "d1", title: "Doc1", tags: ["tag1"] }]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    const { container } = render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText(/: 1/)).toBeTruthy();
    });
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("calls onNodeClick when a node is clicked", async () => {
    const onNodeClick = vi.fn();
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi
            .fn()
            .mockResolvedValue([{ id: "d1", title: "Doc1", tags: ["tag1"] }]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    render(<GraphView {...({ onNodeClick } as any)} />);
    await waitFor(() => {
      expect(screen.getByText(/: 1/)).toBeTruthy();
    });
    expect(simState.nodeClickHandler).toBeTruthy();
    (simState.nodeClickHandler as any)!({} as any, { type: "doc", id: "d1" });
    expect(onNodeClick).toHaveBeenCalledWith("doc", "d1");
  });

  it("filters nodes by search query", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([
            { id: "d1", title: "TypeScript Guide", tags: ["ts"] },
            { id: "d2", title: "Rust Guide", tags: ["rust"] },
          ]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText(/: 2/)).toBeTruthy();
    });
    const input = screen.getByRole("textbox");
    await act(async () => {
      await userEvent.type(input, "Rust");
    });
    await waitFor(
      () => {
        expect(screen.getByText(/: 1/)).toBeTruthy();
      },
      { timeout: 5000 },
    );
  }, 30000);

  it("shows cluster labels when nodes share tags", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([
            { id: "d1", title: "Doc1", tags: ["tag1"] },
            { id: "d2", title: "Doc2", tags: ["tag1"] },
          ]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText("tag1")).toBeTruthy();
    });
  });

  it("sets up subscriptions when db has $ observable", async () => {
    const subDoc = vi.fn();
    const subBm = vi.fn();
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        $: { subscribe: subDoc },
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        $: { subscribe: subBm },
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(document.querySelector(".animate-spin")).toBeFalsy();
    });
    expect(subDoc).toHaveBeenCalled();
    expect(subBm).toHaveBeenCalled();
  });

  it("handles unsubscribe errors gracefully", async () => {
    const unsub = vi.fn(() => {
      throw new Error("unsub fail");
    });
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        $: { subscribe: vi.fn(() => ({ unsubscribe: unsub })) },
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        $: { subscribe: vi.fn(() => ({ unsubscribe: unsub })) },
      },
    });
    const { unmount } = render(<GraphView />);
    await waitFor(() => {
      expect(document.querySelector(".animate-spin")).toBeFalsy();
    });
    expect(() => unmount()).not.toThrow();
    expect(unsub).toHaveBeenCalled();
  });

  it("coalesces bursts of database changes into one graph refresh", async () => {
    let onDocumentChange: (() => void) | undefined;
    const documentFind = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([]),
    }));
    const documentSubscribe = vi.fn((callback: () => void) => {
      onDocumentChange = callback;
      return { unsubscribe: vi.fn() };
    });
    mockInitDB.mockResolvedValue({
      documents: {
        find: documentFind,
        $: { subscribe: documentSubscribe },
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });

    const { unmount } = render(<GraphView />);
    await waitFor(() => {
      expect(documentSubscribe).toHaveBeenCalled();
      expect(documentFind).toHaveBeenCalledTimes(1);
    });

    onDocumentChange!();
    onDocumentChange!();
    onDocumentChange!();

    await waitFor(
      () => {
        expect(documentFind).toHaveBeenCalledTimes(2);
      },
      { timeout: 1000 },
    );
    unmount();
  });

  it("handles cancelled state when unmounted before initDB resolves", async () => {
    let resolveInit: (val: any) => void;
    const deferred = new Promise((resolve) => {
      resolveInit = resolve;
    });
    mockInitDB.mockReturnValue(deferred);
    const { unmount } = render(<GraphView />);
    unmount();
    resolveInit!({
      documents: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockInitDB).toHaveBeenCalled();
  });

  it("handles subscription callback firing after unmount", async () => {
    const subDocFn = vi.fn();
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        $: { subscribe: subDocFn },
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        $: { subscribe: vi.fn() },
      },
    });
    const { unmount } = render(<GraphView />);
    await waitFor(() => {
      expect(subDocFn).toHaveBeenCalled();
    });
    unmount();
  });

  it("handles null title in document", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi
            .fn()
            .mockResolvedValue([{ id: "d1", title: null, tags: ["tag1"] }]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText(/: 1/)).toBeTruthy();
    });
  });

  it("handles isDark theme correctly", async () => {
    useThemeMock.isDark = true;
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi
            .fn()
            .mockResolvedValue([{ id: "d1", title: "Test", tags: ["tag1"] }]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText(/: 1/)).toBeTruthy();
    });
    useThemeMock.isDark = false;
  });

  it("handles node fill color branches", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([
            { id: "d1", title: "Doc1", tags: ["tag1", "tag2"] },
            { id: "d2", title: "Doc2", tags: ["tag1"] },
            { id: "d3", title: "Doc3", tags: ["tag3"] },
          ]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([
            { id: "b1", title: "BM1", tags: ["tag1"] },
            { id: "b2", title: "BM2", tags: ["tag3"] },
          ]),
        })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText(/: 5/)).toBeTruthy();
    });
  });

  it("handles nodes without cluster assignment", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([
            { id: "d1", title: "Doc1", tags: ["tagA"] },
            { id: "d2", title: "Doc2", tags: ["tagB"] },
          ]),
        })),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
    });
    render(<GraphView />);
    await waitFor(() => {
      expect(screen.getByText(/: 2/)).toBeTruthy();
    });
  });
});
