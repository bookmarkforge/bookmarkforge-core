import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Capture } from "../Capture";
import { SecurityManager } from "../SecurityManager";
import { useSecurityStore } from "../../hooks/useSecurityStore";
import { securityVault } from "../../services/SecurityVault";
import { safeGet } from "../../store/safeStorage";
import { STORAGE_KEYS } from "../../constants/storage-keys";
import { logger } from "../../utils/logger";

export function CaptureApp() {
  const { isLocked, forceSetup } = useSecurityStore();
  const [masterPassword] = useState<string>("");
  const [hasPwd, setHasPwd] = useState(
    () => safeGet(STORAGE_KEYS.HAS_MASTER_PASSWORD) === "true",
  );
  const { t } = useTranslation();

  useEffect(() => {
    securityVault
      .hasMasterPassword()
      .then(setHasPwd)
      .catch((err) => {
        logger.debug("[CaptureApp] Vault not available yet", { error: err });
      });
  }, []);

  if ((isLocked && hasPwd) || forceSetup) {
    return (
      <SecurityManager>
        <div>{t("app.unlocking")}</div>
      </SecurityManager>
    );
  }

  return <Capture masterPassword={masterPassword || undefined} />;
}
