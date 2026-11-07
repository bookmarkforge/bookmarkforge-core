import React, { useEffect, useState } from "react";
import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { themeService } from "../../services/ThemeService";

interface AppearanceSectionProps {
  globalFont: "sans-serif" | "serif" | "monospace";
  setGlobalFont: (font: "sans-serif" | "serif" | "monospace") => void;
  globalFontSize: number;
  setGlobalFontSize: (size: number) => void;
  lang: string;
  setLang: (lang: string) => void;
}

const LANGUAGES = [
  { value: "ar", label: "العربية (Arabic)" },
  { value: "bg", label: "Български (Bulgarian)" },
  { value: "cs", label: "Čeština (Czech)" },
  { value: "da", label: "Dansk (Danish)" },
  { value: "de", label: "Deutsch (German)" },
  { value: "el", label: "Ελληνικά (Greek)" },
  { value: "en", label: "English" },
  { value: "es", label: "Español (Spanish)" },
  { value: "fi", label: "Suomi (Finnish)" },
  { value: "fr", label: "Français (French)" },
  { value: "he", label: "עברית (Hebrew)" },
  { value: "hi", label: "हिन्दी (Hindi)" },
  { value: "hr", label: "Hrvatski (Croatian)" },
  { value: "hu", label: "Magyar (Hungarian)" },
  { value: "id", label: "Bahasa Indonesia (Indonesian)" },
  { value: "it", label: "Italiano (Italian)" },
  { value: "ja", label: "日本語 (Japanese)" },
  { value: "ko", label: "한국어 (Korean)" },
  { value: "nl", label: "Nederlands (Dutch)" },
  { value: "no", label: "Norsk (Norwegian)" },
  { value: "pl", label: "Polski (Polish)" },
  { value: "pt", label: "Português (Portuguese)" },
  { value: "ro", label: "Română (Romanian)" },
  { value: "ru", label: "Русский (Russian)" },
  { value: "sv", label: "Svenska (Swedish)" },
  { value: "th", label: "ไทย (Thai)" },
  { value: "tr", label: "Türkçe (Turkish)" },
  { value: "uk", label: "Українська (Ukrainian)" },
  { value: "vi", label: "Tiếng Việt (Vietnamese)" },
  { value: "zh", label: "中文 (Chinese)" },
];

export const AppearanceSection: React.FC<AppearanceSectionProps> = ({
  globalFont,
  setGlobalFont,
  globalFontSize,
  setGlobalFontSize,
  lang,
  setLang,
}) => {
  const { t } = useTranslation();
  const [themeCss, setThemeCss] = useState("");
  const [themeStatus, setThemeStatus] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    const persisted = themeService.load();
    if (persisted) {
      setThemeCss(persisted);
      themeService.apply(persisted);
    }
    // Persisted theme is local-only; load once on mount.
  }, []);

  const applyTheme = () => {
    const result = themeService.apply(themeCss);
    if (result.ok) {
      themeService.save(themeCss);
      setThemeStatus({ ok: true, text: t("app_userThemeApplied") });
    } else {
      setThemeStatus({
        ok: false,
        text: `${t("app_userThemeError")}: ${result.reason ?? ""}`,
      });
    }
  };

  const clearTheme = () => {
    themeService.clear();
    themeService.removePersisted();
    setThemeCss("");
    setThemeStatus(null);
  };

  return (
    <section data-testid="settings-appearance" className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2 ds-text-muted ds-text-tiny">
        <Palette className="size-4" /> {t("app_appearance")}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <span className="text-xs ds-text-secondary">{t("app_language")}</span>
          <select
            aria-label={t("app_language")}
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="w-full px-3 py-2.5 text-sm outline-none transition-all ds-radius-button ds-bg-input ds-border-inactive ds-text-primary"
          >
            {LANGUAGES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        <div className="space-y-2">
          <span className="text-xs ds-text-secondary">
            {t("app_fontFamily")}
          </span>
          <div className="flex p-1 ds-bg-input ds-border-inactive ds-radius-button">
            {(["sans-serif", "serif", "monospace"] as const).map((font) => (
              <button
                key={font}
                onClick={() => setGlobalFont(font)}
                className="truncate flex-1 p-2 ds-radius-button text-xs transition-all"
                style={{
                  background:
                    globalFont === font ? "var(--bg-card)" : "transparent",
                  color:
                    globalFont === font
                      ? "var(--text-primary)"
                      : "var(--text-muted)",
                }}
              >
                {font.charAt(0).toUpperCase() + font.slice(1, 4)}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <span className="text-xs ds-text-secondary">{t("app_fontSize")}</span>
          <div className="flex items-center gap-2 p-2 ds-bg-input ds-border-inactive ds-radius-button">
            <button
              onClick={() =>
                setGlobalFontSize(Math.max(12, globalFontSize - 1))
              }
              className="size-8 flex items-center justify-center transition-colors ds-radius-button ds-bg-card ds-text-primary"
            >
              -
            </button>
            <span className="flex-1 text-center text-sm font-mono ds-text-primary">
              {globalFontSize}px
            </span>
            <button
              onClick={() =>
                setGlobalFontSize(Math.min(24, globalFontSize + 1))
              }
              className="size-8 flex items-center justify-center transition-colors ds-radius-button ds-bg-card ds-text-primary"
            >
              +
            </button>
          </div>
        </div>
      </div>
      <div className="space-y-2 pt-4 mt-4 border-t border-[var(--divider)]">
        <span className="text-xs ds-text-secondary">{t("app_userTheme")}</span>
        <textarea
          aria-label={t("app_userTheme")}
          placeholder={t("app_userThemePlaceholder")}
          value={themeCss}
          onChange={(e) => setThemeCss(e.target.value)}
          rows={5}
          spellCheck={false}
          className="w-full px-3 py-2.5 text-xs font-mono outline-none transition-all ds-radius-button ds-bg-input ds-border-inactive ds-text-primary resize-y"
        />
        {themeStatus && (
          <p
            className={`text-xs ${
              themeStatus.ok ? "ds-text-success" : "ds-text-danger"
            }`}
          >
            {themeStatus.text}
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={applyTheme}
            className="px-3 py-2 text-xs font-medium truncate ds-bg-accent-primary ds-text-on-accent ds-radius-button transition-all"
          >
            {t("app_userThemeApply")}
          </button>
          <button
            onClick={clearTheme}
            className="px-3 py-2 text-xs font-medium truncate ds-bg-card ds-border-inactive ds-text-secondary ds-radius-button transition-all"
          >
            {t("app_userThemeClear")}
          </button>
        </div>
      </div>
    </section>
  );
};
