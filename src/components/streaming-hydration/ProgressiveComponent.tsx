import type { ReactNode } from "react";
import { useProgressiveHydration } from "./useProgressiveHydration";
import type { HydrationPriority } from "./types";
import { Skeleton } from "../OptimizedSkeleton";

interface ProgressiveComponentProps {
  children: ReactNode;
  priority?: HydrationPriority;
  delay?: number;
  fallback?: ReactNode;
  placeholderHeight?: number | string;
}

export const ProgressiveComponent: React.FC<ProgressiveComponentProps> = ({
  children,
  priority = "medium",
  delay,
  fallback,
  placeholderHeight = 200,
}) => {
  const shouldRender = useProgressiveHydration(priority, delay);

  if (!shouldRender) {
    if (fallback) {return <>{fallback}</>;}
    return (
      <div
        style={{
          height:
            typeof placeholderHeight === "number"
              ? `${placeholderHeight}px`
              : placeholderHeight,
          contain: "layout paint",
        }}
      >
        <Skeleton
          height={
            typeof placeholderHeight === "number" ? placeholderHeight : 200
          }
        />
      </div>
    );
  }

  return <>{children}</>;
};
