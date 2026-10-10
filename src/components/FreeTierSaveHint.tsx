import React from "react";
import { useTranslation } from "react-i18next";
import { useFreeTierUsage } from "../hooks/useFreeTierUsage";

/**
 * Shows the Free bookmark count before a save, then turns into a calm upgrade
 * prompt at the wall. The hook's canAddBookmark value comes from the same
 * LicenseService API used by the save policy, so the pre-save copy cannot
 * claim that another bookmark will fit when it will not.
 */
export const FreeTierSaveHint: React.FC = () => {
  const { t } = useTranslation();
  const { count, limit, isFree, canAddBookmark } = useFreeTierUsage();

  if (!isFree || count === undefined) {return null;}

  const atWall = canAddBookmark === false;
  const percent = Math.min(100, Math.round((count / limit) * 100));

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs ${
        atWall
          ? "border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10"
          : "border-[var(--divider)] bg-[var(--bg-secondary)]"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="ds-text-secondary">
          {t("app_freeMeterLine", {
            used: count,
            limit,
          })}
        </span>
        {atWall ? (
          <button
            type="button"
            className="truncate font-bold ds-text-accent hover:underline"
            onClick={() => window.dispatchEvent(new CustomEvent("forge:open-settings"))}
          >
            {t("app_freeLimitToastAction", "See Pro →")}
          </button>
        ) : (
          <span className="ds-text-muted">{percent}%</span>
        )}
      </div>
      <div
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--divider)]"
        aria-hidden="true"
      >
        <div
          className={`h-full rounded-full ${atWall ? "bg-[var(--accent-primary)]" : "bg-amber-500"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {atWall && (
        <p className="mt-1.5 ds-text-secondary">
          {t(
            "app_freeWallBody",
            "Nothing is lost and nothing broke — only new saves pause. See Pro for unlimited saves.",
          )}
        </p>
      )}
    </div>
  );
};
