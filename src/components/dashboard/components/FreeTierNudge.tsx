import React from "react";
import { motion } from "motion/react";
import { ShieldCheck, Infinity as InfinityIcon, Cpu, MonitorSmartphone, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getActiveProPrice,
  getProDeviceLimit,
  PRICING_CONFIG,
} from "../../../constants/pricing";
import { DURATION_COLLAPSE } from "../../../constants/motion";
import { CollapsibleSurface } from "./CollapsibleSurface";

interface FreeTierNudgeProps {
  show: boolean;
  onDismiss: () => void;
  onSeePro: () => void;
}

/**
 * The one full Pro pitch, shown once: the first time a Free user's save is
 * blocked at the 1,000 wall. Design stance (design doc): this banner is an
 * *explanation* first, a sale second — it opens by defusing the scare
 * ("nothing is lost, nothing broke") before presenting what Pro adds.
 * Price and device numbers are read from PRICING_CONFIG at render time so
 * the copy can never drift from the pricing table.
 */
export const FreeTierNudge: React.FC<FreeTierNudgeProps> = ({
  show,
  onDismiss,
  onSeePro,
}) => {
  const { t } = useTranslation();
  const price = getActiveProPrice();
  const deviceLimit = getProDeviceLimit();
  const refundDays = PRICING_CONFIG.lifetimeVersioned.refundDays;

  return (
    <CollapsibleSurface show={show} className="mb-6" testId="free-tier-nudge-surface">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: show ? 1 : 0, y: show ? 0 : -10 }}
        transition={{ duration: DURATION_COLLAPSE }}
        style={{ pointerEvents: show ? "auto" : "none" }}
      >
        <div className="relative overflow-hidden rounded-2xl border border-[var(--divider)] ds-bg-secondary">
          <div className="relative p-5 md:p-6">
            <div className="flex items-start gap-4">
              <div className="shrink-0 size-12 rounded-xl bg-[var(--accent-primary)]/15 flex items-center justify-center border border-[var(--accent-primary)]/25">
                <ShieldCheck className="size-6 ds-text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold ds-text-primary mb-1">
                  {t(
                    "app_freeWallTitle",
                    "You've reached 1,000 — Free's limit",
                  )}
                </h3>
                <p className="text-sm ds-text-secondary leading-relaxed mb-4">
                  {t(
                    "app_freeWallBody",
                    "Nothing is lost and nothing broke. Reading, search and export are exactly as they were — only new saves pause.",
                  )}
                </p>

                <p className="text-xs font-bold uppercase tracking-widest ds-text-muted mb-2">
                  {t("app_freeWallProLifts", "Pro lifts the cap:")}
                </p>
                <ul className="space-y-1.5 mb-4">
                  <li className="flex items-center gap-2 text-sm ds-text-primary">
                    <InfinityIcon className="size-4 shrink-0 ds-text-accent" />
                    {t(
                      "app_freeWallProUnlimited",
                      "Unlimited saves — the ceiling disappears",
                    )}
                  </li>
                  <li className="flex items-center gap-2 text-sm ds-text-primary">
                    <MonitorSmartphone className="size-4 shrink-0 ds-text-accent" />
                    {t(
                      "app_freeWallProSync",
                      "P2P sync between your own devices (up to {{limit}})",
                      { limit: deviceLimit },
                    )}
                  </li>
                  <li className="flex items-center gap-2 text-sm ds-text-primary">
                    <Cpu className="size-4 shrink-0 ds-text-accent" />
                    {t(
                      "app_freeWallProLocalAi",
                      "AI that runs inside your computer — no API keys, nothing sent anywhere",
                    )}
                  </li>
                </ul>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={onSeePro}
                    className="truncate inline-flex items-center gap-2 px-4 py-2 rounded-xl ds-accent-filled text-white text-sm font-bold shadow-md transition-all hover:scale-105 active:scale-95"
                  >
                    {t(
                      "app_freeWallCta",
                      "See Pro — {{price}} once",
                      { price },
                    )}
                  </button>
                  <button
                    onClick={onDismiss}
                    className="truncate inline-flex items-center gap-1.5 px-3 py-2 rounded-xl ds-text-secondary text-sm font-medium hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    <X className="size-4" />
                    {t("app_freeWallKeepFree", "Keep Free")}
                  </button>
                </div>

                <p className="mt-3 text-xs ds-text-muted">
                  {t(
                    "app_freeWallTrust",
                    "One-time payment · yours forever · {{days}}-day money-back",
                    { days: refundDays },
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </CollapsibleSurface>
  );
};
