import type { BookmarkDocType } from "../../db/schema";
import type { BookmarkForgeDB } from "../../db/types";
import type { RxDocument } from "rxdb";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Share2,
  ArrowRight,
  Layers,
  Plus,
  Minus,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { CardProps } from "./shared-props";
import { StreamPreview } from "./StreamPreview";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { parseFencedJson } from "../../utils/jsonFenceStripper";

interface Props extends CardProps {
  t: TFunction;
}

interface GraphNode {
  id: string;
  title: string;
  level: number;
  tags: string[];
}

interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

const LEVEL_COLORS = [
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-purple-500",
  "bg-fuchsia-500",
];

const NODE_WIDTH = 160;
const COLUMN_GAP = 220;
const ROW_GAP = 64;
const CANVAS_HEIGHT = 600;

export const DependencyMap: React.FC<Props> = ({ cardVariants }) => {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [zoom, setZoom] = useState(1);
  const [allBookmarks, setAllBookmarks] = useState<BookmarkDocType[]>([]);
  const {
    loading,
  } = useGuardedDataLoad<BookmarkDocType[]>(
    async (signal) => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      const bookmarks = await db.bookmarks
        .find({ selector: { isDeleted: false, isPrivate: false } })
        .exec();
      if (signal.aborted) {return [];}
      return bookmarks.map(
        (b: RxDocument<BookmarkDocType>) =>
          b.toJSON() as unknown as BookmarkDocType,
      );
    },
    {
      onSuccess: (bookmarks) => setAllBookmarks(bookmarks),
      onError: () => setAllBookmarks([]),
    },
  );
  const {
    runWithSignal: runAnalyze,
    isRunning: generating,
  } = useGuardedAction<void>({
    blockReentry: false,
    onStart: () => {
      setStreamText("");
      setNodes([]);
      setEdges([]);
      setSelectedNode(null);
    },
    onSuccess: () => setStreamText(""),
    onError: () => {
      setStreamText("");
      setNodes([]);
      setEdges([]);
    },
  });

  const analyzeDependencies = () => {
    void runAnalyze(async (signal) => {
      const sorted = [...allBookmarks]
        .filter((b) => b.title && !b.isDeleted)
        .sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0))
        .slice(0, 30);

      if (sorted.length === 0) {
        return;
      }

      const bookmarkData = sorted.map((b) => ({
        title: b.title,
        content: (b.content || "").substring(0, 200),
      }));

      const { agentService } = await import("../../services/ai/AgentService");
      if (signal.aborted) {return;}
      const prompt = `Analyze these bookmark titles and their content to find dependency relationships. For each pair where one concept is a prerequisite for another, return an edge. Return JSON: {edges: [{from: bookmarkTitle, to: bookmarkTitle, label: 'prerequisite'}]}. Consider: if understanding A helps understand B, then A->B has edge. Bookmark list: ${JSON.stringify(bookmarkData)}`;

      // Stream raw tokens live while the graph JSON is generated.
      const res = await agentService.globalChat(
        prompt,
        undefined,
        false,
        undefined,
        (chunk) => {
          if (!signal.aborted) {
            setStreamText((prev) => prev + chunk);
          }
        },
        undefined,
        undefined,
        signal,
      );
      if (signal.aborted) {return;}
      setStreamText("");
      const parsed = parseFencedJson<{ edges?: { from: string; to: string; label: string }[] }>(res.text);
      const rawEdges: { from: string; to: string; label: string }[] =
        parsed.edges || [];

      const titleSet = new Set<string>();
      for (const e of rawEdges) {
        titleSet.add(e.from);
        titleSet.add(e.to);
      }

      const titleToBm = new Map(sorted.map((b) => [b.title, b]));

      const inDeg = new Map<string, number>();
      const adj = new Map<string, string[]>();
      for (const e of rawEdges) {
        if (!adj.has(e.from)) {adj.set(e.from, []);}
        adj.get(e.from)!.push(e.to);
        inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
        if (!inDeg.has(e.from)) {inDeg.set(e.from, 0);}
      }

      const levels = new Map<string, number>();
      const queue: string[] = [];
      for (const title of titleSet) {
        if ((inDeg.get(title) || 0) === 0) {
          levels.set(title, 0);
          queue.push(title);
        }
      }

      while (queue.length > 0) {
        const cur = queue.shift()!;
        const curLevel = levels.get(cur) || 0;
        const neighbors = adj.get(cur) || [];
        for (const nb of neighbors) {
          const nextLevel = curLevel + 1;
          const existing = levels.get(nb);
          if (existing === undefined || nextLevel > existing) {
            levels.set(nb, nextLevel);
          }
          queue.push(nb);
        }
      }

      for (const title of titleSet) {
        if (!levels.has(title)) {levels.set(title, 0);}
      }

      const newNodes: GraphNode[] = [];
      for (const title of titleSet) {
        const bm = titleToBm.get(title);
        newNodes.push({
          id: title,
          title,
          level: levels.get(title) || 0,
          tags: bm?.tags || [],
        });
      }

      const validEdges = rawEdges.filter(
        (e) => titleSet.has(e.from) && titleSet.has(e.to),
      );

      if (signal.aborted) {return;}
      setNodes(newNodes);
      setEdges(validEdges);
    });
  };

  const nodesByLevel = useMemo(() => {
    const groups = new Map<number, GraphNode[]>();
    for (const node of nodes) {
      const g = groups.get(node.level);
      if (g) {g.push(node);}
      else {groups.set(node.level, [node]);}
    }
    return groups;
  }, [nodes]);

  const nodePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    for (const [level, levelNodes] of nodesByLevel) {
      const count = levelNodes.length;
      const totalHeight = count * ROW_GAP;
      const startY = Math.max(20, (CANVAS_HEIGHT - totalHeight) / 2);
      levelNodes.forEach((node, idx) => {
        positions.set(node.id, {
          x: 20 + level * COLUMN_GAP,
          y: startY + idx * ROW_GAP,
        });
      });
    }
    return positions;
  }, [nodesByLevel]);

  const selectedNodeData = useMemo(
    () => nodes.find((n) => n.id === selectedNode),
    [nodes, selectedNode],
  );

  const incomingEdges = useMemo(
    () => edges.filter((e) => e.to === selectedNode),
    [edges, selectedNode],
  );

  const outgoingEdges = useMemo(
    () => edges.filter((e) => e.from === selectedNode),
    [edges, selectedNode],
  );

  const handleZoomIn = () =>
    setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)));
  const handleZoomOut = () =>
    setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)));

  return (
    <motion.div variants={cardVariants} className="bento-item p-5">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20">
          <Share2 className="size-5 text-blue-500" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-sm text-[var(--text-primary)] dark:text-white">
            {t("dependencyMap_title", "Dependency Map")}
          </h3>
          <p className="text-[10px] text-[var(--text-muted)]">
            {t(
              "dependencyMap_subtitle",
              "Visualize prerequisite relationships between your bookmarks",
            )}
          </p>
        </div>
      </div>

      {generating && <StreamPreview text={streamText} />}

      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={analyzeDependencies}
          disabled={generating || allBookmarks.length === 0}
          aria-label={t("dependencyMap_analyze", "Analyze Dependencies")}
          className="truncate px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          {generating ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : (
            <Layers className="size-3.5" />
          )}
          {t("dependencyMap_analyze", "Analyze Dependencies")}
        </button>
      </div>

      <div className="relative min-h-[500px] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
        {loading ? (
          <div className="flex items-center justify-center h-[500px] text-sm text-[var(--text-muted)]">
            {t("dependencyMap_loading", "Loading bookmarks...")}
          </div>
        ) : nodes.length === 0 && !generating ? (
          <div className="flex items-center justify-center h-[500px] text-sm text-[var(--text-muted)]">
            {t(
              "dependencyMap_empty",
              "Not enough data. Save more bookmarks on related topics.",
            )}
          </div>
        ) : (
          <div
            className="relative"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              minHeight: CANVAS_HEIGHT,
            }}
          >
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{
                width: Math.max(
                  400,
                  (Object.keys(nodePositions).length + 1) * 250,
                ),
                height: CANVAS_HEIGHT,
              }}
            >
              <defs>
                <marker
                  id="arrow"
                  markerWidth="10"
                  markerHeight="7"
                  refX="10"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
                </marker>
              </defs>
              {edges.map((edge, idx) => {
                const from = nodePositions.get(edge.from);
                const to = nodePositions.get(edge.to);
                if (!from || !to) {return null;}
                const x1 = from.x + NODE_WIDTH / 2;
                const y1 = from.y + 16;
                const x2 = to.x + NODE_WIDTH / 2;
                const y2 = to.y + 16;
                return (
                  <g key={idx}>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="#94a3b8"
                      strokeWidth="1.5"
                      markerEnd="url(#arrow)"
                    />
                    <title>{`${edge.from} → ${edge.to} (${edge.label})`}</title>
                  </g>
                );
              })}
            </svg>

            {nodes.map((node) => {
              const pos = nodePositions.get(node.id);
              if (!pos) {return null;}
              const isSelected = selectedNode === node.id;
              return (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, scale: 0.5, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  onClick={() => setSelectedNode(isSelected ? null : node.id)}
                  className={`absolute cursor-pointer px-3 py-1.5 rounded-full text-xs font-medium text-white shadow-md hover:shadow-lg transition-all ${LEVEL_COLORS[node.level % LEVEL_COLORS.length]} ${isSelected ? "ring-2 ring-offset-2 ring-blue-400 dark:ring-offset-gray-900" : ""}`}
                  style={{
                    left: pos.x,
                    top: pos.y,
                    width: NODE_WIDTH,
                    zIndex: isSelected ? 10 : 1,
                  }}
                >
                  <span className="block truncate text-center">
                    {node.title}
                  </span>
                </motion.div>
              );
            })}
          </div>
        )}

        <div className="absolute bottom-3 right-3 flex gap-1.5">
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={zoom >= 3 || nodes.length === 0}
            className="p-1.5 rounded-lg bg-white dark:bg-gray-800 shadow border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors"
            aria-label={t("app_zoomIn", "Zoom in")}
          >
            <Plus className="size-4 text-[var(--text-muted)]" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={zoom <= 1 || nodes.length === 0}
            className="p-1.5 rounded-lg bg-white dark:bg-gray-800 shadow border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors"
            aria-label={t("app_zoomOut", "Zoom out")}
          >
            <Minus className="size-4 text-[var(--text-muted)]" aria-hidden="true" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {selectedNodeData && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden"
          >
            <h4 className="font-semibold text-sm mb-2 text-[var(--text-primary)] dark:text-white">
              {selectedNodeData.title}
            </h4>
            {selectedNodeData.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {selectedNodeData.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-[10px] rounded-full bg-gray-100 dark:bg-gray-700 text-[var(--text-muted)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-medium text-[var(--text-muted)] mb-1">
                  {t("dependencyMap_dependencies", "Dependencies")}
                </p>
                {incomingEdges.length === 0 ? (
                  <p className="text-[var(--text-muted)] italic">
                    {t("dependencyMap_none", "None")}
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {incomingEdges.map((e, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-1 text-[var(--text-primary)] dark:text-white"
                      >
                        <ArrowRight className="rtl-flip size-3 text-blue-400 shrink-0" />
                        <span className="truncate">{e.from}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="font-medium text-[var(--text-muted)] mb-1">
                  {t("dependencyMap_dependedBy", "Depended by")}
                </p>
                {outgoingEdges.length === 0 ? (
                  <p className="text-[var(--text-muted)] italic">
                    {t("dependencyMap_none", "None")}
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {outgoingEdges.map((e, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-1 text-[var(--text-primary)] dark:text-white"
                      >
                        <ArrowRight className="rtl-flip size-3 text-purple-400 shrink-0" />
                        <span className="truncate">{e.to}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <button
              type="button"
              className="truncate mt-3 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              aria-label={t(
                "dependencyMap_openBookmark",
                "Open Bookmark",
              )}
            >
              {t("dependencyMap_openBookmark", "Open Bookmark")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
