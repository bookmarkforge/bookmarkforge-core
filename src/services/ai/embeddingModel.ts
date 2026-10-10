/**
 * Shared embedding-model contract.
 *
 * Transformers.js currently defaults browser WASM inference to q8. Keep that
 * choice explicit so a library upgrade cannot silently switch the model file
 * used to build new semantic-search vectors.
 */
export const EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_MODEL_DIMENSIONS = 384;
export const EMBEDDING_MODEL_DTYPE = "q8" as const;

export const EMBEDDING_MODEL_PIPELINE_OPTIONS = Object.freeze({
  dtype: EMBEDDING_MODEL_DTYPE,
});

/**
 * The uint8 artifact is evaluated nightly but is deliberately not selected
 * for production until its retrieval quality clears the documented floor.
 * Sizes are the pinned Hugging Face tree metadata used for the comparison.
 */
export const EMBEDDING_MODEL_VARIANTS = Object.freeze({
  baseline: Object.freeze({
    dtype: "q8" as const,
    file: "onnx/model_quantized.onnx",
    bytes: 22_972_370,
  }),
  candidate: Object.freeze({
    dtype: "uint8" as const,
    file: "onnx/model_uint8.onnx",
    bytes: 22_845_806,
  }),
});
