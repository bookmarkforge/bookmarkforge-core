import { useCallback } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  Panel,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRxCollection, useRxQuery } from "../hooks/useRxDB";
import { FileText, Bookmark as BookmarkIcon, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Document, Bookmark as BookmarkType } from "../types";

// Custom Node for Documents
const DocumentNode = ({ data }: { data: { label: string; id?: string } }) => {
  return (
    <div className="px-4 py-2 shadow-md rounded-md bg-white dark:bg-[var(--bg-card)] border-2 border-cyan-500 min-w-[clamp(140px,45vw,220px)]">
      <Handle
        type="target"
        position={Position.Top}
        className="w-16 !bg-cyan-500"
      />
      <div className="flex items-center gap-2">
        <FileText className="size-4 text-cyan-500" />
        <div className="font-bold text-sm text-[var(--text-primary)] dark:text-[var(--text-accent)] truncate max-w-[200px]">
          {data.label}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-16 !bg-cyan-500"
      />
    </div>
  );
};

// Custom Node for Bookmarks
const BookmarkNode = ({ data }: { data: { label: string; id?: string } }) => {
  return (
    <div className="px-4 py-2 shadow-md rounded-md bg-white dark:bg-[var(--bg-card)] border-2 border-[var(--success-soft-border)] min-w-[clamp(140px,45vw,220px)]">
      <Handle
        type="target"
        position={Position.Top}
        className="w-16 !ds-bg-success"
      />
      <div className="flex items-center gap-2">
        <BookmarkIcon className="size-4 ds-text-success" />
        <div className="font-bold text-sm text-[var(--text-primary)] dark:text-[var(--text-accent)] truncate max-w-[200px]">
          {data.label}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-16 !ds-bg-success"
      />
    </div>
  );
};

const nodeTypes = {
  document: DocumentNode,
  bookmark: BookmarkNode,
};

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

export const CanvasView = () => {
  const { t } = useTranslation();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const docsCollection = useRxCollection("documents");
  const bookmarksCollection = useRxCollection("bookmarks");

  const { result: docs = [] } = useRxQuery(docsCollection?.find());
  const { result: bookmarks = [] } = useRxQuery(bookmarksCollection?.find());

  const onConnect = useCallback(
    (params: Connection | Edge) =>
      setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges],
  );

  const addDocumentNode = () => {
    if (docs.length === 0) {
      toast.error(t("app_noDocuments", { defaultValue: "No documents found" }));
      return;
    }
    const doc = docs[Math.floor(Math.random() * docs.length)]?.toJSON() as
      Document | undefined;
    const newNode: Node = {
      id: `doc-${Date.now()}`,
      type: "document",
      position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
      data: { label: doc?.title ?? "Untitled", id: doc?.id ?? "" },
    };
    setNodes((nds) => nds.concat(newNode));
  };

  const addBookmarkNode = () => {
    if (bookmarks.length === 0) {
      toast.error(t("app_noBookmarks", { defaultValue: "No bookmarks found" }));
      return;
    }
    const bookmark = bookmarks[
      Math.floor(Math.random() * bookmarks.length)
    ]?.toJSON() as BookmarkType | undefined;
    const newNode: Node = {
      id: `bm-${Date.now()}`,
      type: "bookmark",
      position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
      data: { label: bookmark?.title ?? "Untitled", id: bookmark?.id ?? "" },
    };
    setNodes((nds) => nds.concat(newNode));
  };

  const clearCanvas = () => {
    setNodes([]);
    setEdges([]);
  };

  const getNodeStrokeColor = (n: Node) => {
    if (n.type === "document") {return "#6366f1";}
    if (n.type === "bookmark") {return "#10b981";} // intentional inline — categorical data-viz palette, not brand
    return "#eee";
  };

  const getNodeColor = (n: Node) => {
    if (n.type === "document") {return "#e0e7ff";}
    if (n.type === "bookmark") {return "#d1fae5";}
    return "#fff";
  };

  return (
    <div className="w-full h-[calc(100vh-3.5rem)] relative bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)]">
      <h1 className="visually-hidden truncate">{t("app_canvas", "Canvas")}</h1>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        className="dark:bg-[var(--bg-primary)]"
      >
        {nodes.length === 0 && (
          <div
            data-testid="canvas-view"
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div className="border border-[var(--divider)] dark:border-[var(--divider)] p-8 rounded-3xl text-center max-w-md animate-in fade-in zoom-in duration-500 ds-bg-card">
              <div className="size-16 bg-cyan-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Plus className="size-8 text-cyan-500" />
              </div>
              <h2 className="text-xl font-semibold text-[var(--text-primary)] dark:text-[var(--text-accent)] mb-2 line-clamp-2">
                {t("app_canvasEmptyTitle", { defaultValue: "Empty Canvas" })}
              </h2>
              <p className="text-sm text-[var(--text-muted)] dark:text-[var(--text-muted)]">
                {t("app_canvasEmptyDesc", {
                  defaultValue:
                    "Start by adding documents or bookmarks from the top-left panel to visualize your knowledge.",
                })}
              </p>
            </div>
          </div>
        )}
        {nodes.length > 0 && (
          <>
            <Controls className="bg-white dark:bg-[var(--bg-card)] border-[var(--divider)] dark:border-[var(--divider)] fill-[var(--text-muted)] dark:fill-[var(--text-secondary)]" />
            <MiniMap
              nodeStrokeColor={getNodeStrokeColor}
              nodeColor={getNodeColor}
              className="bg-white dark:bg-[var(--bg-card)] border-[var(--divider)] dark:border-[var(--divider)]"
            />
          </>
        )}
        <Background color="#71717a" gap={16} size={1} />

        <Panel
          position="top-left"
          className="bg-white dark:bg-[var(--bg-primary)] p-2 rounded-xl shadow-lg border border-[var(--divider)] dark:border-[var(--divider)] flex gap-2"
        >
          <button
            onClick={addDocumentNode}
            className="truncate flex items-center gap-2 px-3 py-1.5 ds-ghost-bg-accent text-cyan-700 dark:text-cyan-300 rounded-lg text-sm font-medium"
          >
            <Plus className="size-4" />
            <FileText className="size-4" />
            {t("app_addDocument", { defaultValue: "Add Doc" })}
          </button>
          <button
            onClick={addBookmarkNode}
            className="truncate flex items-center gap-2 px-3 py-1.5 ds-ghost-bg-success text-[var(--color-success-text)] dark:text-[var(--color-success)] rounded-lg text-sm font-medium"
          >
            <Plus className="size-4" />
            <BookmarkIcon className="size-4" />
            {t("app_addBookmark", { defaultValue: "Add Bookmark" })}
          </button>
          <div className="w-px h-8 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] mx-1"></div>
          <button
            onClick={clearCanvas}
            className="truncate flex items-center gap-2 px-3 py-1.5 ds-ghost-bg-danger ds-text-danger dark:ds-text-danger rounded-lg text-sm font-medium"
          >
            <Trash2 className="size-4" />
            {t("app_clear", { defaultValue: "Clear" })}
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
};
