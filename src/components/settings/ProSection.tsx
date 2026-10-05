import React, { useEffect, useState } from "react";
import { Crown, Key, BadgeCheck, Loader2, LogOut, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLicenseStore } from "../../store/useLicenseStore";
import { licenseService } from "../../services/LicenseService";
import { LICENSE_CONFIG, isCheckoutConfigured } from "../../constants/license";
import { getActiveProPrice } from "../../constants/pricing";

export const ProSection: React.FC = () => {
  const { t } = useTranslation();
  const entitlements = useLicenseStore((s) => s.entitlements);
  const busy = useLicenseStore((s) => s.busy);
  const error = useLicenseStore((s) => s.error);
  const activate = useLicenseStore((s) => s.activate);
  const deactivate = useLicenseStore((s) => s.deactivate);
  const [keyInput, setKeyInput] = useState("");
  const [storedKey, setStoredKey] = useState<string | null>(() =>
    licenseService.getStoredLicenseKey(),
  );

  const isPro = entitlements.plan === "pro";

  useEffect(() => {
    let active = true;
    void licenseService.getStoredLicenseKeyAsync().then((key) => {
      if (active) {setStoredKey(key);}
    });
    return () => {
      active = false;
    };
  }, []);

  const handleBuy = () => {
    if (!isCheckoutConfigured()) {return;}
    window.open(LICENSE_CONFIG.checkoutUrlPro, "_blank", "noopener,noreferrer");
  };

  const handleActivate = async () => {
    const ok = await activate(keyInput);
    if (ok) {
      setKeyInput("");
      setStoredKey(await licenseService.getStoredLicenseKeyAsync());
    }
  };

  const maskedKey = storedKey
    ? `${storedKey.slice(0, 4)}…${storedKey.slice(-4)}`
    : "";

  return (
    <section data-testid="settings-pro" className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2">
        <Crown className="size-4 text-amber-400" />{" "}
        {t("app_proSectionTitle", "Pro")}
      </h3>

      <div className="space-y-4 p-4 bg-[var(--bg-card)]/50 rounded-xl border border-[var(--divider)]/50">
        {isPro ? (
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <BadgeCheck className="size-6 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">
                  {entitlements.source === "trial"
                    ? t("app_proTrialActive", "Pro trial active")
                    : t("app_proActive", "Pro active")}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {entitlements.source === "trial" &&
                  typeof entitlements.trialDaysRemaining === "number"
                    ? t("app_trialBadge", "Trial · {{count}} {{days}} left", {
                        count: entitlements.trialDaysRemaining,
                        days: t("app_days", "days"),
                      })
                    : entitlements.source === "license" && maskedKey
                      ? `${t("app_proLicenseMasked", "License")} ${maskedKey}`
                      : entitlements.expiresAt
                        ? t("app_proTrialUntil", "Valid until {{date}}", {
                            date: new Date(entitlements.expiresAt).toLocaleDateString(),
                          })
                        : null}
                  {entitlements.source === "license" && entitlements.grace && (
                    <span className="block mt-0.5">
                      {t(
                        "app_proGraceNote",
                        "Offline grace — license re-validation pending.",
                      )}
                    </span>
                  )}
                  {typeof entitlements.activationsLeft === "number" &&
                    entitlements.activationsLeft >= 0 && (
                      <span className="block mt-0.5">
                        {t("app_proActivationsLeft", "Activations left: {{count}}", {
                          count: entitlements.activationsLeft,
                        })}
                      </span>
                    )}
                </p>
              </div>
            </div>
            <button
              onClick={() => void deactivate()}
              disabled={busy}
              className="truncate text-xs flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--divider)] text-[var(--text-muted)] hover:text-red-400 transition-colors disabled:opacity-50"
              aria-label={t("app_proDeactivate", "Deactivate license")}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <LogOut className="size-3.5" />
              )}
              {t("app_proDeactivate", "Deactivate")}
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <Sparkles className="size-6 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">
                  {t("app_proUpgradeTitle", "Unlock BookmarkForge Pro")}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {t(
                    "app_proUpgradeText",
                    "Unlimited bookmarks, P2P sync across 3 devices and local AI. One-time payment, yours forever.",
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={handleBuy}
                disabled={!isCheckoutConfigured()}
                className="truncate bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {t("app_proBuy", "Get Pro — {{price}}", { price: getActiveProPrice() })}
              </button>
            </div>
            {!isCheckoutConfigured() && (
              <p className="text-xs text-[var(--text-muted)]">
                {t(
                  "app_proCheckoutMissing",
                  "Checkout isn't connected yet — add your payment provider checkout URL to complete the purchase.",
                )}
              </p>
            )}

            <div className="pt-2 border-t border-[var(--divider)]/50">
              <label
                htmlFor="license-key-input"
                className="block text-xs text-[var(--text-muted)] mb-1.5"
              >
                {t("app_proHaveLicense", "Already have a license key?")}
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Key className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--text-muted)]" />
                  <input
                    id="license-key-input"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {void handleActivate();}
                    }}
                    placeholder={t("app_proLicensePlaceholder", "License key")}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--divider)] rounded-lg ps-10 pe-4 py-2 text-sm font-mono outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
                <button
                  onClick={() => void handleActivate()}
                  disabled={busy || !keyInput.trim()}
                  className="truncate bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Key className="size-4" />
                  )}
                  {t("app_proActivate", "Activate")}
                </button>
              </div>
              {error && (
                <p className="mt-2 text-xs text-red-400" role="alert">
                  {error}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
};
