import React from "react";
import { Key } from "lucide-react";
import { useTranslation } from "react-i18next";

interface AuthTokenFieldsProps {
  authToken: string;
  onChange: (val: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}

export const AuthTokenFields: React.FC<AuthTokenFieldsProps> = ({
  authToken,
  onChange,
  t,
}) => (
  <div className="space-y-2">
    <span className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] flex items-center gap-1.5">
      <Key className="size-3.5 text-[var(--text-muted)]" />{" "}
      {t("accessTokenKey", "Access Token / API Key")}
    </span>
    <input
      type="password"
      aria-label={t("accessTokenKey", "Access Token / API Key")}
      placeholder={t(
        "authTokenPlaceholder",
        "Insert the developer authentication token",
      )}
      value={authToken}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] dark:text-white outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono shadow-inner"
    />
    <p className="text-[10px] text-[var(--text-muted)] font-medium">
      {t(
        "personalAccessTokenHint",
        "Generate a personal access token (PAT) in the corresponding provider developer console.",
      )}
    </p>
  </div>
);
