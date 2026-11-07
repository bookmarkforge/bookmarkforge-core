import React from "react";

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  circle?: boolean;
  count?: number;
  style?: React.CSSProperties;
}

interface SkeletonCardProps {
  lines?: number;
  hasImage?: boolean;
  className?: string;
}

interface SkeletonTextProps {
  lines?: number;
  lineHeight?: number;
  gap?: number;
  lastLineWidth?: string;
  className?: string;
}

/**
 * Base skeleton element
 */
export const Skeleton: React.FC<SkeletonProps> = ({
    className = "",
    width = "100%",
    height = "1rem",
    circle = false,
    count = 1,
    style: customStyle,
  }) => {
    const style: React.CSSProperties = {
      width: typeof width === "number" ? `${width}px` : width,
      height: typeof height === "number" ? `${height}px` : height,
      borderRadius: circle ? "50%" : "4px",
      willChange: "transform",
      transform: "translateZ(0)",
      ...customStyle,
    };

    if (count > 1) {
      return (
        <>
          {Array.from({ length: count }).map((_, i) => (
            <div
              key={i}
              className={`skeleton-shimmer ${className}`}
              style={{
                ...style,
                animationDelay: `${i * 0.1}s`,
              }}
            />
          ))}
        </>
      );
    }

    return <div className={`skeleton-shimmer ${className}`} style={style} />;
  };

Skeleton.displayName = "Skeleton";

/**
 * Text skeleton with multiple lines
 */
export const SkeletonText: React.FC<SkeletonTextProps> = ({
    lines = 3,
    lineHeight = 16,
    gap = 8,
    lastLineWidth = "70%",
    className = "",
  }) => {
    return (
      <div className={`flex flex-col ${className}`} style={{ gap }}>
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            height={lineHeight}
            width={i === lines - 1 ? lastLineWidth : "100%"}
          />
        ))}
      </div>
    );
  };

SkeletonText.displayName = "SkeletonText";

/**
 * Card skeleton with image and text
 */
export const SkeletonCard: React.FC<SkeletonCardProps> = ({ lines = 3, hasImage = true, className = "" }) => {
    return (
      <div
        className={`p-4 rounded-lg border border-[var(--divider)] ${className}`}
      >
        <div className="flex items-start gap-4">
          {hasImage && (
            <Skeleton
              width={64}
              height={64}
              className="rounded-lg flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <Skeleton height={20} width="60%" className="mb-2" />
            <SkeletonText lines={lines} lineHeight={12} gap={6} />
          </div>
        </div>
      </div>
    );
  };

SkeletonCard.displayName = "SkeletonCard";

/**
 * Avatar skeleton
 */
export const SkeletonAvatar: React.FC<{ size?: number }> = ({ size = 40 }) => {
    return <Skeleton width={size} height={size} circle />;
  };

SkeletonAvatar.displayName = "SkeletonAvatar";

/**
 * Bookmark list item skeleton
 */
const SkeletonBookmarkItem: React.FC = () => {
  return (
    <div className="flex items-center gap-3 p-3 border-b border-[var(--divider)]">
      <Skeleton width={32} height={32} className="rounded" />
      <div className="flex-1 min-w-0">
        <Skeleton height={16} width="70%" className="mb-1" />
        <Skeleton height={12} width="40%" />
      </div>
      <Skeleton width={24} height={24} circle />
    </div>
  );
};

SkeletonBookmarkItem.displayName = "SkeletonBookmarkItem";

/**
 * Graph view skeleton
 */
const SkeletonGraph: React.FC = () => {
  return (
    <div className="relative w-full h-full min-h-[400px] bg-[var(--bg-secondary)] rounded-lg overflow-hidden">
      {/* Grid background */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `
            linear-gradient(to right, var(--divider) 1px, transparent 1px),
            linear-gradient(to bottom, var(--divider) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }}
      />

      {/* Animated nodes */}
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton
          key={i}
          width={60}
          height={60}
          circle
          className="absolute"
          style={{
            left: `${15 + (i % 4) * 20}%`,
            top: `${15 + Math.floor(i / 4) * 40}%`,
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}

      {/* Loading text */}
      <div className="absolute bottom-4 left-4 right-4 text-center">
        <Skeleton height={16} width="200px" className="mx-auto" />
      </div>
    </div>
  );
};

SkeletonGraph.displayName = "SkeletonGraph";

/**
 * Dashboard skeleton
 */
const SkeletonDashboard: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="p-4 rounded-lg border border-[var(--divider)]"
          >
            <Skeleton height={32} width="60%" className="mb-2" />
            <Skeleton height={16} width="40%" />
          </div>
        ))}
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <Skeleton height={300} className="rounded-lg" />
          <Skeleton height={200} className="rounded-lg" />
        </div>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} hasImage={false} lines={2} />
          ))}
        </div>
      </div>
    </div>
  );
};

SkeletonDashboard.displayName = "SkeletonDashboard";

// CSS is defined in index.css using CSS variables (.skeleton-shimmer)
