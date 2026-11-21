import { useEffect, useState } from "react";
import { Database, Trash2, RefreshCw, Loader2, HardDrive } from "lucide-react";
import { resourceManager } from "../../services/ai/ResourceManager";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useGuardedActions } from "../../hooks/useGuardedActions";

interface ModelStatus {
  name: string;
  size: number;
  count: number;
}

export const ModelManagerSection = () => {
  const { t } = useTranslation();
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  // Shared guard (useGuardedActions): each action invalidates the others
  // in flight — a delete during a slow loadStatus discards the stale status,
  // and unmount invalidates everything. `blockReentry: false` on both
  // preserves refresh: a new call supersedes the previous one (load) or
  // completes both (delete, last one wins in toasts), like begin() did.
  const { load: loadStatus, del: deleteModel } = useGuardedActions({
    load: {
      blockReentry: false,
      onSuccess: (status: ModelStatus[]) => {
        setModels(status);
        setLoading(false);
      },
      onError: () => setLoading(false),
    },
    del: {
      blockReentry: false,
      onSuccess: (success: boolean) => {
        if (success) {
          toast.success(
            t("app_modelDeletedSuccess", "Model deleted successfully"),
          );
          void loadStatus.run(() => resourceManager.getHFModelStatus());
        } else {
          toast.error(t("app_modelDeletedError", "Failed to delete model"));
        }
      },
    },
  });

  useEffect(() => {
    Promise.resolve().then(() =>
      loadStatus.run(() => resourceManager.getHFModelStatus()),
    );
  }, []);

  const handleDelete = (name: string) => {
    if (
      confirm(
        t("app_deleteModelConfirm", {
          name,
          defaultValue: `Are you sure you want to delete ${name}? You will need to re-download it to use local AI features.`,
        }),
      )
    ) {
      void deleteModel.run(() => resourceManager.deleteHFModel(name));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) {return "0 B";}
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <section data-testid="settings-model-manager" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2 dark:text-[var(--text-secondary)]">
          <HardDrive className="size-4" />{" "}
          {t("app_localAiModels", "Local AI Models")}
        </h3>
        <button
          onClick={() =>
            loadStatus.run(() => resourceManager.getHFModelStatus())
          }
          disabled={loading}
          aria-label={t("app_refreshModels", "Refresh local AI models")}
          className="truncate p-1.5 hover:bg-[var(--state-hover-bg)] rounded-lg transition-colors text-[var(--text-secondary)] dark:text-[var(--text-muted)]"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </button>
      </div>

      <div className="space-y-2">
        {models.length === 0 ? (
          <div className="p-4 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/30 rounded-xl border border-[var(--divider)] dark:border-[var(--divider)]/50 text-center">
            <p className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-muted)]">
              {t("app_noLocalModels", "No local models found in cache.")}
            </p>
          </div>
        ) : (
          models.map((model) => (
            <div
              key={model.name}
              className="flex items-center justify-between p-4 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/50 rounded-xl border border-[var(--divider)] dark:border-[var(--divider)]/50"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <Database className="size-4 text-blue-400" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-[var(--text-primary)] dark:text-[var(--text-muted)] truncate">
                    {model.name}
                  </h4>
                  <p className="text-[10px] text-[var(--text-secondary)] dark:text-[var(--text-muted)]">
                    {model.count} {t("app_files", "files")}{" "}
                    {t("separator", "•")} {formatSize(model.size)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleDelete(model.name)}
                className="p-2 hover:bg-[var(--color-danger)]/20 text-[var(--text-muted)] hover:ds-text-danger rounded-lg transition-all"
                title={t("app_delete", "Delete")}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))
        )}
      </div>
      <p className="text-[10px] text-[var(--text-muted)] italic">
        {t(
          "app_localModelsHelp",
          "Local models are stored in your browser's Cache Storage. Deleting them frees up disk space.",
        )}
      </p>
    </section>
  );
};
