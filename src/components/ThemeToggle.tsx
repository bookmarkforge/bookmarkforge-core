import { ActionIcon, Tooltip } from "@mantine/core";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { EASE_OUT, DURATION_TOOLTIP } from "../constants/motion";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();

  const getThemeIcon = () => {
    switch (theme) {
      case "light":
        return (
          <motion.div
            key="light"
            initial={{ rotate: -90, scale: 0.9, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 90, scale: 0.9, opacity: 0 }}
            transition={{ duration: DURATION_TOOLTIP, ease: EASE_OUT }}
            className="flex items-center justify-center"
          >
            <Sun size={16} />
          </motion.div>
        );
      case "dark":
        return (
          <motion.div
            key="dark"
            initial={{ rotate: -90, scale: 0.9, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 90, scale: 0.9, opacity: 0 }}
            transition={{ duration: DURATION_TOOLTIP, ease: EASE_OUT }}
            className="flex items-center justify-center"
          >
            <Moon size={16} />
          </motion.div>
        );
      default:
        return (
          <motion.div
            key="system"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: DURATION_TOOLTIP, ease: EASE_OUT }}
            className="flex items-center justify-center"
          >
            <Monitor size={16} />
          </motion.div>
        );
    }
  };

  // Single source of truth: aria-label and Tooltip BOTH describe the next
  // action that the click will achieve. This keeps sighted and screen-reader
  // users on the same page (previously aria-label said "Switch to dark"
  // while Tooltip said "Dark mode" \u2014 opposite polarities).
  const getNextActionLabel = () => {
    switch (theme) {
      case "light":
        return t("app_switchToDarkMode", "Switch to dark mode");
      case "dark":
        return t("app_switchToSystemTheme", "Switch to system theme");
      default:
        return t("app_switchToLightMode", "Switch to light mode");
    }
  };

  return (
    <Tooltip
    label={getNextActionLabel()}
    position="bottom"
    classNames={{ tooltip: "max-w-xs line-clamp-3" }}
  >
      <ActionIcon
        variant="subtle"
        size="lg"
        aria-label={getNextActionLabel()}
        data-testid="theme-toggle"
        className="active:scale-90 transition-transform duration-100 ease-out"
        onClick={() => {
          toggleTheme();
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {getThemeIcon()}
        </AnimatePresence>
      </ActionIcon>
    </Tooltip>
  );
}
