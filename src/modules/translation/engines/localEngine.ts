/**
 * src/modules/translation/engines/localEngine.ts
 *
 * Core-side seam to the Pro local-inference runtime. Core (MIT).
 *
 * `loadProService("TranslationLocalEngine")` is the ONLY tolerated reference to
 * the Pro worker from Core:
 *   - Free user   → typed ProUnavailableError, no chunk fetched;
 *   - Pro user    → the Pro module is fetched once and its singleton returned;
 *   - Open Core   → the generated placeholder is detected by pro-access and
 *                   reported as `load-failed` instead of pretending to work.
 *
 * The facade is declared structurally in `../types` so this file never imports
 * a Pro path, not even for types.
 */

import { loadProService } from "../../../services/pro-access";
import type { LocalTranslationEngineFacade } from "../types";

const LOCAL_ENGINE_PRO_SERVICE = "TranslationLocalEngine";

/**
 * Resolve the local engine facade.
 *
 * @throws ProUnavailableError when the session has no Pro license or the
 *   implementation is absent from this build.
 */
export function loadLocalTranslationEngine(): Promise<LocalTranslationEngineFacade> {
  return loadProService<LocalTranslationEngineFacade>(LOCAL_ENGINE_PRO_SERVICE);
}

/** Test/debug helper: whether the local runtime can be resolved right now. */
export async function isLocalTranslationAvailable(): Promise<boolean> {
  try {
    await loadLocalTranslationEngine();
    return true;
  } catch {
    // INTENTIONAL SILENCE: the probe's answer IS the boolean; the typed
    // rejection is available to callers that need the reason via the loader.
    return false;
  }
}
