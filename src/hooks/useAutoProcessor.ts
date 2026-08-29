import { useState, useEffect } from "react";
import {
  autoProcessorService,
  AutoProcessorStatus,
} from "../services/ai/AutoProcessorService";
import { logger } from "../utils/logger";

/**
 * Hook to manage the AutoProcessorService lifecycle.
 * Automatically starts the service when the component mounts
 * and stops it when the component unmounts to prevent memory leaks.
 */
export function useAutoProcessor() {
  const [status, setStatus] = useState<AutoProcessorStatus>({
    isProcessing: false,
    totalItems: 0,
    processedItems: 0,
  });

  useEffect(() => {
    // The effect has [] deps, so it runs exactly once per mount (React
    // guarantees single execution for empty-dependency effects). A ref guard
    // was previously used here, but it was unreachable code: the cleanup
    // reset it to false before any possible re-run, so the guard could never
    // observe its own true branch on a legitimate re-run.
    autoProcessorService.start().catch((err: Error) => {
      logger.error("[useAutoProcessor] Failed to start service", {
        error: err,
      });
    });

    // Subscribe to status updates
    const sub = autoProcessorService.status$.subscribe({
      next: setStatus,
      error: (err: Error) => {
        logger.error("[useAutoProcessor] Status subscription error", {
          error: err,
        });
      },
    });

    // Cleanup: unsubscribe and stop service on unmount
    return () => {
      sub.unsubscribe();
      autoProcessorService.stop();
      logger.info("[useAutoProcessor] Service stopped and cleaned up");
    };
  }, []);

  return status;
}
