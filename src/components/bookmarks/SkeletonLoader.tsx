import React from "react";

export const SkeletonLoader: React.FC = () => (
  <div className="p-4 space-y-4">
    {[1, 2, 3, 4, 5].map((i) => (
      <div
        key={i}
        className="grid grid-cols-[48px_1fr_80px] md:grid-cols-[48px_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,1.5fr)_120px_minmax(240px,auto)]"
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
