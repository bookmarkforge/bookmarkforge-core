/**
 * src/hooks/useGraphSimulation.ts
 *
 * Custom hook that handles D3 force simulation + SVG rendering for
 * the Knowledge Graph view. Extracted from GraphView.tsx to improve
 * maintainability and testability.
 */
import { useCallback, useEffect, useRef } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type { BookmarkForgeDB } from "../db/types";
import { logger } from "../utils/logger";

// ── Types ──────────────────────────────────────────────────────────────

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  tags: string[];
  type: "doc" | "bookmark";
  similarity: number;
  cluster: number;
}

interface GraphLink {
  source: string;
  target: string;
  value: number;
  type: "explicit" | "semantic";
}

export interface GraphStats {
  nodes: number;
  links: number;
  clusters: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export const CLUSTER_COLORS = [
  "#00aeef",
  "#f59e0b",
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#00aeef",
];

// A popular tag can connect every node to every other node. Keep graph
// construction and the D3 force simulation bounded for large vaults while
// preserving all links for ordinary-sized tag groups.
export const MAX_GRAPH_LINKS = 10_000;

// ── Pure helpers ───────────────────────────────────────────────────────

export function detectClusters(nodes: GraphNode[]): string[] {
  const tagFrequency = new Map<string, number>();
  for (const n of nodes) {
    for (const t of n.tags) {
      tagFrequency.set(t, (tagFrequency.get(t) || 0) + 1);
    }
  }

  const topTags = [...tagFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  // Track membership with O(1) lookups. The previous arrays made every
  // node/cluster check scan all earlier IDs in that cluster.
  const clusterMap = new Map<number, Set<string>>();
  for (const n of nodes) {
    // Count each node's tags once. This preserves duplicate-tag scoring while
    // avoiding an includes() + filter() scan for every top-tag candidate.
    const nodeTagCounts = new Map<string, number>();
    for (const tag of n.tags) {
      nodeTagCounts.set(tag, (nodeTagCounts.get(tag) ?? 0) + 1);
    }

    let bestCluster = -1;
    let bestScore = 0;
    for (let ci = 0; ci < topTags.length; ci++) {
      const score = nodeTagCounts.get(topTags[ci]!) ?? 0;
      if (score > 0 && !clusterMap.get(ci)?.has(n.id)) {
        if (score > bestScore) {
          bestScore = score;
          bestCluster = ci;
        }
      }
    }
    const c = bestCluster >= 0 ? bestCluster : topTags.length;
    n.cluster = c;
    if (!clusterMap.has(c)) clusterMap.set(c, new Set());
    clusterMap.get(c)!.add(n.id);
  }

  return topTags;
}

export function buildLinksFromTags(nodes: GraphNode[]): GraphLink[] {
  const tagIndex = new Map<string, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    // A repeated tag does not create a new relationship. Keep one index entry
    // per node/tag so malformed or imported data cannot multiply pair checks.
    const uniqueTags = new Set(nodes[i]!.tags);
    for (const tag of uniqueTags) {
      const idx = tagIndex.get(tag);
      if (idx) idx.push(i);
      else tagIndex.set(tag, [i]);
    }
  }

  const seen = new Set<string>();
  // Lazily cache membership checks only for nodes that participate in a
  // candidate group. Nodes with unique tags no longer allocate a Set that is
  // never consulted.
  const tagSets = new Map<number, Set<string>>();
  const tagCounts = new Map<number, Map<string, number>>();
  const getTagSet = (index: number): Set<string> => {
    const cached = tagSets.get(index);
    if (cached) return cached;
    const created = new Set(nodes[index]!.tags);
    tagSets.set(index, created);
    return created;
  };
  const getTagCounts = (index: number): Map<string, number> => {
    const cached = tagCounts.get(index);
    if (cached) return cached;
    const created = new Map<string, number>();
    for (const tag of nodes[index]!.tags) {
      created.set(tag, (created.get(tag) ?? 0) + 1);
    }
    tagCounts.set(index, created);
    return created;
  };
  const links: GraphLink[] = [];
  linkGroups: for (const [, indices] of tagIndex) {
    if (indices.length < 2) {continue;}
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        if (links.length >= MAX_GRAPH_LINKS) {break linkGroups;}
        const aIdx = indices[i]!;
        const bIdx = indices[j]!;
        const key = aIdx < bIdx ? `${aIdx}-${bIdx}` : `${bIdx}-${aIdx}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = nodes[aIdx]!;
        const b = nodes[bIdx]!;
        // Preserve duplicate tags on `a` for compatibility with the previous
        // count while avoiding a full tag-array scan for every candidate.
        const bTags = getTagSet(bIdx);
        let common = 0;
        for (const [tag, count] of getTagCounts(aIdx)) {
          if (bTags.has(tag)) common += count;
        }
        links.push({
          source: a.id,
          target: b.id,
          value: 0.3 + common * 0.1,
          type: "semantic",
        });
      }
    }
  }
  return links;
}

interface GraphLoaderWindow {
  __graph_loader?: (
    db: BookmarkForgeDB,
    filter: string,
  ) => Promise<GraphData>;
}

function loadGraphData(
  db: BookmarkForgeDB,
  filter: string,
): Promise<GraphData> {
  const loader = (window as unknown as GraphLoaderWindow).__graph_loader;
  return loader?.(db, filter) ??
    (async () => {
      // Independent collections — fetch concurrently instead of serially;
      // on a large vault the two queries each scan thousands of docs.
      const [docs, bookmarks] = await Promise.all([
        db.documents.find().exec(),
        db.bookmarks.find().exec(),
      ]);

      const nodeDocs: GraphNode[] = docs.map((d: { toJSON: () => unknown }) => {
        const obj = d.toJSON() as Record<string, unknown>;
        return {
          id: obj.id as string,
          title: (obj.title as string) || "Untitled",
          tags: (obj.tags as string[]) || [],
          type: "doc" as const,
          similarity: 0,
          cluster: -1,
        };
      });

      const nodeBookmarks: GraphNode[] = bookmarks.map((b: { toJSON: () => unknown }) => {
        const obj = b.toJSON() as Record<string, unknown>;
        return {
          id: obj.id as string,
          title: (obj.title as string) || "Untitled",
          tags: (obj.tags as string[]) || [],
          type: "bookmark" as const,
          similarity: 0,
          cluster: -1,
        };
      });

      const allNodes = [...nodeDocs, ...nodeBookmarks];
      const f = filter.toLowerCase();
      const filtered = f
        ? allNodes.filter((n) => n.title.toLowerCase().includes(f) || n.tags.some((t: string) => t.toLowerCase().includes(f)))
        : allNodes;

      detectClusters(filtered);
      const links = buildLinksFromTags(filtered);
      return { nodes: filtered, links };
    })();
}

// ── Hook ───────────────────────────────────────────────────────────────

interface UseGraphSimulationOptions {
  svgRef: React.RefObject<SVGSVGElement | null>;
  db: BookmarkForgeDB | null;
  onNodeClick?: (type: "doc" | "bookmark", id: string) => void;
}

interface UseGraphSimulationReturn {
  renderGraph: (filter?: string, sourceData?: GraphData) => Promise<GraphStats>;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

export function useGraphSimulation({
  svgRef,
  db,
  onNodeClick,
}: UseGraphSimulationOptions): UseGraphSimulationReturn {
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simulationRef = useRef<ReturnType<typeof forceSimulation> | null>(null);
  const renderGenerationRef = useRef(0);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const renderGraph = useCallback(
    async (filter = "", sourceData?: GraphData) => {
      const generation = ++renderGenerationRef.current;
      if ((!db && !sourceData) || !svgRef.current) {
        return { nodes: 0, links: 0, clusters: 0 };
      }

      try {
        const { nodes: sourceNodes } =
          sourceData ?? (await loadGraphData(db!, ""));
        // An older database read must never repaint over a newer render or a
        // component that has already been unmounted.
        if (generation !== renderGenerationRef.current || !svgRef.current) {
          return { nodes: 0, links: 0, clusters: 0 };
        }
        const normalizedFilter = filter.toLowerCase();
        const nodes = normalizedFilter
          ? sourceNodes.filter(
              (n) =>
                n.title.toLowerCase().includes(normalizedFilter) ||
                n.tags.some((tag) => tag.toLowerCase().includes(normalizedFilter)),
            )
          : sourceNodes;
        detectClusters(nodes);
        // Callers that already prepared GraphData have paid the link-building
        // cost; reuse it when no additional filter is applied.
        const links = normalizedFilter
          ? buildLinksFromTags(nodes)
          : sourceData?.links ?? buildLinksFromTags(nodes);
        const uniqueClusters = [...new Set(nodes.map((n) => n.cluster))];

        const width = svgRef.current.clientWidth || 800;
        const height = svgRef.current.clientHeight || 600;

        simulationRef.current?.stop();
        const svg = select(svgRef.current);
        svg.selectAll("*").remove();
        // Remove any previous zoom listeners to prevent accumulation when
        // renderGraph is called multiple times without the unmount cleanup.
        svg.on(".zoom", null);

        const g = svg.append("g");

        const zoomBehavior = zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.1, 8])
          .on("zoom", (event) => g.attr("transform", event.transform));
        zoomRef.current = zoomBehavior;
        svg.call(zoomBehavior);

        const simulation = forceSimulation(nodes as SimulationNodeDatum[])
          .force(
            "link",
            forceLink<GraphNode, SimulationLinkDatum<GraphNode>>(
              links as SimulationLinkDatum<GraphNode>[],
            )
              .id((d: GraphNode) => d.id)
              .distance(100),
          )
          .force("charge", forceManyBody().strength(-350))
          .force("center", forceCenter(width / 2, height / 2))
          .force("collision", forceCollide().radius(30));
        simulationRef.current = simulation;

        const link = g
          .append("g")
          .selectAll("line")
          .data(links)
          .enter()
          .append("line")
          .attr("stroke", "var(--accent-primary)")
          .attr("stroke-opacity", 0.5)
          .attr("stroke-width", 2);

        const nodeGroup = g
          .append("g")
          .selectAll("g")
          .data(nodes)
          .enter()
          .append("g")
          .style("cursor", "pointer");

        nodeGroup
          .append("circle")
          .attr("r", 10)
          .attr("fill", (d: GraphNode) => {
            if (d.cluster >= 0 && d.cluster < CLUSTER_COLORS.length) {
              return CLUSTER_COLORS[d.cluster]!;
            }
            return d.type === "doc" ? "var(--accent-primary)" : "#6b7280";
          });

        nodeGroup
          .append("text")
          .text((d: GraphNode) => d.title.substring(0, 15))
          .attr("x", 15)
          .attr("y", 4)
          .attr("font-size", "10px")
          .attr("fill", "var(--text-secondary)");

        nodeGroup.on("click", (_event: unknown, d: GraphNode) => {
          onNodeClickRef.current?.(d.type, d.id);
        });

        nodeGroup
          .append("title")
          .text((d: GraphNode) => `${d.title}\n${d.tags.join(", ")}`);

        simulation.on("tick", () => {
          link
            .attr("x1", (d: unknown) => (d as { source: GraphNode }).source.x!)
            .attr("y1", (d: unknown) => (d as { source: GraphNode }).source.y!)
            .attr("x2", (d: unknown) => (d as { target: GraphNode }).target.x!)
            .attr("y2", (d: unknown) => (d as { target: GraphNode }).target.y!);
          nodeGroup.attr(
            "transform",
            (d: GraphNode) => `translate(${d.x},${d.y})`,
          );
        });

        return {
          nodes: nodes.length,
          links: links.length,
          clusters: uniqueClusters.filter((c) => c >= 0).length,
        };
      } catch (e: unknown) {
        logger.error("Graph error:", e);
        return { nodes: 0, links: 0, clusters: 0 };
      }
    },
    [db],
  );

  useEffect(() => {
    // React clears object refs before running unmount cleanup, so capture the
    // element while it is still available for explicit D3 listener cleanup.
    const svgElement = svgRef.current;
    return () => {
      // Invalidate any database read that is still awaiting completion.
      renderGenerationRef.current += 1;
      simulationRef.current?.stop();
      simulationRef.current = null;
      zoomRef.current = null;
      if (svgElement) {
        const svg = select(svgElement);
        svg.on(".zoom", null);
        svg.selectAll("*").remove();
      }
    };
  }, [svgRef]);

  const zoomIn = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).call(zoomRef.current.scaleBy, 1.5);
  }, [svgRef]);

  const zoomOut = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).call(zoomRef.current.scaleBy, 0.75);
  }, [svgRef]);

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).call(zoomRef.current.transform, zoomIdentity);
  }, [svgRef]);

  return { renderGraph, zoomIn, zoomOut, resetZoom };
}
