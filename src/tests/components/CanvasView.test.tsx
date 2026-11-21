import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (s: string, opts?: any) => opts?.defaultValue || s,
  }),
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    FileText: mock("FileText"),
    Bookmark: mock("Bookmark"),
    Plus: mock("Plus"),
    Trash2: mock("Trash2"),
  };
});

const mockToast = { error: vi.fn() };
vi.mock("sonner", () => ({ toast: mockToast }));

const mockSetNodes = vi.fn();
const mockSetEdges = vi.fn();
const mockHasNodes = vi.hoisted(() => ({ value: false }));
let internalNodes: any[] = [];

const mockOnConnect = vi.fn();

vi.mock("@xyflow/react", () => {
  const DocumentNode = ({ data }: any) => (
    <div data-testid="document-node" data-label={data.label}>
      <div data-testid="doc-handle-target" />
      <svg data-testid="icon-FileText" />
      <span>{data.label}</span>
      <div data-testid="doc-handle-source" />
    </div>
  );
  const BookmarkNode = ({ data }: any) => (
    <div data-testid="bookmark-node" data-label={data.label}>
      <div data-testid="bm-handle-target" />
      <svg data-testid="icon-Bookmark" />
      <span>{data.label}</span>
      <div data-testid="bm-handle-source" />
    </div>
  );

  const nodeTypes = { document: DocumentNode, bookmark: BookmarkNode };

  return {
    ReactFlow: ({
      children,
      nodes,
      onConnect,
      nodeTypes: receivedNodeTypes,
    }: any) => (
      <div data-testid="react-flow" data-nodes={nodes?.length}>
        {children}
        {receivedNodeTypes && (
          <div data-testid="node-types-provided">
            <span data-testid="doc-type">
              {typeof receivedNodeTypes.document}
            </span>
            <span data-testid="bm-type">
              {typeof receivedNodeTypes.bookmark}
            </span>
          </div>
        )}
        <div
          data-testid="on-connect-received"
          data-onconnect={typeof onConnect}
        />
      </div>
    ),
    MiniMap: ({ nodeStrokeColor, nodeColor, className }: any) => {
      const testDocNode = { type: "document" };
      const testBmNode = { type: "bookmark" };
      const testOtherNode = { type: "other" };
      return (
        <div
          data-testid="mini-map"
          data-stroke-doc={nodeStrokeColor?.(testDocNode)}
          data-stroke-bm={nodeStrokeColor?.(testBmNode)}
          data-stroke-other={nodeStrokeColor?.(testOtherNode)}
          data-color-doc={nodeColor?.(testDocNode)}
          data-color-bm={nodeColor?.(testBmNode)}
          data-color-other={nodeColor?.(testOtherNode)}
          className={className}
        />
      );
    },
    Controls: () => <div data-testid="controls" />,
    Background: () => <div data-testid="background" />,
    Panel: ({ children, position }: any) => (
      <div data-testid={`panel-${position}`}>{children}</div>
    ),
    Handle: () => <div data-testid="handle" />,
    Position: { Top: "top", Bottom: "bottom" },
    useNodesState: (initial: any) => {
      internalNodes = mockHasNodes.value
        ? [
            {
              id: "doc-1",
              type: "document",
              position: { x: 0, y: 0 },
              data: { label: "Doc 1" },
            },
            {
              id: "bm-1",
              type: "bookmark",
              position: { x: 100, y: 100 },
              data: { label: "BM 1" },
            },
          ]
        : [...initial];
      mockSetNodes.mockImplementation((updater: any) => {
        if (typeof updater === "function") {
          internalNodes = updater(internalNodes);
        } else {
          internalNodes = updater;
        }
      });
      return [internalNodes, mockSetNodes, vi.fn()];
    },
    useEdgesState: (initial: any) => {
      let internalEdges = [...initial];
      mockSetEdges.mockImplementation((updater: any) => {
        if (typeof updater === "function") {
          internalEdges = updater(internalEdges);
        } else {
          internalEdges = updater;
        }
      });
      return [internalEdges, mockSetEdges, vi.fn()];
    },
    addEdge: (params: any, edges: any[]) => {
      mockOnConnect(params);
      return [
        ...edges,
        { ...params, id: `edge-${Date.now()}`, animated: true },
      ];
    },
    getConnectedEdges: () => [],
    getOutgoers: () => [],
    getIncomers: () => [],
    getNodePosition: () => ({ x: 0, y: 0 }),
    nodeTypes,
  };
});

const mockUseRxQuery = vi.hoisted(() =>
  vi.fn().mockReturnValue({ result: [] }),
);

vi.mock("../../hooks/useRxDB", () => ({
  useRxCollection: vi.fn(() => ({ find: () => ({}) })),
  useRxQuery: mockUseRxQuery,
}));

describe("CanvasView", () => {
  let CanvasView: React.FC;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockHasNodes.value = false;
    internalNodes = [];
    mockSetNodes.mockClear();
    mockSetEdges.mockClear();
    mockOnConnect.mockClear();
    const mod = await import("../../components/CanvasView");
    CanvasView = mod.CanvasView;
  });

  it("renders ReactFlow", () => {
    render(<CanvasView />);
    expect(screen.getByTestId("react-flow")).toBeTruthy();
  });

  it("shows empty state when there are no nodes", () => {
    render(<CanvasView />);
    expect(screen.getByText("Empty Canvas")).toBeTruthy();
  });

  it("has Add Doc button", () => {
    render(<CanvasView />);
    expect(screen.getByText("Add Doc")).toBeTruthy();
  });

  it("has Add Bookmark button", () => {
    render(<CanvasView />);
    expect(screen.getByText("Add Bookmark")).toBeTruthy();
  });

  it("has Clear button", () => {
    render(<CanvasView />);
    expect(screen.getByText("Clear")).toBeTruthy();
  });

  it("shows toast when there are no docs and Add Doc is clicked", async () => {
    render(<CanvasView />);
    await userEvent.click(screen.getByText("Add Doc"));
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("shows toast when there are no bookmarks and Add Bookmark is clicked", async () => {
    render(<CanvasView />);
    await userEvent.click(screen.getByText("Add Bookmark"));
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("renders Background", () => {
    render(<CanvasView />);
    expect(screen.getByTestId("background")).toBeTruthy();
  });

  it("renders Panel at top-left", () => {
    render(<CanvasView />);
    expect(screen.getByTestId("panel-top-left")).toBeTruthy();
  });

  it("does not render Controls or MiniMap when there are no nodes", () => {
    render(<CanvasView />);
    expect(screen.queryByTestId("controls")).toBeNull();
    expect(screen.queryByTestId("mini-map")).toBeNull();
  });

  it("does not call toast.error when there are documents and Add Doc is clicked", async () => {
    const mockDoc = {
      id: "doc-1",
      title: "Test Doc",
      toJSON: () => ({ id: "doc-1", title: "Test Doc" }),
    };
    mockUseRxQuery.mockReturnValue({ result: [mockDoc] } as any as any);
    render(<CanvasView />);
    mockToast.error.mockClear();
    await userEvent.click(screen.getByText("Add Doc"));
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("does not call toast.error when there are bookmarks and Add Bookmark is clicked", async () => {
    const mockBM = {
      id: "bm-1",
      title: "Test BM",
      toJSON: () => ({ id: "bm-1", title: "Test BM" }),
    };
    mockUseRxQuery.mockReturnValue({ result: [mockBM] } as any as any);
    render(<CanvasView />);
    mockToast.error.mockClear();
    await userEvent.click(screen.getByText("Add Bookmark"));
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("adds a document node when Add Doc is clicked with docs available", async () => {
    const mockDoc = {
      id: "doc-1",
      title: "Test Doc",
      toJSON: () => ({ id: "doc-1", title: "Test Doc" }),
    };
    mockUseRxQuery.mockReturnValue({ result: [mockDoc] } as any as any);
    render(<CanvasView />);
    await userEvent.click(screen.getByText("Add Doc"));
    expect(mockSetNodes).toHaveBeenCalled();
  });

  it("adds a bookmark node when Add Bookmark is clicked with bookmarks available", async () => {
    const mockBM = {
      id: "bm-1",
      title: "Test BM",
      toJSON: () => ({ id: "bm-1", title: "Test BM" }),
    };
    mockUseRxQuery.mockReturnValue({ result: [mockBM] } as any as any);
    render(<CanvasView />);
    await userEvent.click(screen.getByText("Add Bookmark"));
    expect(mockSetNodes).toHaveBeenCalled();
  });

  it("shows Controls and MiniMap when there are nodes in the canvas", () => {
    mockHasNodes.value = true;
    render(<CanvasView />);
    expect(screen.getByTestId("controls")).toBeTruthy();
    expect(screen.getByTestId("mini-map")).toBeTruthy();
  });

  it("MiniMap receives nodeStrokeColor and nodeColor callbacks with correct colors", () => {
    mockHasNodes.value = true;
    render(<CanvasView />);
    const miniMap = screen.getByTestId("mini-map");
    expect(miniMap.dataset.strokeDoc).toBe("#6366f1");
    expect(miniMap.dataset.strokeBm).toBe("#10b981");
    expect(miniMap.dataset.strokeOther).toBe("#eee");
    expect(miniMap.dataset.colorDoc).toBe("#e0e7ff");
    expect(miniMap.dataset.colorBm).toBe("#d1fae5");
    expect(miniMap.dataset.colorOther).toBe("#fff");
  });

  it("clears the canvas with Clear", async () => {
    const mockDoc = {
      id: "doc-1",
      title: "Test Doc",
      toJSON: () => ({ id: "doc-1", title: "Test Doc" }),
    };
    mockUseRxQuery.mockReturnValue({ result: [mockDoc] } as any as any);
    render(<CanvasView />);
    await userEvent.click(screen.getByText("Add Doc"));
    expect(mockSetNodes).toHaveBeenCalled();
    mockSetNodes.mockClear();
    await userEvent.click(screen.getByText("Clear"));
    expect(mockSetNodes).toHaveBeenCalledWith([]);
    expect(mockSetEdges).toHaveBeenCalledWith([]);
  });

  it("pasa nodeTypes a ReactFlow (DocumentNode y BookmarkNode)", () => {
    render(<CanvasView />);
    expect(screen.getByTestId("doc-type").textContent).toBe("function");
    expect(screen.getByTestId("bm-type").textContent).toBe("function");
  });

  it("onConnect callback is passed to ReactFlow", () => {
    render(<CanvasView />);
    const onConnectReceived = screen.getByTestId("on-connect-received");
    expect(onConnectReceived.dataset.onconnect).toBe("function");
  });

  it("setNodes uses a functional updater when adding nodes", async () => {
    const mockDoc = {
      id: "doc-1",
      title: "Test Doc",
      toJSON: () => ({ id: "doc-1", title: "Test Doc" }),
    };
    mockUseRxQuery.mockReturnValue({ result: [mockDoc] } as any as any);
    render(<CanvasView />);
    await userEvent.click(screen.getByText("Add Doc"));
    const callArgs = mockSetNodes.mock.calls[0]![0];
    expect(typeof callArgs).toBe("function");
  });

  it("addBookmarkNode uses a functional updater", async () => {
    const mockBM = {
      id: "bm-1",
      title: "Test BM",
      toJSON: () => ({ id: "bm-1", title: "Test BM" }),
    };
    mockUseRxQuery.mockReturnValue({ result: [mockBM] } as any as any);
    render(<CanvasView />);
    await userEvent.click(screen.getByText("Add Bookmark"));
    const callArgs = mockSetNodes.mock.calls[0]![0];
    expect(typeof callArgs).toBe("function");
  });

  it("getNodeStrokeColor returns correct colors", () => {
    mockHasNodes.value = true;
    render(<CanvasView />);
    const miniMap = screen.getByTestId("mini-map");
    expect(miniMap.dataset.strokeDoc).toBe("#6366f1");
    expect(miniMap.dataset.strokeBm).toBe("#10b981");
    expect(miniMap.dataset.strokeOther).toBe("#eee");
  });

  it("getNodeColor returns correct colors", () => {
    mockHasNodes.value = true;
    render(<CanvasView />);
    const miniMap = screen.getByTestId("mini-map");
    expect(miniMap.dataset.colorDoc).toBe("#e0e7ff");
    expect(miniMap.dataset.colorBm).toBe("#d1fae5");
    expect(miniMap.dataset.colorOther).toBe("#fff");
  });
});
