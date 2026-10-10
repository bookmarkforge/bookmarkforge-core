import React from "react";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getActiveProPrice, PRICING_CONFIG } from "../constants/pricing";

interface ProRequiredStateProps {
  /**
   * Short, user-facing name of the feature that requires Pro, e.g.
   * "Expert agents" or "P2P sync". It names WHAT is gated — never a module.
   */
  feature: string;
  /**
   * Why the surface is unavailable:
   *  - "license": the session has no Pro entitlement (Free plan, expired
   *    key). The copy sells the upgrade.
   *  - "build": an Open Core build reached an inert placeholder. The copy
   *    explains the build instead of pitching (the upgrade CTA stays).
   * Defaults to "license".
   */
  reason?: "license" | "build";
  /**
   * Layout intent:
   *  - "card": stacked block for panels and results areas (default).
   *  - "banner": one-line strip for sections and modals.
   *  - "canvas": roomier card for modal overlays.
   */
  variant?: "card" | "banner" | "canvas";
  /**
   * Opens the Pro section. Defaults to the `forge:open-settings` bridge,
   * the same navigation the Free-tier wall uses (Settings is a modal, not a
   * routed section).
   */
  onSeePro?: () => void;
  className?: string;
}

/**
 * The shared "requires Pro" visual state.
 *
 * Why this exists: surfaces gated behind `ProUnavailableError` used to handle
 * the rejection ad hoc — a red line of text here, a dead button there. This
 * component is the single presentation of that state: it names the feature,
 * says plainly what unlocks it, shows the current one-time price and refund
 * terms read from PRICING_CONFIG (so the copy cannot drift from the pricing
 * table), and links to the Pro section through the settings bridge.
 *
 * The "build" reason renders the Open Core explanation instead of the
 * sales pitch — same component, same CTA, honest copy for that context.
 */
export const ProRequiredState: React.FC<ProRequiredStateProps> = ({
  feature,
  reason = "license",
  variant = "card",
  onSeePro,
  className = "",
}) => {
  const { t } = useTranslation();
  const price = getActiveProPrice();
  const refundDays = PRICING_CONFIG.lifetimeVersioned.refundDays;

  const seePro = () => {
    if (onSeePro) {
      onSeePro();
      return;
    }
    window.dispatchEvent(new CustomEvent("forge:open-settings"));
  };

  const title = t("app_proRequiredFeatureTitle", "{{feature}} is part of Pro", {
    feature,
  });
  const body =
    reason === "build"
      ? t(
          "app_proRequiredBody",
          "This build ships without the Pro implementation, so this feature stays quiet instead of pretending to work. Everything else — your vault, search and export — is unaffected.",
        )
      : t(
          "app_proStateBodyLicense",
          "Unlock it with a one-time Pro license. Everything you have already saved stays untouched.",
        );
  const cta = t("app_freeWallCta", "See Pro — {{price}} once", { price });

  if (variant === "banner") {
    return (
      <div
        data-testid="pro-required-state"
        data-reason={reason}
        className={`flex items-center gap-3 p-3 rounded-xl bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/25 ${className}`}
      >
        <ShieldCheck className="size-4 shrink-0 ds-text-accent" aria-hidden />
        <p className="flex-1 min-w-0 text-xs font-bold ds-text-primary truncate">
          {title}
        </p>
        <button
          type="button"
          onClick={seePro}
          className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white ds-accent-filled truncate max-w-[14rem]"
        >
          {cta}
        </button>
      </div>
    );
  }

  const canvas = variant === "canvas";

  return (
    <div
      data-testid="pro-required-state"
      data-reason={reason}
      className={`rounded-2xl border border-[var(--accent-primary)]/25 bg-[var(--accent-primary)]/5 ${canvas ? "p-6" : "p-5"} ${className}`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`shrink-0 ${canvas ? "size-12" : "size-10"} rounded-xl bg-[var(--accent-primary)]/15 border border-[var(--accent-primary)]/25 flex items-center justify-center`}
        >
          <ShieldCheck
            className={`${canvas ? "size-6" : "size-5"} ds-text-accent`}
            aria-hidden
          />
        </div>
        <div className="flex-1 min-w-0">
          <h3
            className={`${canvas ? "text-base" : "text-sm"} font-bold ds-text-primary mb-1 truncate`}
          >
            {title}
          </h3>
          <p className="text-sm ds-text-secondary leading-relaxed mb-3 line-clamp-3">
            {body}
          </p>

          <ul className="space-y-1.5 mb-4">
            <li className="flex items-center gap-2 text-sm ds-text-primary">
              <ArrowRight className="size-4 shrink-0 ds-text-accent" aria-hidden />
              {t("app_proRequiredGetLicense", "Get a license once — no subscription")}
            </li>
            <li className="flex items-center gap-2 text-sm ds-text-primary">
              <ArrowRight className="size-4 shrink-0 ds-text-accent" aria-hidden />
              {t("app_proRequiredRefund", "{{refundDays}}-day money-back guarantee", {
                refundDays,
              })}
            </li>
          </ul>

          <button
            type="button"
            onClick={seePro}
            className="w-full py-3 rounded-xl text-white font-bold text-sm transition-transform hover:scale-[1.01] active:scale-[0.99] shadow-md ds-accent-filled ds-shadow-accent truncate max-w-full"
          >
            {cta}
          </button>
        </div>
      </div>
    </div>
  );
};
