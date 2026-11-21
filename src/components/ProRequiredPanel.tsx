import React from "react";
import { motion } from "motion/react";
import { ShieldCheck, ArrowRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getActiveProPrice,
  PRICING_CONFIG,
} from "../constants/pricing";

interface ProRequiredPanelProps {
  /** Short label of the feature that was reached, e.g. "P2P sync". */
  feature?: string;
  /**
   * Why the surface is unavailable — selects the body copy: "license" sells
   * the upgrade (official build, Free session); "build" explains the Open
   * Core absence. Defaults to "build", the boundary's historical trigger.
   */
  reason?: "license" | "build";
  onClose: () => void;
  /** Navigate to the Pro section (Settings modal opens via the bridge). */
  onSeePro: () => void;
}

/**
 * The "Available in Pro" page shown when a Pro surface is reached in a Core
 * (Open Core) build — either because the entitlement gate rejected the load
 * (`ProUnavailableError`) or because the build's placeholder pair was actually
 * touched (the `open-core:pro-reached` event).
 *
 * Design stance: explain, then sell. The panel names what was reached, says
 * plainly that it exists in Pro, and offers the upgrade — the same price and
 * refund terms the Free-tier wall shows, read from PRICING_CONFIG so the copy
 * can never drift from the pricing table.
 */
export const ProRequiredPanel: React.FC<ProRequiredPanelProps> = ({
  feature,
  reason = "build",
  onClose,
  onSeePro,
}) => {
  const { t } = useTranslation();
  const price = getActiveProPrice();
  const refundDays = PRICING_CONFIG.lifetimeVersioned.refundDays;

  return (
    <div
      className="ds-modal-overlay z-[600] p-4 font-sans"
      role="dialog"
      aria-modal="true"
      aria-label={t("app_proRequiredTitle")}
    >
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="max-w-md mx-auto mt-[12vh] rounded-2xl border border-[var(--divider)] ds-bg-secondary shadow-xl overflow-hidden"
      >
        <div className="relative p-5 md:p-6">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("app_proRequiredDismiss", "Close")}
            className="absolute top-3 end-3 p-1.5 rounded-lg ds-text-muted hover:ds-bg-tertiary transition-colors"
          >
            <X className="size-4" />
          </button>

          <div className="flex items-start gap-4">
            <div className="shrink-0 size-12 rounded-xl bg-[var(--accent-primary)]/15 flex items-center justify-center border border-[var(--accent-primary)]/25">
              <ShieldCheck className="size-6 ds-text-accent" />
            </div>
            <div className="flex-1 min-w-0 pe-6">
              <h2 className="text-base font-bold ds-text-primary mb-1 truncate">
                {feature
                  ? t("app_proRequiredFeatureTitle", "{{feature}} is part of Pro", { feature })
                  : t("app_proRequiredTitle", "Available in Pro")}
              </h2>
              <p className="text-sm ds-text-secondary leading-relaxed mb-4 line-clamp-5">
                {reason === "license"
                  ? t(
                      "app_proRequiredLicenseBody",
                      "That one feature is part of Pro and unlocks with a one-time license — your vault, search and export keep working exactly as they are.",
                    )
                  : t(
                      "app_proRequiredBody",
                      "This build ships without the Pro implementation, so this feature stays quiet instead of pretending to work. Everything else — your vault, search and export — is unaffected.",
                    )}
              </p>

              <ul className="space-y-1.5 mb-4">
                <li className="flex items-center gap-2 text-sm ds-text-primary">
                  <ArrowRight className="size-4 shrink-0 ds-text-accent" />
                  {t(
                    "app_proRequiredGetLicense",
                    "Get a license once — no subscription",
                  )}
                </li>
                <li className="flex items-center gap-2 text-sm ds-text-primary">
                  <ArrowRight className="size-4 shrink-0 ds-text-accent" />
                  {t(
                    "app_proRequiredRefund",
                    "{{refundDays}}-day money-back guarantee",
                    { refundDays },
                  )}
                </li>
              </ul>

              <button
                type="button"
                onClick={onSeePro}
                className="w-full py-3 rounded-xl text-white font-bold text-sm transition-transform hover:scale-[1.01] active:scale-[0.99] shadow-md ds-accent-filled ds-shadow-accent truncate max-w-full"
              >
                {t("app_freeWallCta", "See Pro — {{price}} once", { price })}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
