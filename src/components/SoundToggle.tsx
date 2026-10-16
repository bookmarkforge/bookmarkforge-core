import { Volume2, VolumeX } from "lucide-react";
import { useSoundStore } from "../store/useSoundStore";
import { Tooltip } from "@mantine/core";
import { useTranslation } from "react-i18next";

export function SoundToggle() {
  const enabled = useSoundStore((s) => s.enabled);
  const setEnabled = useSoundStore((s) => s.setEnabled);
  const { t } = useTranslation();

  return (
    <Tooltip
      label={
        enabled
          ? t("app_muteSounds", "Mute sounds")
          : t("app_unmuteSounds", "Unmute sounds")
      }
      position="bottom"
      withArrow
      classNames={{ tooltip: "max-w-xs line-clamp-3" }}
    >
      <button
        onClick={() => setEnabled(!enabled)}
        className="truncate p-2 ds-ghost-btn-icon ds-radius-item"
        aria-label={
          enabled
            ? t("app_muteSounds", "Mute sounds")
            : t("app_unmuteSounds", "Unmute sounds")
        }
        data-testid="sound-toggle"
      >
        {enabled ? (
          <Volume2 className="size-4" />
        ) : (
          <VolumeX className="size-4" />
        )}
      </button>
    </Tooltip>
  );
}
