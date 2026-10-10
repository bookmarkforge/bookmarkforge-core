import React, { lazy, Suspense, useEffect, useState } from "react";

const ProRequiredPanel = lazy(() =>
  import("./ProRequiredPanel").then((m) => ({ default: m.ProRequiredPanel })),
);

/**
 * Global mount point for the "Available in Pro" experience in a Core
 * (Open Core) build. Two triggers, both machine-originated:
 *
 *   1. `open-core:pro-reached` — dispatched by the export's placeholder
 *      helper the first time an inert Pro surface is actually touched
 *      (detail: { module, property }). Renders immediately: this build
 *      structurally cannot load that implementation.
 *   2. `bmf:pro-unavailable` — dispatched by app code when
 *      `loadProService` rejects with `ProUnavailableError` (Free license
 *      or missing implementation). detail.feature carries a human label.
 *
 * Mounted once in MainApp. The panel itself is lazy so the application
 * entry never carries it; the CTA reuses the `forge:open-settings` bridge
 * so the Pro section is one click from the explanation.
 */
export const ProRequiredBoundary: React.FC = () => {
  const [feature, setFeature] = useState<string | undefined>(undefined);
  // "build" is the only honest copy for the placeholder event (it can only
  // fire in an Open Core export); "license" is set by the loader-rejection
  // event when the error reports a Free session on a full build.
  const [reason, setReason] = useState<"license" | "build">("build");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handlePlaceholderReached = (e: Event) => {
      const detail = (e as CustomEvent<{ module?: string; property?: string }>)
        .detail;
      setFeature(
        detail?.module
          ? `${detail.module}.${detail.property ?? ""}`.replace(/\.$/, "")
          : undefined,
      );
      setReason("build");
      setOpen(true);
    };
    const handleProUnavailable = (e: Event) => {
      const detail = (e as CustomEvent<{ feature?: string; reason?: string }>)
        .detail;
      setFeature(detail?.feature);
      setReason(detail?.reason === "license" ? "license" : "build");
      setOpen(true);
    };

    window.addEventListener(
      "open-core:pro-reached",
      handlePlaceholderReached as EventListener,
    );
    window.addEventListener(
      "bmf:pro-unavailable",
      handleProUnavailable as EventListener,
    );
    return () => {
      window.removeEventListener(
        "open-core:pro-reached",
        handlePlaceholderReached as EventListener,
      );
      window.removeEventListener(
        "bmf:pro-unavailable",
        handleProUnavailable as EventListener,
      );
    };
  }, []);

  if (!open) {return null;}

  return (
    <Suspense fallback={null}>
      <ProRequiredPanel
        feature={feature}
        reason={reason}
        onClose={() => setOpen(false)}
        onSeePro={() => {
          setOpen(false);
          window.dispatchEvent(new CustomEvent("forge:open-settings"));
        }}
      />
    </Suspense>
  );
};
