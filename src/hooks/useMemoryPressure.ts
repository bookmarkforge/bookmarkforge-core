import { useEffect, useRef, useState } from "react";
import { getPerformanceMemory } from "../utils/browser-types";
import { garbageCollectionService } from "../services/GarbageCollectionService";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { logger } from "../utils/logger";
import { loadWebLLMService } from "../services/pro-access";

export const useMemoryPressure = () => {
  const { t } = useTranslation();
  const [isUnderPressure, setIsUnderPressure] = useState(false);
  const observerRef = useRef<{
    observe: () => void;
    disconnect: () => void;
  } | null>(null);
  const handlingCriticalRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    const handlePressure = async (level: "moderate" | "critical") => {
      // Memory APIs can report the same critical level on every poll. Avoid
      // stacking duplicate unloads/toasts while the first recovery is still
      // running, which can create extra work exactly when memory is scarce.
      if (level === "critical" && handlingCriticalRef.current) {return;}
      if (level === "critical") {handlingCriticalRef.current = true;}
      logger.warn("[MemoryPressure] Pressure detected:", level);
      if (mounted) {setIsUnderPressure(true);}

      if (level === "critical") {
        toast.error(
          t("app_memoryPressureCritical", "Critical Memory Pressure"),
          {
            description: t(
              "app_memoryPressureCriticalDesc",
              "Unloaded AI models to prevent crash and freed up RAM.",
            ),
            duration: 10000,
          },
        );

        try {
          // Pro engines unload through the gated loader: under Free (or in
          // an Open Core export) the promise rejects and there is simply
          // nothing to unload — the local engines were never running.
          await loadWebLLMService()
            .then((s) => s.unload())
            .catch(() => undefined);
          const { ragEngine } = await import("../services/ai/RAGEngine");

          await ragEngine.unload();

          garbageCollectionService
            .triggerManualCleanup(0)
            .catch((err) =>
              logger.warn("[MemoryPressure] GC cleanup failed", { error: err }),
            );
        } catch (e: unknown) {
          logger.error("[MemoryPressure] Failed to handle pressure", {
            error: e,
          });
        } finally {
          handlingCriticalRef.current = false;
          if (!mounted) {return;}
        }
      }
    };

    const handleCustomPressure = (e: Event) => {
      const customEvent = e as CustomEvent<{
        pressure?: "moderate" | "critical";
      }>;
      handlePressure(customEvent.detail?.pressure || "critical");
    };
    window.addEventListener("simulate-memory-pressure", handleCustomPressure);

    const checkMemory = () => {
      // getPerformanceMemory() can be undefined in headless browsers and in
      // any non-Chromium engine (performance.memory is Chrome-only) — guard
      // before reading .memory or this interval throws every 15s.
      const memory = getPerformanceMemory()?.memory;
      if (memory) {
        const usedRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
        if (usedRatio > 0.9) {
          handlePressure("critical");
        } else if (usedRatio > 0.75) {
          handlePressure("moderate");
        } else {
          setIsUnderPressure(false);
        }
      }
    };

    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval !== null) {return;}
      interval = setInterval(checkMemory, 15000);
    };
    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        start();
      } else {
        // Skip the 15 s memory-pressure poll entirely on hidden tabs:
        // nothing actionable can run anyway, and the native observer
        // (when available) still fires regardless of visibility.
        stop();
      }
    };
    if (document.visibilityState === "visible") {
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);

    // Use native MemoryPressureObserver if available (e.g. Firefox Nightly)
    if (typeof window !== "undefined" && "MemoryPressureObserver" in window) {
      try {
        type MemoryPressureObserverCtor = new (
          callback: (event: { pressure: "moderate" | "critical" }) => void,
        ) => { observe(): void; disconnect(): void };
        const ObserverClass = (
          window as Record<string, unknown>
        ).MemoryPressureObserver as unknown as MemoryPressureObserverCtor;
        observerRef.current = new ObserverClass(
          (event: { pressure: "moderate" | "critical" }) => {
            handlePressure(event.pressure);
          },
        );
        if (
          observerRef.current &&
          typeof observerRef.current.observe === "function"
        ) {
          observerRef.current.observe();
        }
      } catch (e: unknown) {
        logger.warn(
          "[MemoryPressure] Failed to instantiate MemoryPressureObserver",
          { error: e },
        );
      }
    }

    return () => {
      mounted = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(
        "simulate-memory-pressure",
        handleCustomPressure,
      );
      if (
        observerRef.current &&
        typeof observerRef.current.disconnect === "function"
      ) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [t]);

  return isUnderPressure;
};
