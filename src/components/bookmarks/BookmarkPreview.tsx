import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Image as ImageIcon } from "lucide-react";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { metadataService } from "../../services/MetadataService";
import { sanitizeUrl } from "../../services/SanitizationService";

interface OgData {
  title?: string;
  description?: string;
  image?: string;
}

export const BookmarkPreview = ({ url }: { url: string }) => {
  const { t } = useTranslation();
  const [ogData, setOgData] = useState<OgData | null>(null);

  // Per-url metadata fetch — useGuardedDataLoad: the guard's signal aborts
  // the in-flight fetchMetadata when the url changes or the component
  // unmounts, and the empty-url branch cancels + clears the preview.
  const {
    load,
    loading: isLoading,
    cancel,
  } = useGuardedDataLoad<OgData>(
    async (signal) => {
      // Zero-knowledge: fetch metadata directly from the target site via
      // MetadataService (no third-party proxy like microlink). Image previews
      // are intentionally omitted to avoid leaking the URL to external image CDNs.
      const meta = await metadataService.fetchMetadata(url, signal);
      return {
        title: meta.title || undefined,
        description: meta.description || undefined,
      };
    },
    {
      autoLoad: false,
      initialLoading: false,
      onSuccess: setOgData,
    },
  );

  React.useEffect(() => {
    if (!url) {
      cancel();
      setOgData(null);
      return;
    }
    void load();
  }, [url, load, cancel]);

  if (isLoading) {
    return (
      <div className="p-6 text-sm w-full max-w-md flex flex-col items-center justify-center h-48 animate-pulse shadow-sm ds-radius-card ds-bg-card ds-border ds-text-muted">
        <Loader2 className="size-6 mb-2 animate-spin ds-text-accent" />
        {t("app_loading")}
      </div>
    );
  }

  if (!ogData || (!ogData.title && !ogData.image && !ogData.description)) {
    return (
      <div className="p-6 text-sm w-full max-w-md flex flex-col items-center justify-center h-48 shadow-sm ds-radius-card ds-bg-card ds-border ds-text-muted">
        <ImageIcon className="size-8 mb-2 ds-text-muted" />
        {t("app_noPreview")}
      </div>
    );
  }

  return (
    <div className="overflow-hidden w-full max-w-md shadow-sm hover:shadow-md transition-shadow duration-300 group ds-radius-card ds-bg-card ds-border">
      {ogData.image ? (
        <div className="relative h-40 overflow-hidden">
          <img
            src={sanitizeUrl(ogData.image)}
            alt={ogData.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ds-bg-overlay" />
        </div>
      ) : (
        <div className="h-40 flex items-center justify-center ds-bg-secondary">
          <ImageIcon className="size-10 ds-text-muted" />
        </div>
      )}
      <div className="p-5">
        <h3 className="font-semibold mb-2 line-clamp-2 leading-tight ds-text-primary">
          {ogData.title || url}
        </h3>
        {ogData.description && (
          <p className="text-sm line-clamp-3 leading-relaxed ds-text-secondary">
            {ogData.description}
          </p>
        )}
      </div>
    </div>
  );
};
