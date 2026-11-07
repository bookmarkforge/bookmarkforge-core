import { useEffect, useRef, useState } from "react";
import type { HydrationPriority } from "./types";
import { PRIORITY_DELAYS } from "./constants";

export function useProgressiveHydration(
  priority: HydrationPriority = "medium",
  delay?: number,
): boolean {
  const [shouldRender, setShouldRender] = useState(
    () => priority === "critical",
  );
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (priority === "critical") {
      return;
    }

    const actualDelay = delay ?? PRIORITY_DELAYS[priority];

    if (priority === "idle" && "requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(() => setShouldRender(true), {
        timeout: 2000,
      });
      return () => window.cancelIdleCallback(idleId);
    }

    timeoutRef.current = setTimeout(() => {
      rafRef.current = requestAnimationFrame(() => {
        setShouldRender(true);
      });
    }, actualDelay);

    return () => {
      if (timeoutRef.current) {clearTimeout(timeoutRef.current);}
      if (rafRef.current) {cancelAnimationFrame(rafRef.current);}
    };
  }, [priority, delay]);

  return shouldRender;
}
