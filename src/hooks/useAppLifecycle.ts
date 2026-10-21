import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { initDB } from "../db/database";
import { notificationService } from "../services/NotificationService";
import { agentService } from "../services/ai/AgentService";
import { autoProcessorService } from "../services/ai/AutoProcessorService";
import { intelligentMaintenanceService } from "../services/ai/IntelligentMaintenanceService";
import { logger } from "../utils/logger";
import { safeErrorForLog } from "../utils/safeErrorForLog";
import { TranslationFunction } from "../types";

export const useAppLifecycle = (
  isUnderPressure: boolean,
  t: TranslationFunction,
) => {
  const autoProcessorStartedRef = useRef(false);

  useEffect(() => {
    if (isUnderPressure) {
      toast.warning(t("app_memoryPressureCritical"));
      agentService.clearCache();
    }
  }, [isUnderPressure, t]);

  useEffect(() => {
    const checkDueCards = async () => {
      try {
        const db = await initDB();
        const now = new Date().toISOString();
        const dueCards = await db.flashcards
          .find({
            selector: {
              nextReview: { $lte: now },
            },
          })
          .limit(100)
          .exec();

        if (dueCards.length > 0) {
          void notificationService
            .scheduleSRSNotification(dueCards.length)
            .catch((notificationError: unknown) => {
              // Background notification failures must not become unhandled
              // promise rejections or affect the database polling loop.
              logger.warn("[useAppLifecycle] SRS notification failed", {
                error: safeErrorForLog(notificationError),
              });
            });
        }
      } catch (err) {
        logger.error("[useAppLifecycle] Error in background SRS check", {
          error: safeErrorForLog(err),
        });
      }
    };

    checkDueCards();
    const interval = setInterval(checkDueCards, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoProcessorStartedRef.current) {return;}
    autoProcessorStartedRef.current = true;
    void autoProcessorService.start();
    intelligentMaintenanceService.start();
    return () => {
      autoProcessorService.stop();
      intelligentMaintenanceService.stop();
      autoProcessorStartedRef.current = false;
    };
  }, []);
};
