import React, { useEffect, useState } from "react";
import { Crown, Key, BadgeCheck, Loader2, LogOut, Sparkles, Copy, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLicenseStore } from "../../store/useLicenseStore";
import { licenseService } from "../../services/LicenseService";
import { LICENSE_CONFIG, isCheckoutConfigured } from "../../constants/license";
import { getActiveProPrice } from "../../constants/pricing";
import { logger } from "../../utils/logger";
import {
  getAffiliateStats,
  type AffiliateStats,
} from "../../services/AffiliateService";

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
  // Referral data is null until the server CONFIRMS it: the panel shows no
  // counter and no link while the answer is unknown, instead of rendering
  // zeros and a placeholder link that look authoritative but are not.
  const [affiliateStats, setAffiliateStats] = useState<AffiliateStats | null>(
    null,
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

  // Load the referral link + counters when Pro. The referral API is a paid
  // route, so the request carries the install's signed license proof — the same
  // accessor /entitlement uses, which never exposes the license key. The service
  // reports failures explicitly (network blocked by the firewall, deployment
  // without a Whop credential, rejected or missing proof, provider error); each
  // one leaves the panel without numbers, which is the honest state, and the
  // failure reason is logged by the service.
  useEffect(() => {
    if (!isPro) {
      setAffiliateStats(null);
      return;
    }
    let active = true;
    void (async () => {
      const proof = await licenseService.getAiSessionProof();
      const result = await getAffiliateStats(licenseService.getDeviceId(), proof);
      if (!active) {return;}
      setAffiliateStats(result.ok ? result.data : null);
    })();
    return () => {
      active = false;
    };
  }, [isPro]);

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

  // Single source of the fallback referral call-to-action: shown while the
  // share link is unknown (still loading, offline, firewall-blocked, provider
  // error) and when the deployment can report counters but has no plan id to
  // build a checkout link with. It never stands in for a link we do not have.
  const affiliateDashboardLink = (
    <a
      href="https://whop.com/dashboard/affiliates"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
    >
      <Key className="size-3.5" />
      {t("app_proGetAffiliateLink", "Get Affiliate Link")}
    </a>
  );

  return (
    <section data-testid="settings-pro" className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2">
        <Crown className="size-4 text-amber-400" />{" "}
        {t("app_proSectionTitle", "Pro")}
      </h3>

      <div className="space-y-4 p-4 bg-[var(--bg-card)]/50 rounded-xl border border-[var(--divider)]/50">
        {isPro ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <BadgeCheck className="size-6 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">
                    {entitlements.source === "trial"
                      ? t("app_proTrialActive", "Pro active")
                      : t("app_proActive", "Pro active")}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {entitlements.source === "license" && maskedKey
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

            {/* Affiliate Section */}
            <div className="pt-4 border-t border-[var(--divider)]/50">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="size-4 text-amber-400" />
                <p className="text-sm font-semibold">
                  {t("app_proAffiliateTitle", "Earn with Referrals")}
                </p>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                {t(
                  "app_proAffiliateDesc",
                  "Share your affiliate link and earn 50% commission on every Pro sale. Get your link from Whop dashboard.",
                )}
              </p>
              {affiliateStats ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-muted)]">
                      {t("app_proAffiliateTotalReferrals", "Total Referrals")}:
                    </span>
                    <span className="font-semibold">
                      {affiliateStats.totalReferrals}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-muted)]">
                      {t("app_proAffiliateTotalEarnings", "Total Earnings")}:
                    </span>
                    <span className="font-semibold text-green-400">
                      {affiliateStats.totalEarnings}
                    </span>
                  </div>
                  {affiliateStats.referralLink ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        aria-label={t(
                          "app_proGetAffiliateLink",
                          "Get Affiliate Link",
                        )}
                        value={affiliateStats.referralLink}
                        className="flex-1 text-xs bg-[var(--bg-card)] border border-[var(--divider)] rounded px-3 py-2"
                      />
                      <button
                        onClick={() => {
                          // Report a refused clipboard write instead of
                          // discarding it: the user thinks the link was copied.
                          void navigator.clipboard
                            .writeText(affiliateStats.referralLink ?? "")
                            .catch((err) => {
                              logger.warn(
                                "[ProSection] Clipboard write failed",
                                { error: err },
                              );
                            });
                        }}
                        aria-label={t(
                          "app_proGetAffiliateLink",
                          "Get Affiliate Link",
                        )}
                        className="text-xs flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--divider)] text-[var(--text-muted)] hover:text-cyan-400 transition-colors"
                      >
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    affiliateDashboardLink
                  )}
                  <a
                    href="https://whop.com/dashboard/affiliates"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    <ExternalLink className="size-3.5" />
                    {t("app_proAffiliateDashboard", "View Dashboard")}
                  </a>
                </div>
              ) : (
                affiliateDashboardLink
              )}
            </div>
          </>
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
                    "Unlimited bookmarks, P2P sync across 5 devices and local AI. One-time payment, yours forever.",
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

            <div className="pt-2 border-t border-[var(--divider)]/50">
              <p className="text-xs text-[var(--text-muted)] mb-2">
                {t("app_proDonate", "Support the project with a donation")}
              </p>
              <a
                href="https://ko-fi.com/M0Q528TAFF"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2"
              >
                <img
                  style={{ border: "0px", height: "36px" }}
                  src="https://storage.ko-fi.com/cdn/kofi5.png?v=6"
                  alt="Buy Me a Coffee at ko-fi.com"
                />
              </a>
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
