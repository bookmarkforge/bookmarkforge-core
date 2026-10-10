import React from "react";
import type { LucideIcon } from "lucide-react";

type NavCardAccent = "cyan" | "success" | "warning" | "danger" | "neutral";

interface NavCardProps {
  icon: LucideIcon;
  /** Semantic accent — single source of truth for tinted icon backgrounds.
   *  Maps to the design-system token palette only (cyan + semantic states).
   *  Replaces raw Tailwind gradient strings that previously violated the DS spec. */
  iconAccent?: NavCardAccent;
  hoverBorder?: string;
  title: string;
  description: string;
  onClick: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/** Design-system accent classes — single source of truth for tinted icon backgrounds.
 *  Each glyph uses the matching 10% tint of the semantic state color (no gradients).
 *  Classes reference --color-* and --accent-soft CSS vars, so brand restyle is
 *  one-file-edit at :root. */
const ACCENT_CLASSES: Record<NavCardAccent, string> = {
  cyan: "ds-icon-tint-cyan",
  success: "ds-icon-tint-success",
  warning: "ds-icon-tint-warning",
  danger: "ds-icon-tint-danger",
  neutral: "ds-icon-tint-neutral",
};

export const NavCard: React.FC<NavCardProps> = ({
  icon: Icon,
  iconAccent = "cyan",
  title,
  description,
  onClick,
  className = "",
  style,
}) => (
  <div
    onClick={onClick}
    onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    }}
    role="button"
    tabIndex={0}
    aria-label={title}
    className={`bento-item p-5 md:p-6 group cursor-pointer text-start w-full ${className}`}
    style={style}
  >
    <div className="flex items-center gap-4">
      <div
        className={`size-12 ${ACCENT_CLASSES[iconAccent]} rounded-2xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}
      >
        <Icon className="size-6" />
      </div>
      <div className="min-w-0">
        <h2 className="ds-card-title mb-1 truncate">{title}</h2>
        <p className="text-xs leading-relaxed truncate ds-text-secondary">
          {description}
        </p>
      </div>
    </div>
  </div>
);
