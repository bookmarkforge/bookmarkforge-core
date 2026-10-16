import { useTranslation } from "react-i18next";

export const SuspenseFallback = () => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center p-8 text-[var(--text-muted)]">
      <div className="animate-spin size-6 border-2 border-[var(--divider)] border-t-cyan-500 rounded-full me-3" />
      <span className="text-sm">{t("app_loading")}</span>
    </div>
  );
};

// Skeleton for lists
export const SkeletonList = ({ count = 5 }: { count?: number }) => (
  <div className="space-y-3 p-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="animate-pulse">
        <div className="h-4 bg-[var(--bg-secondary)] rounded w-3/4 mb-2" />
        <div className="h-3 bg-[var(--bg-secondary)] rounded w-1/2" />
      </div>
    ))}
  </div>
);

// Skeleton for cards
export const SkeletonCard = ({ count = 3 }: { count?: number }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="animate-pulse">
        <div className="h-40 bg-[var(--bg-secondary)] rounded-lg mb-4" />
        <div className="h-4 bg-[var(--bg-secondary)] rounded w-3/4 mb-2" />
        <div className="h-3 bg-[var(--bg-secondary)] rounded w-1/2" />
      </div>
    ))}
  </div>
);

// Skeleton for text
export const SkeletonText = ({ lines = 3 }: { lines?: number }) => (
  <div className="space-y-2 p-4">
    {Array.from({ length: lines }).map((_, i) => (
      <div key={i} className="animate-pulse">
        <div className="h-4 bg-[var(--bg-secondary)] rounded" />
      </div>
    ))}
  </div>
);

// Skeleton for table
export const SkeletonTable = ({ rows = 5 }: { rows?: number }) => (
  <div className="p-4">
    <div className="animate-pulse mb-4">
      <div className="h-8 bg-[var(--bg-secondary)] rounded w-1/4 mb-4" />
    </div>
    {Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        className="animate-pulse flex items-center space-x-4 py-3 border-b border-[var(--divider)]"
      >
        <div className="size-10 bg-[var(--bg-secondary)] rounded" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-[var(--bg-secondary)] rounded w-3/4" />
          <div className="h-3 bg-[var(--bg-secondary)] rounded w-1/2" />
        </div>
      </div>
    ))}
  </div>
);
