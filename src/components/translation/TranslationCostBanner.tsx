import { useTranslation } from "react-i18next";
import { CheckCircle2, Sparkles } from "lucide-react";
import {
  announceProUnavailable,
  ProUnavailableError,
} from "../../services/pro-access";
import { getActiveProPrice } from "../../constants/pricing";

interface TranslationCostBannerProps {
  totalUSD: number;
  savedUSD: number;
  isFreePlan: boolean;
}

/** Currency formatting that keeps sub-cent amounts visible. */
function formatUSD(amount: number, locale: string): string {
  if (!Number.isFinite(amount)) {return "$0.00";}
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2,
    }).format(amount);
  } catch {
    // INTENTIONAL SILENCE: an invalid locale tag must not blank the meter;
    // falling back to a plain dollar string is strictly better than throwing
    // inside a render.
    return `$${amount.toFixed(2)}`;
  }
}

/**
 * The conversion surface:
 *
 *  - Free plan, spent money → "you have spent $X on this API; Pro is $59 once
 *    and local translation is free forever", with the Pro panel as the CTA.
 *  - Pro plan, local engine → what this run SAVED versus the cloud provider.
 *
 * It never fabricates a number: both amounts come from the pipeline's cost
 * meter, which reads the app's real spend ledger.
 */
export default function TranslationCostBanner({
  totalUSD,
  savedUSD,
  isFreePlan,
}: TranslationCostBannerProps) {
  const { t, i18n } = useTranslation();
  const price = getActiveProPrice();

  if (!isFreePlan) {
    if (savedUSD <= 0) {return null;}
    return (
      <div className="flex items-center gap-2 border-t border-[var(--divider)] bg-emerald-500/5 px-4 py-2 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {t("translation_savedWithLocal", {
            amount: formatUSD(savedUSD, i18n.language),
          })}
        </span>
      </div>
    );
  }

  if (totalUSD <= 0) {return null;}

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--divider)] bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
        <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          {t("translation_freeBanner", {
            amount: formatUSD(totalUSD, i18n.language),
            price,
          })}
        </span>
      </div>
      <button
        type="button"
        onClick={() =>
          announceProUnavailable(
            new ProUnavailableError("TranslationLocalEngine", "no-license"),
          )
        }
        className="truncate shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition-colors"
      >
        {t("translation_proCta")}
      </button>
    </div>
  );
}
