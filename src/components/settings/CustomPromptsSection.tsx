import React from "react";
import { Shield, Save } from "lucide-react";
import type { TFunction } from "i18next";

interface CustomPromptsSectionProps {
  customPrompts: { summarize: string; tagging: string; chat: string };
  setCustomPrompts: (p: {
    summarize: string;
    tagging: string;
    chat: string;
  }) => void;
  handleSavePrompts: () => void;
  t: TFunction;
}

export const CustomPromptsSection: React.FC<CustomPromptsSectionProps> = ({
  customPrompts,
  setCustomPrompts,
  handleSavePrompts,
  t,
}) => (
  <section data-testid="settings-custom-prompts" className="space-y-4">
    <div className="flex items-center justify-between">
      <h3 className="text-xs font-semibold text-[var(--text-muted)] dark:text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2">
        <Shield className="size-4" /> {t("app_customSystemPrompts")}
      </h3>
      <button
        onClick={handleSavePrompts}
        className="truncate text-xs font-bold bg-[var(--bg-primary)] dark:bg-white text-white dark:text-[var(--text-primary)] px-4 py-2 rounded-lg flex items-center gap-2 transition-transform hover:scale-105 active:scale-95 shadow-sm"
      >
        <Save className="size-3.5" /> {t("app_save")}
      </button>
    </div>
    <div className="space-y-5 p-5 bg-white dark:bg-[var(--bg-primary)] rounded-2xl border border-[var(--divider)] dark:border-[var(--divider)] shadow-sm">
      {(["summarize", "tagging", "chat"] as const).map((key) => (
        <div key={key} className="space-y-2">
          <span className="text-sm font-bold text-[var(--text-primary)] dark:text-[var(--text-accent)]">
            {t(`app_${key}PromptLabel`)}
          </span>
          <textarea
            aria-label={t(`app_${key}PromptLabel`)}
            value={customPrompts[key]}
            onChange={(e) =>
              setCustomPrompts({ ...customPrompts, [key]: e.target.value })
            }
            placeholder={`${t("app_defaultPrompt")}: ${t(`app_${key}PromptPlaceholder`)}`}
            className="w-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] dark:text-white outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 h-24 resize-none shadow-inner leading-relaxed"
          />
        </div>
      ))}
    </div>
  </section>
);
