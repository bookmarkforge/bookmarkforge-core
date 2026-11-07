import { describe, it, expect } from "vitest";
import {
  detectClusters,
  buildLinksFromTags,
  CLUSTER_COLORS,
  MAX_GRAPH_LINKS,
  type GraphNode,
} from "../../hooks/useGraphSimulation";

// ── Helpers ────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  tags: string[],
  type: "doc" | "bookmark" = "doc",
): GraphNode {
  return {
    id,
    title: `Node ${id}`,
    tags,
    type,
    similarity: 0,
    cluster: -1,
  };
}

// ── detectClusters ─────────────────────────────────────────────────────

describe("detectClusters", () => {
  it("returns empty array for empty node list", () => {
    const topTags = detectClusters([]);
    expect(topTags).toEqual([]);
  });

  it("assigns a single cluster for nodes with a single shared tag", () => {
    const nodes = [
      makeNode("a", ["react"]),
      makeNode("b", ["react"]),
      makeNode("c", ["react"]),
    ];
    const topTags = detectClusters(nodes);

    expect(topTags).toEqual(["react"]);
    // All nodes should be in cluster 0 (the "react" cluster)
    expect(nodes.every((n) => n.cluster === 0)).toBe(true);
  });

  it("assigns different clusters based on tag frequency", () => {
    const nodes = [
      makeNode("a", ["react", "typescript"]),
      makeNode("b", ["react", "typescript"]),
      makeNode("c", ["react", "typescript"]),
      makeNode("d", ["python", "django"]),
      makeNode("e", ["python", "django"]),
      makeNode("f", ["python", "django"]),
    ];
    const topTags = detectClusters(nodes);

    // Top 2 tags should be "react" and "python" (or "typescript" and "django")
    expect(topTags.length).toBeGreaterThanOrEqual(2);

    // Nodes sharing the most frequent tag should cluster together
    const reactNodes = nodes.filter((n) =>
      n.tags.includes(topTags[0]!),
    );
    const allSameCluster = reactNodes.every(
      (n) => n.cluster === reactNodes[0]!.cluster,
    );
    expect(allSameCluster).toBe(true);
  });

  it("limits top tags to 5", () => {
    const nodes = [
      makeNode("a", ["tag1"]),
      makeNode("b", ["tag2"]),
      makeNode("c", ["tag3"]),
      makeNode("d", ["tag4"]),
      makeNode("e", ["tag5"]),
      makeNode("f", ["tag6"]),
    ];
    const topTags = detectClusters(nodes);
    expect(topTags.length).toBeLessThanOrEqual(5);
  });

  it("nodes with no common tags get assigned different clusters", () => {
    const nodes = [
      makeNode("a", ["unique-a"]),
      makeNode("b", ["unique-b"]),
    ];
    const topTags = detectClusters(nodes);

    // Each node has a unique tag that is among the top tags, so they get
    // assigned to different clusters based on their individual top tag.
    expect(topTags.length).toBeGreaterThanOrEqual(2);
    expect(nodes[0]!.cluster).not.toBe(nodes[1]!.cluster);
  });

  it("handles duplicate tags on a single node (counts duplicates)", () => {
    const nodes = [
      makeNode("a", ["react", "react", "react"]),
      makeNode("b", ["react"]),
    ];
    const topTags = detectClusters(nodes);

    expect(topTags[0]).toBe("react");
    // Node 'a' has more "react" tags, but both should still be in cluster 0
    expect(nodes[0]!.cluster).toBe(0);
    expect(nodes[1]!.cluster).toBe(0);
  });

  it("prefers the cluster with the highest tag score", () => {
    // Node 'a' has both tags but "python" is most frequent overall
    const nodes = [
      makeNode("a", ["python", "react"]),
      makeNode("b", ["python"]),
      makeNode("c", ["python"]),
    ];
    const topTags = detectClusters(nodes);

    expect(topTags[0]).toBe("python");
    // Node 'a' has the most "python" tags, so it should be in the python cluster
    expect(nodes[0]!.cluster).toBe(0);
  });

  it("does not mutate input nodes' non-cluster fields", () => {
    const nodes = [
      makeNode("a", ["react"]),
      makeNode("b", ["vue"]),
    ];
    const titles = nodes.map((n) => n.title);
    const ids = nodes.map((n) => n.id);
    detectClusters(nodes);

    expect(nodes.map((n) => n.title)).toEqual(titles);
    expect(nodes.map((n) => n.id)).toEqual(ids);
  });
});

// ── buildLinksFromTags ─────────────────────────────────────────────────

describe("buildLinksFromTags", () => {
  it("returns empty array for empty node list", () => {
    expect(buildLinksFromTags([])).toEqual([]);
  });

  it("returns empty array for single node", () => {
    expect(buildLinksFromTags([makeNode("a", ["react"])])).toEqual([]);
  });

  it("creates a link between two nodes sharing a tag", () => {
    const nodes = [makeNode("a", ["react"]), makeNode("b", ["react"])];
    const links = buildLinksFromTags(nodes);

    expect(links).toHaveLength(1);
    expect(links[0]!.source).toBe("a");
    expect(links[0]!.target).toBe("b");
    expect(links[0]!.type).toBe("semantic");
    expect(links[0]!.value).toBeGreaterThanOrEqual(0.3);
  });

  it("does not create a link for nodes with no shared tags", () => {
    const nodes = [makeNode("a", ["react"]), makeNode("b", ["vue"])];
    const links = buildLinksFromTags(nodes);
    expect(links).toEqual([]);
  });

  it("creates multiple links for nodes sharing multiple tags", () => {
    const nodes = [
      makeNode("a", ["react", "typescript"]),
      makeNode("b", ["react", "typescript"]),
    ];
    const links = buildLinksFromTags(nodes);

    // One link with higher value due to 2 shared tags
    expect(links).toHaveLength(1);
    expect(links[0]!.value).toBeGreaterThan(0.3);
  });

  it("does not create duplicate links for the same node pair", () => {
    const nodes = [
      makeNode("a", ["react", "vue"]),
      makeNode("b", ["react", "vue"]),
    ];
    const links = buildLinksFromTags(nodes);

    // Only one link despite sharing 2 tags
    expect(links).toHaveLength(1);
  });

  it("creates links through shared tags across multiple nodes", () => {
    const nodes = [
      makeNode("a", ["react"]),
      makeNode("b", ["react"]),
      makeNode("c", ["react"]),
    ];
    const links = buildLinksFromTags(nodes);

    // 3 nodes sharing 1 tag = 3 pairs: a-b, a-c, b-c
    expect(links).toHaveLength(3);
  });

  it("handles duplicate tags on a single node (deduplicates for link building)", () => {
    const nodes = [
      makeNode("a", ["react", "react"]),
      makeNode("b", ["react"]),
    ];
    const links = buildLinksFromTags(nodes);

    // Still just one link (duplicate tags don't create extra links)
    expect(links).toHaveLength(1);
    expect(links[0]!.source).toBe("a");
    expect(links[0]!.target).toBe("b");
  });

  it("respects MAX_GRAPH_LINKS limit", () => {
    // Create enough nodes sharing a tag to exceed the limit
    const nodeCount = Math.ceil(
      (1 + Math.sqrt(1 + 8 * (MAX_GRAPH_LINKS + 1))) / 2,
    );
    const nodes = Array.from({ length: nodeCount }, (_, i) =>
      makeNode(`n${i}`, ["shared"]),
    );
    const links = buildLinksFromTags(nodes);

    expect(links.length).toBeLessThanOrEqual(MAX_GRAPH_LINKS);
  });

  it("handles nodes with empty tag arrays", () => {
    const nodes = [
      makeNode("a", []),
      makeNode("b", ["react"]),
      makeNode("c", []),
    ];
    const links = buildLinksFromTags(nodes);
    // 'a' and 'c' share nothing, 'b' shares nothing with anyone
    expect(links).toEqual([]);
  });

  it("preserves node id ordering in link source/target", () => {
    const nodes = [
      makeNode("z-node", ["react"]),
      makeNode("a-node", ["react"]),
    ];
    const links = buildLinksFromTags(nodes);
    expect(links).toHaveLength(1);
    // Source should be the node with the lower index
    expect(links[0]!.source).toBe("z-node");
    expect(links[0]!.target).toBe("a-node");
  });
});

// ── Constants ──────────────────────────────────────────────────────────

describe("graph constants", () => {
  it("CLUSTER_COLORS has at least 5 entries", () => {
    expect(CLUSTER_COLORS.length).toBeGreaterThanOrEqual(5);
  });

  it("CLUSTER_COLORS entries are valid hex colors", () => {
    for (const color of CLUSTER_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("MAX_GRAPH_LINKS is a positive integer", () => {
    expect(MAX_GRAPH_LINKS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_GRAPH_LINKS)).toBe(true);
  });
});
