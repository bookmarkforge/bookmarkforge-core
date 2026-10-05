import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { configureModelIntegrity } from "../../utils/modelIntegrity";
import { EMBEDDING_MODEL_ID } from "./embeddingModel";

interface EmbeddingBenchmarkDocument {
  id: string;
  text: string;
}

interface EmbeddingBenchmarkQuery {
  id: string;
  text: string;
  relevantIds: readonly string[];
}

interface EmbeddingBenchmarkCorpus {
  documents: readonly EmbeddingBenchmarkDocument[];
  queries: readonly EmbeddingBenchmarkQuery[];
}

interface EmbeddingQualityMetrics {
  dtype: "q8" | "uint8";
  dimensions: number;
  recallAt3: number;
  meanReciprocalRank: number;
  queryCount: number;
  documentCount: number;
  elapsedMs: number;
}

interface EmbeddingQualityComparison {
  recallDelta: number;
  meanReciprocalRankDelta: number;
  sizeReductionRatio: number;
}

type EmbeddingVector = number[];
type EmbeddingDtype = EmbeddingQualityMetrics["dtype"];

function cosineSimilarity(left: EmbeddingVector, right: EmbeddingVector): number {
  if (left.length !== right.length || left.length === 0) {return 0;}

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator === 0 ? 0 : dot / denominator;
}

function tensorRows(output: { data: ArrayLike<number>; dims?: number[] }): EmbeddingVector[] {
  const dimensions = output.dims?.at(-1) ?? 0;
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error("Embedding output did not expose a valid final dimension");
  }
  const values = Array.from(output.data);
  if (values.length % dimensions !== 0) {
    throw new Error("Embedding output size is not divisible by its dimension");
  }
  const rows: EmbeddingVector[] = [];
  for (let offset = 0; offset < values.length; offset += dimensions) {
    rows.push(values.slice(offset, offset + dimensions));
  }
  return rows;
}

async function createExtractor(dtype: EmbeddingDtype): Promise<FeatureExtractionPipeline> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.remoteHost = "https://huggingface.co";
  env.remotePathTemplate = "{model}/resolve/{revision}/";
  const backends = env.backends as Record<
    string,
    Record<string, { proxy: boolean }>
  > | undefined;
  if (backends?.onnx?.wasm) {backends.onnx.wasm.proxy = false;}
  configureModelIntegrity(env);

  return pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
    device: "wasm",
    dtype,
  });
}

async function encode(
  extractor: FeatureExtractionPipeline,
  texts: string[],
): Promise<{ vectors: EmbeddingVector[]; dimensions: number }> {
  const output = await extractor(texts, {
    pooling: "mean",
    normalize: true,
  });
  const rows = tensorRows(output as unknown as { data: ArrayLike<number>; dims?: number[] });
  const dimensions = rows[0]?.length ?? 0;
  if (rows.length !== texts.length || dimensions === 0) {
    throw new Error("Embedding pipeline returned an unexpected batch shape");
  }
  return { vectors: rows, dimensions };
}

/**
 * Run the same retrieval corpus through one model artifact.
 * This module is loaded only by the nightly quality test; production keeps
 * the explicit q8 baseline in embeddingModel.ts.
 */
export async function evaluateEmbeddingVariant(
  dtype: EmbeddingDtype,
  corpus: EmbeddingBenchmarkCorpus,
): Promise<EmbeddingQualityMetrics> {
  const startedAt = performance.now();
  const extractor = await createExtractor(dtype);
  try {
    const documentBatch = await encode(
      extractor,
      corpus.documents.map((document) => document.text),
    );
    const queryBatch = await encode(
      extractor,
      corpus.queries.map((query) => query.text),
    );

    let recallAt3 = 0;
    let meanReciprocalRank = 0;
    for (let queryIndex = 0; queryIndex < corpus.queries.length; queryIndex += 1) {
      const query = corpus.queries[queryIndex]!;
      const queryVector = queryBatch.vectors[queryIndex]!;
      const relevantIds = new Set(query.relevantIds);
      const ranking = corpus.documents
        .map((document, documentIndex) => ({
          id: document.id,
          similarity: cosineSimilarity(
            queryVector,
            documentBatch.vectors[documentIndex]!,
          ),
        }))
        .sort((left, right) => right.similarity - left.similarity);

      const topThree = ranking.slice(0, 3);
      recallAt3 +=
        topThree.filter((item) => relevantIds.has(item.id)).length /
        Math.max(1, relevantIds.size);
      const firstRelevantIndex = ranking.findIndex((item) => relevantIds.has(item.id));
      meanReciprocalRank += firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1);
    }

    const queryCount = corpus.queries.length;
    return {
      dtype,
      dimensions: documentBatch.dimensions,
      recallAt3: queryCount === 0 ? 0 : recallAt3 / queryCount,
      meanReciprocalRank: queryCount === 0 ? 0 : meanReciprocalRank / queryCount,
      queryCount,
      documentCount: corpus.documents.length,
      elapsedMs: performance.now() - startedAt,
    };
  } finally {
    const disposable = extractor as unknown as { dispose?: () => void | Promise<void> };
    await disposable.dispose?.();
  }
}

export function compareEmbeddingQuality(
  baseline: EmbeddingQualityMetrics,
  candidate: EmbeddingQualityMetrics,
  baselineBytes: number,
  candidateBytes: number,
): EmbeddingQualityComparison {
  return {
    recallDelta: candidate.recallAt3 - baseline.recallAt3,
    meanReciprocalRankDelta:
      candidate.meanReciprocalRank - baseline.meanReciprocalRank,
    sizeReductionRatio: (baselineBytes - candidateBytes) / baselineBytes,
  };
}
