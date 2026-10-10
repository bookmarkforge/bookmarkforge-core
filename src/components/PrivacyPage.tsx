import { useTranslation } from "react-i18next";
import { ArrowLeft, Shield, ExternalLink } from "lucide-react";

/**
 * PrivacyPage — renders the privacy policy and terms of service inline within
 * the SPA. The same content also exists as a standalone static HTML file
 * (public/privacy-and-terms.html) for non-SPA access.
 *
 * Route: /privacy, /terms
 */
export function PrivacyPage({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8 h-full overflow-auto">
      {/* Back navigation */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm ds-text-secondary hover:ds-text-accent transition-colors mb-6 truncate"
        aria-label={t("privacy_back", "Back to app")}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("privacy_backLabel", "Back to app")}
      </button>

      <article className="ds-text-primary">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Shield className="size-6 ds-text-accent" aria-hidden="true" />
          <h1 className="text-2xl font-bold">{t("privacy_title", "Privacy Policy & Terms of Service")}</h1>
        </div>
        <p className="text-sm ds-text-muted mb-8">
          {t("privacy_lastUpdated", "Last Updated: July 23, 2026")}
        </p>

        {/* ─── PRIVACY POLICY ─────────────────────────────────────── */}
        <section aria-labelledby="privacy-policy">
          <h2 id="privacy-policy" className="text-xl font-semibold mb-4 pb-2 border-b border-[var(--divider)]">
            {t("privacy_heading", "Privacy Policy")}
          </h2>

          <h3 className="text-lg font-medium mt-6 mb-2">{t("privacy_s1_title", "1. Introduction")}</h3>
          <p className="mb-4 leading-relaxed">
            {t("privacy_s1_text", 'BookmarkForge ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we handle your data when you use our application.')}
          </p>
          <p className="mb-4 leading-relaxed">
            <strong>{t("privacy_keyPrinciple", "Key Principle:")}</strong>{" "}
            {t("privacy_keyPrincipleText", "BookmarkForge runs 100% locally on your device. Your bookmarks, notes, documents, and AI conversations are stored in your browser's local database and are never transmitted to our servers.")}
          </p>

          <h3 className="text-lg font-medium mt-6 mb-2">{t("privacy_s2_title", "2. Data We Do NOT Collect")}</h3>
          <p className="mb-2 leading-relaxed">{t("privacy_s2_intro", "We want to be clear about what we do not collect:")}</p>
          <ul className="list-disc list-inside space-y-1 mb-4 leading-relaxed ds-text-secondary">
            <li>{t("privacy_s2_b1", "No bookmarks or URLs are sent to our servers")}</li>
            <li>{t("privacy_s2_b2", "No notes or documents leave your device")}</li>
            <li>{t("privacy_s2_b3", "No AI prompts or responses are logged by us")}</li>
            <li>{t("privacy_s2_b4", "No browsing history is tracked")}</li>
            <li>{t("privacy_s2_b5", "No personal information is required to use the app")}</li>
            <li>{t("privacy_s2_b6", "No analytics are collected by default")}</li>
          </ul>

          <h3 className="text-lg font-medium mt-6 mb-2">{t("privacy_s3_title", "3. Where Your Data Lives")}</h3>
          <p className="mb-2 leading-relaxed">{t("privacy_s3_intro", "All your data is stored locally in your browser using:")}</p>
          <ul className="list-disc list-inside space-y-1 mb-4 leading-relaxed ds-text-secondary">
            <li><strong>IndexedDB</strong> — {t("privacy_s3_b1", "for bookmarks, documents, and settings")}</li>
            <li><strong>{t("privacy_s3_b2_title", "Secure Storage")}</strong> — {t("privacy_s3_b2", "for encrypted keys and passwords")}</li>
            <li><strong>{t("privacy_s3_b3_title", "Service Worker Cache")}</strong> — {t("privacy_s3_b3", "for offline functionality")}</li>
          </ul>
          <p className="mb-4 leading-relaxed">
            {t("privacy_s3_closing", "Your data never leaves your device unless you explicitly export a backup, share your vault, or use a cloud AI provider.")}
          </p>

          <h3 className="text-lg font-medium mt-6 mb-2">{t("privacy_s4_title", "4. Encryption")}</h3>
          <ul className="list-disc list-inside space-y-1 mb-4 leading-relaxed ds-text-secondary">
            <li><strong>AES-GCM-256</strong> — {t("privacy_s4_b1", "encryption for all stored content")}</li>
            <li><strong>Argon2id</strong> — {t("privacy_s4_b2", "(memory-hard KDF) for password-derived keys")}</li>
            <li>{t("privacy_s4_b3", "Keys are derived and stored locally in your browser")}</li>
          </ul>
          <p className="mb-4 leading-relaxed">{t("privacy_s4_closing", "We do not have access to your encryption keys or passwords.")}</p>

          <h3 className="text-lg font-medium mt-6 mb-2">{t("privacy_s5_title", "5. AI Providers")}</h3>
          <p className="mb-2 leading-relaxed">{t("privacy_s5_intro", "When you use AI features:")}</p>
          <ul className="list-disc list-inside space-y-1 mb-4 leading-relaxed ds-text-secondary">
            <li><strong>{t("privacy_s5_b1_title", "Local AI (WebLLM):")}</strong> {t("privacy_s5_b1", "Runs entirely in your browser. No data leaves your device.")}</li>
            <li><strong>{t("privacy_s5_b2_title", "Cloud AI:")}</strong> {t("privacy_s5_b2", "Your prompts are sent directly to the provider. We do not intercept, store, or log these requests.")}</li>
          </ul>

          <h3 className="text-lg font-medium mt-6 mb-2">{t("privacy_s6_title", "6. Your Rights")}</h3>
          <ul className="list-disc list-inside space-y-1 mb-4 leading-relaxed ds-text-secondary">
            <li><strong>{t("privacy_s6_b1_title", "Export:")}</strong> {t("privacy_s6_b1", "Download all your data as an encrypted backup at any time")}</li>
            <li><strong>{t("privacy_s6_b2_title", "Delete:")}</strong> {t("privacy_s6_b2", "Remove all data from the app settings")}</li>
            <li><strong>{t("privacy_s6_b3_title", "No Account Required:")}</strong> {t("privacy_s6_b3", "We don't have accounts, so there's nothing to delete on our end")}</li>
          </ul>

          <h3 className="text-lg font-medium mt-6 mb-2">{t("privacy_s7_title", "7. Contact")}</h3>
          <p className="mb-4 leading-relaxed">
            {t("privacy_s7_text", "For privacy questions or concerns:")}{" "}
            <a
              href="mailto:bookmarkforge@proton.me"
              className="ds-text-accent hover:underline inline-flex items-center gap-1"
            >
              bookmarkforge@proton.me
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </p>
        </section>

        <hr className="my-12 border-[var(--divider)]" />

        {/* ─── TERMS OF SERVICE ───────────────────────────────────── */}
        <section aria-labelledby="terms-of-service">
          <h2 id="terms-of-service" className="text-xl font-semibold mb-4 pb-2 border-b border-[var(--divider)]">
            {t("terms_title", "Terms of Service")}
          </h2>

          <h3 className="text-lg font-medium mt-6 mb-2">{t("terms_s1_title", "1. Acceptance of Terms")}</h3>
          <p className="mb-4 leading-relaxed">
            {t("terms_s1_text", "By using BookmarkForge, you agree to these Terms of Service. If you do not agree, do not use the application.")}
          </p>

          <h3 className="text-lg font-medium mt-6 mb-2">{t("terms_s2_title", "2. Description of Service")}</h3>
          <p className="mb-2 leading-relaxed">{t("terms_s2_intro", "BookmarkForge is a local-first knowledge management application that allows you to:")}</p>
          <ul className="list-disc list-inside space-y-1 mb-4 leading-relaxed ds-text-secondary">
            <li>{t("terms_s2_b1", "Save and organize bookmarks")}</li>
            <li>{t("terms_s2_b2", "Create and edit documents")}</li>
            <li>{t("terms_s2_b3", "Use AI-powered features (locally or via cloud providers)")}</li>
            <li>{t("terms_s2_b4", "Sync data between your devices using peer-to-peer connections")}</li>
          </ul>

          <h3 className="text-lg font-medium mt-6 mb-2">{t("terms_s3_title", "3. Local-First Nature")}</h3>
          <p className="mb-2 leading-relaxed">{t("terms_s3_intro", "You understand and agree that:")}</p>
          <ul className="list-disc list-inside space-y-1 mb-4 leading-relaxed ds-text-secondary">
            <li>{t("terms_s3_b1", "BookmarkForge runs entirely in your browser")}</li>
            <li>{t("terms_s3_b2", "All data is stored locally on your device")}</li>
            <li>{t("terms_s3_b3", "We do not host, store, or backup your data on our servers")}</li>
            <li>{t("terms_s3_b4", "You are responsible for backing up your data using the export feature")}</li>
          </ul>

          <h3 className="text-lg font-medium mt-6 mb-2">{t("terms_s4_title", "4. User Responsibilities")}</h3>
          <ul className="list-disc list-inside space-y-1 mb-4 leading-relaxed ds-text-secondary">
            <li>{t("terms_s4_b1", "Maintain backups of your important data")}</li>
            <li>{t("terms_s4_b2", "Keep your vault password secure (we cannot recover it)")}</li>
            <li>{t("terms_s4_b3", "Use the application in compliance with applicable laws")}</li>
          </ul>

          <h3 className="text-lg font-medium mt-6 mb-2">{t("terms_s5_title", "5. Limitation of Liability")}</h3>
          <p className="mb-4 leading-relaxed">
            {t("terms_s5_text", 'BookmarkForge is provided "as is" without warranties of any kind. We are not liable for data loss due to browser clearing, hardware failures, or errors in AI-generated content.')}
          </p>

          <h3 className="text-lg font-medium mt-6 mb-2">{t("terms_s6_title", "6. Contact")}</h3>
          <p className="mb-4 leading-relaxed">
            {t("terms_s6_text", "For questions about these terms:")}{" "}
            <a
              href="mailto:bookmarkforge@proton.me"
              className="ds-text-accent hover:underline inline-flex items-center gap-1"
            >
              bookmarkforge@proton.me
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </p>
        </section>
      </article>
    </div>
  );
}
