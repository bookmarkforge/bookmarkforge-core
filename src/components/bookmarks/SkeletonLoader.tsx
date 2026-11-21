import React from "react";

export const SkeletonLoader: React.FC = () => (
  <div className="p-4 space-y-4">
    {[1, 2, 3, 4, 5].map((i) => (
      <div
        key={i}
        className="grid grid-cols-2 sm:grid-cols-[48px_1.5fr_1fr_2fr_1.5fr_120px_180px] gap-4"
      >
        {[1, 2, 3, 4, 5, 6, 7].map((j) => (
          <div
            key={j}
            className="h-10 rounded-lg animate-pulse ds-bg-secondary ds-radius-button"
          ></div>
        ))}
      </div>
    ))}
  </div>
);
