import { useCallback, useEffect, useRef } from "react";

interface RequestGuardHandle {
  generation: number;
  signal: AbortSignal;
}

/**
 * Serializes UI requests and invalidates results that outlive the active
 * selection or component. The guard contains no request-specific state.
 */
export function useRequestGuard() {
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const begin = useCallback((): RequestGuardHandle => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    const generation = ++generationRef.current;
    controllerRef.current = controller;
    return { generation, signal: controller.signal };
  }, []);

  const isCurrent = useCallback((generation: number): boolean => {
    return (
      generation === generationRef.current &&
      controllerRef.current !== null &&
      !controllerRef.current.signal.aborted
    );
  }, []);

  const cancel = useCallback((): void => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return { begin, isCurrent, cancel };
}
