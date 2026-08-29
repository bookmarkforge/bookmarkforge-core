import React from "react";
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

interface WebDAVFieldsProps {
  url: string;
  username: string;
  password: string;
  onUrlChange: (val: string) => void;
  onUsernameChange: (val: string) => void;
  onPasswordChange: (val: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}

export const WebDAVFields: React.FC<WebDAVFieldsProps> = ({
  url,
  username,
  password,
  onUrlChange,
  onUsernameChange,
  onPasswordChange,
  t,
}) => (
  <div className="space-y-4">
    <div className="space-y-2">
      <span className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] flex items-center gap-1.5">
        <Globe className="size-3.5 text-[var(--text-muted)]" />{" "}
        {t("webdavUrlLabel", "WebDAV Server URL")}
      </span>
      <input
        type="text"
        aria-label={t("webdavUrlLabel", "WebDAV Server URL")}
        placeholder={t(
          "webdavUrlPlaceholder",
          "https://nextcloud.example.com/remote.php/dav/files/user/",
        )}
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        className="w-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] dark:text-white outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono shadow-inner"
      />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="space-y-2">
        <span className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
          {t("username", "Username")}
        </span>
        <input
          type="text"
          aria-label={t("username", "Username")}
          placeholder={t("nextcloudUserPlaceholder", "Nextcloud user")}
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          className="w-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] dark:text-white outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 shadow-inner"
        />
      </div>
      <div className="space-y-2">
        <span className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
          {t("passwordLabel", "Password / App Token")}
        </span>
        <input
          type="password"
          aria-label={t("passwordLabel", "Password / App Token")}
          placeholder={t("devicePasswordPlaceholder", "Device password")}
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          className="w-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] dark:text-white outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 shadow-inner"
        />
      </div>
    </div>
    <p className="text-[10px] text-[var(--text-muted)] font-medium">
      {t(
        "appPasswordHint",
        'We strongly recommend using a dedicated "App Password" from Nextcloud or Owncloud instead of your master account password.',
      )}
    </p>
  </div>
);
