import { useState, useCallback, useRef, useEffect } from "react";
import { Shield, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import {
  getConsent,
  hasConsentDecision as hasStoredConsentDecision,
  setConsent,
  type ConsentToggles,
} from "../services/ConsentService";

// ADR-030: optional purposes are independent and default to opt-in only
// after the user explicitly selects them.

interface ConsentBannerProps {
  onConsentDecided: (consent: ConsentToggles) => void;
}

/**
 * Read the current consent state from storage.
 * Returns null if no consent decision has been made yet.
 */
export function getStoredConsent(): ConsentToggles | null {
  return getConsent();
}

/**
 * Check if the user has already made a consent decision.
 */
export function hasConsentDecision(): boolean {
  return hasStoredConsentDecision();
}

/**
 * Persist consent toggles to storage.
 * Also mirrors only the error-reporting choice to the legacy local storage
 * key. A client-events decision must never authorize local error storage.
 */
function persistConsent(consent: ConsentToggles): void {
  setConsent(consent);
}

/**
 * ConsentBanner — GDPR/CCPA compliant consent management.
 *
 * Shows on first visit with three granular toggles:
 * - Analytics: local-only product usage metrics (retention, engagement)
 * - Error Reporting: local IndexedDB error storage for diagnostics
 * - Client Events: operational events forwarded to self-hosted companion server
 *
 * Design:
 * - Bottom-anchored banner with slide-up animation
 * - Collapsible "Manage preferences" for granular control
 * - Accept All / Reject All for one-click consent
 * - Privacy policy link
 * - Focus-trapped when expanded for keyboard accessibility
 */
export const ConsentBanner: React.FC<ConsentBannerProps> = ({
  onConsentDecided,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [toggles, setToggles] = useState<ConsentToggles>({
    analytics: false,
    errorReporting: false,
    clientEvents: false,
  });
  const bannerRef = useRef<HTMLDivElement>(null);

  // Focus trap when expanded
  useFocusTrap(isExpanded);

  // Auto-focus the banner on mount for screen reader announcement
  useEffect(() => {
    bannerRef.current?.focus();
  }, []);

  const handleToggle = useCallback((key: keyof ConsentToggles) => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleAcceptAll = useCallback(() => {
    const consent: ConsentToggles = {
      analytics: true,
      errorReporting: true,
      clientEvents: true,
    };
    persistConsent(consent);
    onConsentDecided(consent);
  }, [onConsentDecided]);

  const handleRejectAll = useCallback(() => {
    const consent: ConsentToggles = {
      analytics: false,
      errorReporting: false,
      clientEvents: false,
    };
    persistConsent(consent);
    onConsentDecided(consent);
  }, [onConsentDecided]);

  const handleSavePreferences = useCallback(() => {
    persistConsent(toggles);
    onConsentDecided(toggles);
  }, [toggles, onConsentDecided]);

  const toggleLabels: Record<
    keyof ConsentToggles,
    { title: string; description: string }
  > = {
    analytics: {
      title: t("consent_analytics", "Product Analytics"),
      description: t(
        "consent_analytics_desc",
        "Local-only usage metrics (retention, feature usage). Never leaves your browser."
      ),
    },
    errorReporting: {
      title: t("consent_errorReporting", "Error Reporting"),
      description: t(
        "consent_errorReporting_desc",
        "Store error logs locally and, with your consent, send redacted technical errors to a remote diagnostics service. Never your bookmarks, notes, or AI prompts."
      ),
    },
    clientEvents: {
      title: t("consent_clientEvents", "Operational Events"),
      description: t(
        "consent_clientEvents_desc",
        "Forward storage/integrity events to your self-hosted companion server."
      ),
    },
  };

  return (
    <AnimatePresence>
      <motion.div
        ref={bannerRef}
        role="region"
        aria-label={t("consent_bannerLabel", "Privacy consent")}
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed bottom-0 inset-x-0 z-[100] p-4 md:p-6"
      >
        <div className="max-w-2xl mx-auto ds-bg-card ds-border rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="p-5 pb-3">
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5">
                <Shield className="size-5 ds-text-accent" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold ds-text-primary truncate">
                  {t("consent_title", "Your Privacy Matters")}
                </h2>
                <p className="text-xs mt-1 ds-text-secondary leading-relaxed">
                  {t(
                    "consent_description",
                    "BookmarkForge is privacy-first: all data stays on your device. We need your consent for optional diagnostic features that help us improve the app."
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Collapsible preferences */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                id="consent-preferences"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-3 space-y-3">
                  {(Object.keys(toggles) as Array<keyof ConsentToggles>).map(
                    (key) => (
                      <label
                        key={key}
                        className="flex items-start gap-3 p-3 rounded-xl ds-bg-primary cursor-pointer group hover:ds-bg-hover transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={toggles[key]}
                          onChange={() => handleToggle(key)}
                          className="mt-0.5 size-4 rounded border-[var(--border)] text-[var(--accent-primary)] focus:ring-[var(--accent-primary)] accent-[var(--accent-primary)]"
                          aria-label={toggleLabels[key].title}
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium ds-text-primary group-hover:ds-text-accent transition-colors">
                            {toggleLabels[key].title}
                          </span>
                          <p className="text-[11px] mt-0.5 ds-text-muted leading-snug">
                            {toggleLabels[key].description}
                          </p>
                        </div>
                      </label>
                    )
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Actions */}
          <div className="px-5 pb-5 flex flex-wrap items-center gap-2">
            <button
              onClick={handleAcceptAll}
              className="flex-1 min-w-[100px] px-4 py-2.5 text-xs font-bold rounded-xl transition-all ds-bg-accent-primary ds-text-white hover:opacity-90 active:scale-[0.98] truncate"
            >
              {t("consent_acceptAll", "Accept All")}
            </button>
            <button
              onClick={handleRejectAll}
              className="flex-1 min-w-[100px] px-4 py-2.5 text-xs font-bold rounded-xl transition-all ds-bg-primary ds-text-secondary ds-border hover:ds-bg-hover active:scale-[0.98] truncate"
            >
              {t("consent_rejectAll", "Reject All")}
            </button>

            {/* Manage preferences toggle */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 px-3 py-2.5 text-xs font-medium ds-text-secondary hover:ds-text-accent transition-colors truncate"
              aria-expanded={isExpanded}
              aria-controls="consent-preferences"
            >
              {isExpanded
                ? t("consent_hidePreferences", "Hide preferences")
                : t("consent_managePreferences", "Manage preferences")}
              {isExpanded ? (
                <ChevronUp className="size-3" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-3" aria-hidden="true" />
              )}
            </button>

            {/* Save preferences (only shown when expanded) */}
            {isExpanded && (
              <button
                onClick={handleSavePreferences}
                className="w-full px-4 py-2.5 text-xs font-bold rounded-xl transition-all ds-bg-accent-primary ds-text-white hover:opacity-90 active:scale-[0.98] truncate"
              >
                {t("consent_savePreferences", "Save Preferences")}
              </button>
            )}
          </div>

          {/* Privacy policy link */}
          <div className="px-5 pb-4 border-t border-[var(--divider)] pt-3">
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] ds-text-muted hover:ds-text-accent transition-colors"
            >
              {t("consent_privacyPolicy", "Privacy Policy")}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
