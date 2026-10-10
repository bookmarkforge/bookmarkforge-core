import { useEffect, useRef, useState, useCallback } from "react";
import { Share2 } from "lucide-react";
import { initDB } from "../container/database";
import { useTranslation } from "react-i18next";
import { logger } from "../utils/logger";
import { useGuardedDataLoad } from "../hooks/useGuardedDataLoad";
import {
  useGraphSimulation,
  detectClusters,
  buildLinksFromTags,
  CLUSTER_COLORS,
  type GraphStats,
} from "../hooks/useGraphSimulation";

interface GraphViewProps {
  onNodeClick?: (type: "doc" | "bookmark", id: string) => void;
}

const GraphView = ({ onNodeClick }: GraphViewProps) => {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [stats, setStats] = useState<GraphStats>({ nodes: 0, links: 0, clusters: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [clusterLabels, setClusterLabels] = useState<string[]>([]);
  const dbRef = useRef<Awaited<ReturnType<typeof initDB>> | null>(null);
  const searchQueryRef = useRef("");
  // The search input writes the query here before the debounced load(); the
  // loader reads it (like the original doRender(nextQuery) argument).
  const queryRef = useRef<string | undefined>(undefined);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const graphRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { renderGraph } = useGraphSimulation({
    svgRef,
    db: dbRef.current,
    onNodeClick,
  });
  const graphDataRef = useRef<import("../hooks/useGraphSimulation").GraphData | null>(null);

  const loadGraphData = useCallback(async () => {
    if (!dbRef.current) dbRef.current = await initDB();
    const db = dbRef.current;
    if (!db) return null;

    const GRAPH_LIMIT = 2000;
    const [docs, bookmarks] = await Promise.all([
      db.documents
        .find({ selector: { isDeleted: { $ne: true } }, limit: GRAPH_LIMIT })
        .exec(),
      db.bookmarks
        .find({ selector: { isDeleted: { $ne: true } }, limit: GRAPH_LIMIT })
        .exec(),
    ]);

    // RxDB normally returns documents with toJSON(), but adapters, demo
    // stores, and tests may provide plain objects. Normalize both shapes at
    // this boundary so a non-RxDB-compatible read cannot blank the graph.
    const toRecord = (value: unknown): Record<string, unknown> => {
      if (value && typeof (value as { toJSON?: unknown }).toJSON === "function") {
        return (value as { toJSON: () => unknown }).toJSON() as Record<string, unknown>;
      }
      return (value && typeof value === "object")
        ? value as Record<string, unknown>
        : {};
    };
    const toNode = (value: unknown, type: "doc" | "bookmark") => {
      const obj = toRecord(value);
      return {
        id: String(obj.id ?? ""),
        title: typeof obj.title === "string" && obj.title ? obj.title : "Untitled",
        tags: Array.isArray(obj.tags)
          ? obj.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        type,
        similarity: 0,
        cluster: -1,
      } as const;
    };
    const nodes = [
      ...docs.map((d: unknown) => toNode(d, "doc")),
      ...bookmarks.map((b: unknown) => toNode(b, "bookmark")),
    ];

    return { nodes, links: buildLinksFromTags(nodes) };
  }, []);

  // The render pipeline is one data-load: the loader fetches (cached via
  // graphDataRef), filters by the current query, renders the simulation and
  // returns the stats + cluster labels. A newer load (search debounce, DB
  // change, mount) supersedes the in-flight one via the guard — replacing
  // the original triple invalidation (generation + renderRequestRef +
  // cancelledRef). autoLoad off: the setup effect drives the first render.
  const { load, loading: isLoading, cancel } = useGuardedDataLoad<
    { stats: GraphStats; clusterLabels: string[] } | null
  >(
    async (signal) => {
      if (!svgRef.current) {return null;}
      const data =
        graphDataRef.current ?? (await loadGraphData());
      if (signal.aborted || !data) {return null;}
      graphDataRef.current = data;

      const q = queryRef.current ?? searchQueryRef.current;
      const normalizedQuery = q.toLowerCase();
      const nodes = normalizedQuery
        ? data.nodes.filter(
            (n) =>
              n.title.toLowerCase().includes(normalizedQuery) ||
              n.tags.some((tag: string) => tag.toLowerCase().includes(normalizedQuery)),
          )
        : data.nodes;
      const filteredData = normalizedQuery
        ? { nodes, links: buildLinksFromTags(nodes) }
        : data;
      const topTags = detectClusters(nodes);

      // Data is already filtered and linked above; the hook only renders it.
      const simStats = await renderGraph("", filteredData);
      if (signal.aborted) {return null;}
      return { stats: simStats, clusterLabels: topTags };
    },
    {
      autoLoad: false,
      onSuccess: (result) => {
        if (!result) {return;}
        setStats(result.stats);
        setClusterLabels(result.clusterLabels);
      },
      onError: (e) => logger.error("Graph error:", e),
    },
    );

  // Subscribe to DB changes; the guard auto-cancels the load on unmount (the
  // original cancelledRef + cancel + renderRequestRef bump).
  useEffect(() => {
    const subs: Array<{ unsubscribe: () => void }> = [];
    const scheduleGraphRefresh = () => {
      clearTimeout(graphRefreshTimerRef.current);
      graphRefreshTimerRef.current = setTimeout(() => {
        graphRefreshTimerRef.current = undefined;
        void load();
      }, 100);
    };

    const setup = async () => {
      try {
        if (!dbRef.current) dbRef.current = await initDB();
        const db = dbRef.current;

        if (db.bookmarks?.$) {
          subs.push(
            db.bookmarks.$.subscribe(() => {
              graphDataRef.current = null;
              scheduleGraphRefresh();
            }),
          );
        }
        if (db.documents?.$) {
          subs.push(
            db.documents.$.subscribe(() => {
              graphDataRef.current = null;
              scheduleGraphRefresh();
            }),
          );
        }

        await load();
      } catch (e) {
        logger.error("GraphView setup error:", e);
        // initDB failed before the first load: cancel resets the loading
        // flag so the empty state shows instead of a stuck spinner.
        cancel();
      }
    };

    setup();

    return () => {
      clearTimeout(searchTimerRef.current);
      clearTimeout(graphRefreshTimerRef.current);
      graphRefreshTimerRef.current = undefined;
      for (const s of subs) {
        try {
          s.unsubscribe();
        } catch {
          /* INTENTIONAL SILENCE: teardown must not mask unmount cleanup. */
        }
      }
    };
  }, [cancel, load]);

  return (
    <div className="relative w-full h-[650px] overflow-hidden ds-radius-card ds-bg-secondary">
      <div className="absolute top-4 start-4 z-10 flex flex-col gap-2">
        <h1 className="text-lg font-semibold ds-text-primary truncate">
          {t("app_knowledgeGraph")}
        </h1>
        <input
          type="text"
          aria-label={t("app_filterGraph") || "Filter nodes"}
          value={searchQuery}
          onChange={(e) => {
            const nextQuery = e.target.value;
            searchQueryRef.current = nextQuery;
            setSearchQuery(nextQuery);
            clearTimeout(searchTimerRef.current);
            searchTimerRef.current = setTimeout(() => {
              queryRef.current = nextQuery;
              void load();
            }, 300);
          }}
          placeholder={t("app_filterGraph") || "Filter nodes..."}
          className="px-3 py-1.5 text-sm outline-none w-48 ds-radius-button ds-bg-input ds-border-inactive ds-text-primary"
        />
        <div className="text-xs ds-text-muted">
          {t("app_nodes")}: {stats.nodes} | {t("app_links")}: {stats.links} |{" "}
          {t("app_clusters")}: {stats.clusters}
        </div>
      </div>

      {stats.nodes === 0 && !isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-20 pointer-events-none">
          <div className="size-16 rounded-full flex items-center justify-center ds-bg-secondary">
            <Share2 className="size-8 ds-text-muted" />
          </div>
          <div className="text-center space-y-2 max-w-xs">
            <h3 className="max-w-xs line-clamp-2 text-lg font-semibold ds-text-primary">
              {t("app_graphEmptyTitle", "Your knowledge graph is empty")}
            </h3>
            <p className="text-sm ds-text-muted">
              {t(
                "app_graphEmptyDesc",
                "Add bookmarks and documents to see connections between your ideas.",
              )}
            </p>
          </div>
        </div>
      )}

      {clusterLabels.length > 0 && (
        <div className="absolute top-4 end-4 z-10 flex flex-col gap-1.5">
          {clusterLabels.map((label, i) => (
            <div key={i} className="flex items-center gap-2 text-xs ds-text-muted">
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: CLUSTER_COLORS[i % CLUSTER_COLORS.length] }}
              />
              <span className="truncate max-w-[100px]">{label}</span>
            </div>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center ds-bg-black-50">
          <div className="size-8 border-4 border-t-transparent rounded-full animate-spin ds-border-accent-primary ds-border-t-transparent" />
        </div>
      )}

      <svg ref={svgRef} className="w-full h-full cursor-grab" />
    </div>
  );
};

export default GraphView;
