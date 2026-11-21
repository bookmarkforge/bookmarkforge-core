import { expect, test } from "@playwright/test";

const MIN_RECALL_AT_3 = 0.8;
const MIN_MEAN_RECIPROCAL_RANK = 0.75;
const MAX_RECALL_DROP = 0.1;
const MAX_MRR_DROP = 0.1;

const CORPUS = {
  documents: [
    {
      id: "frontend-react",
      text: "React components, accessible controls, responsive layouts, and frontend UI state patterns.",
    },
    {
      id: "backend-node",
      text: "Node.js server routes, request validation, HTTP handlers, and backend service contracts.",
    },
    {
      id: "security-xss",
      text: "Prevent XSS and malicious HTML by sanitizing untrusted content and enforcing a strict content security policy.",
    },
    {
      id: "security-encryption",
      text: "Encrypt private vault data locally with a password-derived key and wipe plaintext on lock.",
    },
    {
      id: "database-rxdb",
      text: "Use RxDB and IndexedDB collections for an offline-first local database with reactive queries.",
    },
    {
      id: "database-indexing",
      text: "Build a browser search index for local documents and keep it bounded as records change.",
    },
    {
      id: "performance-bundle",
      text: "Reduce initial JavaScript bundle size by splitting heavy routes and avoiding eager imports.",
    },
    {
      id: "performance-lazy",
      text: "Defer ONNX and other large model assets until the first semantic-search operation.",
    },
    {
      id: "networking-webrtc",
      text: "Coordinate WebRTC peers, signaling handshakes, and reconnects for collaborative browser sessions.",
    },
    {
      id: "networking-signaling",
      text: "Enforce signaling room limits and rate limits while accepting or rejecting websocket clients.",
    },
    {
      id: "testing-vitest",
      text: "Write fast Vitest unit tests with mocks, fake timers, and focused branch coverage.",
    },
    {
      id: "testing-playwright",
      text: "Use Playwright browser tests for real user workflows, screenshots, and production smoke checks.",
    },
  ],
  queries: [
    {
      id: "q-frontend",
      text: "How do I build accessible React interface controls?",
      relevantIds: ["frontend-react"],
    },
    {
      id: "q-backend",
      text: "How should I implement Node server HTTP routes?",
      relevantIds: ["backend-node"],
    },
    {
      id: "q-xss",
      text: "How do I stop script injection in rendered HTML?",
      relevantIds: ["security-xss"],
    },
    {
      id: "q-encryption",
      text: "How can a local vault encrypt private user data?",
      relevantIds: ["security-encryption"],
    },
    {
      id: "q-rxdb",
      text: "How do I store offline records with RxDB and IndexedDB?",
      relevantIds: ["database-rxdb"],
    },
    {
      id: "q-index",
      text: "How should I search and index local browser documents?",
      relevantIds: ["database-indexing"],
    },
    {
      id: "q-bundle",
      text: "How can I reduce the initial JavaScript bundle download?",
      relevantIds: ["performance-bundle", "performance-lazy"],
    },
    {
      id: "q-lazy-model",
      text: "When should a browser download the ONNX model for semantic search?",
      relevantIds: ["performance-lazy", "performance-bundle"],
    },
    {
      id: "q-webrtc",
      text: "How do I coordinate browser WebRTC peers and signaling reconnects?",
      relevantIds: ["networking-webrtc"],
    },
    {
      id: "q-signaling",
      text: "How do I rate limit signaling websocket rooms?",
      relevantIds: ["networking-signaling"],
    },
    {
      id: "q-vitest",
      text: "How can I write fast Vitest tests with fake timers?",
      relevantIds: ["testing-vitest"],
    },
    {
      id: "q-playwright",
      text: "How do I test real browser workflows with Playwright?",
      relevantIds: ["testing-playwright"],
    },
  ],
} as const;

test.describe("@nightly embedding model quality", () => {
  test("uint8 stays within the q8 semantic-search quality floor", async ({ page }) => {
    test.setTimeout(900_000);
    await page.goto("/");

    const result = await page.evaluate(async (corpus) => {
      const {
        compareEmbeddingQuality,
        evaluateEmbeddingVariant,
      } = await import("/src/services/ai/embeddingBenchmark.ts");
      const { EMBEDDING_MODEL_VARIANTS } = await import(
        "/src/services/ai/embeddingModel.ts"
      );

      const baseline = await evaluateEmbeddingVariant("q8", corpus);
      const candidate = await evaluateEmbeddingVariant("uint8", corpus);
      const comparison = compareEmbeddingQuality(
        baseline,
        candidate,
        EMBEDDING_MODEL_VARIANTS.baseline.bytes,
        EMBEDDING_MODEL_VARIANTS.candidate.bytes,
      );
      return { baseline, candidate, comparison };
    }, CORPUS);

    expect(result.baseline.dimensions, "q8 embedding dimension").toBe(384);
    expect(result.candidate.dimensions, "uint8 embedding dimension").toBe(384);
    expect(result.baseline.recallAt3, "q8 baseline Recall@3").toBeGreaterThanOrEqual(
      MIN_RECALL_AT_3,
    );
    expect(
      result.baseline.meanReciprocalRank,
      "q8 baseline MRR",
    ).toBeGreaterThanOrEqual(MIN_MEAN_RECIPROCAL_RANK);
    expect(
      result.candidate.recallAt3,
      "uint8 candidate Recall@3",
    ).toBeGreaterThanOrEqual(MIN_RECALL_AT_3);
    expect(
      result.candidate.meanReciprocalRank,
      "uint8 candidate MRR",
    ).toBeGreaterThanOrEqual(MIN_MEAN_RECIPROCAL_RANK);
    expect(
      result.comparison.recallDelta,
      "uint8 Recall@3 regression versus q8",
    ).toBeGreaterThanOrEqual(-MAX_RECALL_DROP);
    expect(
      result.comparison.meanReciprocalRankDelta,
      "uint8 MRR regression versus q8",
    ).toBeGreaterThanOrEqual(-MAX_MRR_DROP);

    await test.info().attach("embedding-quality-metrics.json", {
      body: JSON.stringify(
        {
          corpus: {
            documentCount: CORPUS.documents.length,
            queryCount: CORPUS.queries.length,
          },
          thresholds: {
            minRecallAt3: MIN_RECALL_AT_3,
            minMeanReciprocalRank: MIN_MEAN_RECIPROCAL_RANK,
            maxRecallDrop: MAX_RECALL_DROP,
            maxMrrDrop: MAX_MRR_DROP,
          },
          ...result,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
});
