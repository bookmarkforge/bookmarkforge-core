import { aiManager } from "../../services/ai/ProviderManager";
import { logger } from "../../utils/logger";

/**
 * Dependencies of the editor-focus warmup handler, kept injectable so unit
 * tests can exercise the REAL handler with only a mocked aiManager.
 */
interface EditorFocusWarmupDeps {
  /** Clears the transient AI error banner (the hook's `setAiError`). */
  setAiError: (v: string | null) => void;
  /**
   * One-shot flag per editor instance (the hook's `isWarmedUpRef`): warmup
   * fires on the FIRST focus only — later focuses of the same editor are
   * no-ops, while a second editor instance gets its own warmup.
   */
  isWarmedUpRef: { current: boolean };
}

/**
 * Builds the editor `onFocus` handler that opportunistically preloads the
 * local AI model on the user's first interaction with the editor.
 *
 * Safety contract:
 * - `aiManager.warmup()` internally guards the WebLLM init with
 *   `canRunLocalLLM()` (WebGPU + shader-f16 + >= 4 GB RAM), so a device
 *   without a capable GPU skips the preload silently — no wasted init
 *   attempt, no model download, no error metrics.
 * - `webLLMService.init()` is idempotent for the already-loaded model, so a
 *   warmup racing an active session never reloads the engine.
 * - A warmup failure must never surface as an editor error (the preload is
 *   opportunistic); it logs a warning and re-arms the one-shot flag so a
 *   later focus can try again.
 */
export function createEditorFocusHandler({
  setAiError,
  isWarmedUpRef,
}: EditorFocusWarmupDeps): () => void {
  return () => {
    setAiError(null);
    if (isWarmedUpRef.current) {return;}
    isWarmedUpRef.current = true;
    void aiManager.warmup().catch((err: unknown) => {
      logger.warn("[BlockEditor] AI warmup failed on editor focus", {
        error: err instanceof Error ? err.message : String(err),
      });
      isWarmedUpRef.current = false;
    });
  };
}
