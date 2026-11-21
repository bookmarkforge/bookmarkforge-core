import React, { useState } from "react";
import { Globe, Trash2, Plus, Loader2, ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNetworkWhitelist } from "../../hooks/useNetworkWhitelist";
import { useGuardedAction } from "../../hooks/useGuardedAction";

export const NetworkPermissionsSection: React.FC = () => {
  const { t } = useTranslation();
  const { origins, loading, add, remove } = useNetworkWhitelist();
  const [newOrigin, setNewOrigin] = useState("");
  const { run: runAdd } = useGuardedAction<void>({
    blockReentry: false,
    onSuccess: () => setNewOrigin(""),
  });

  const handleAdd = () => {
    const trimmed = newOrigin.trim();
    if (!trimmed) {return;}
    runAdd(() => add(trimmed));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAdd();
    }
  };

  return (
    <section data-testid="settings-network-permissions" className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2">
        <ShieldOff className="size-4" />{" "}
        {t("app_networkPermissions", "Network Permissions")}
      </h3>

      <div className="space-y-4 p-4 bg-[var(--bg-card)]/50 rounded-xl border border-[var(--divider)]/50">
        <p className="text-xs text-[var(--text-muted)]">
          {t(
            "app_networkPermissionsHelp",
            "Manage which external servers BookmarkForge can connect to. All unauthorized requests are blocked by default.",
          )}
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Globe className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--text-muted)]" />
            <input
              type="text"
              aria-label={t("app_addOriginPlaceholder", "https://example.com")}
              value={newOrigin}
              onChange={(e) => setNewOrigin(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("app_addOriginPlaceholder", "https://example.com")}
              className="w-full bg-[var(--bg-primary)] border border-[var(--divider)] rounded-lg ps-10 pe-4 py-2 text-sm text-white outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={loading || !newOrigin.trim()}
            className="truncate bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            <Plus className="size-4" />
            {t("app_addOrigin", "Add")}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-[var(--text-muted)]" />
          </div>
        ) : origins.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] text-center py-4">
            {t(
              "app_noWhitelistedOrigins",
              "No whitelisted origins. Only blob:, data:, and local resources are allowed.",
            )}
          </p>
        ) : (
          <ul className="space-y-2">
            {origins.map((origin) => (
              <li
                key={origin}
                className="flex items-center justify-between p-3 bg-[var(--bg-secondary)]/30 rounded-lg border border-[var(--divider)]/50"
              >
                <span className="text-sm text-[var(--text-muted)] font-mono truncate">
                  {origin}
                </span>
                <button
                  onClick={() => remove(origin)}
                  disabled={loading}
                  className="text-[var(--text-muted)] hover:ds-text-danger transition-colors p-1 disabled:opacity-50"
                  aria-label={t("app_removeOrigin", "Remove")}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
