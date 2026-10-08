import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../i18n";
import { logger } from "../utils/logger";

const LANGUAGE_MENU_ID = "header-language-menu";

/**
 * Inline SVG copy of the lucide `Globe` icon (stroke 2, round caps, 24×24
 * viewBox). This component renders on the PRE-UNLOCK confirmation screen
 * (SecurityConfirmation imports LanguageSelector), so a static lucide-react
 * import here would drag the ui-runtime vendor chunk (~910 kB) into the
 * security-gate first paint — the exact regression `check-chunk-boundaries`
 * guards against. Hand-rolled SVG keeps the same geometry with zero
 * third-party weight; post-unlock screens may keep importing lucide.
 */
function GlobeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid="icon-Globe"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

/**
 * Top-bar language picker.
 *
 * Re-renders reactively on language change thanks to `useTranslation()`,
 * which subscribes to the `languageChanged` event internally. Read the
 * current language from `i18n.language` (also kept in sync by the same
 * subscription) when computing the active-state highlight.
 *
 * `i18n.changeLanguage(code)` is fire-and-forget — react-i18next queues
 * the new translations when async-loaded by the HTTP backend; users see
 * the new active-state underline immediately while strings update.
 *
 * Persistence to localStorage and mirror into `usePreferencesStore` are
 * handled centrally in `src/i18n.ts`'s `languageChanged` listener, so this
 * component does not maintain any local mirror state, no forceUpdate, and
 * no manual `i18n.on('languageChanged')` subscription.
 *
 * @see src/i18n.ts — languageChanged listener (single sync point)
 * @see src/components/Header.tsx — usage: `<LanguageSelector />`
 */
export function LanguageSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { t, i18n } = useTranslation();

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (code: string): void => {
    logger.debug(`[LanguageSelector] Changing language to: ${code}`);
    // Fire-and-forget; the languageChanged listener in src/i18n.ts mirrors
    // this into localStorage and usePreferencesStore.
    void i18n.changeLanguage(code);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        data-testid="language-select"
        className="p-2 min-h-11 min-w-11 inline-flex items-center justify-center ds-ghost-btn-icon focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] ds-radius-item"
        title={t("app_language", "Language")}
        aria-label={t("app_language", "Language")}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? LANGUAGE_MENU_ID : undefined}
      >
        <GlobeIcon className="size-4" />
      </button>
      {isOpen && (
        <div
          id={LANGUAGE_MENU_ID}
          className="absolute end-0 top-full mt-1 overflow-hidden min-w-[180px] z-50 py-1 max-h-[300px] overflow-y-auto ds-radius-card ds-bg-card ds-border ds-shadow-accent-lg"
          role="menu"
          aria-label={t("app_language", "Language")}
        >
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isActive = i18n.language === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => { handleSelect(lang.code); }}
                className={`truncate w-full px-4 py-2.5 text-start text-xs font-semibold transition-colors flex items-center justify-between`}
                style={{
                  color: isActive
                    ? "var(--accent-primary)"
                    : "var(--text-secondary)",
                  background: isActive
                    ? "var(--state-hover-bg)"
                    : "transparent",
                }}
                role="menuitem"
                tabIndex={0}
                data-language-code={lang.code}
              >
                <span className="truncate">{lang.name}</span>
                {isActive && (
                  <span className="text-xs ds-text-accent">
                    {t("app_selected", "?")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
