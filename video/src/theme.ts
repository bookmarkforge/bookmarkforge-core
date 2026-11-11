// Brand tokens mirrored from public/brand-tokens.css — keep in sync.
export const COLORS = {
  bg: "#0b1220",
  bgElevated: "#111a2e",
  accent: "#0ea5e9",
  accentDark: "#0284c7",
  text: "#f1f5f9",
  textMuted: "#94a3b8",
  white: "#ffffff",
} as const;

export const SHORT_FPS = 30;
export const SHORT_WIDTH = 1080;
export const SHORT_HEIGHT = 1920;

export const HOOK_SECONDS = 2.5;
export const CTA_SECONDS = 3;

export interface ClipSpec {
  /** Path under video/public/, e.g. "clips/vault-unlock.mp4". */
  src: string;
  /** Duration of this clip in seconds. */
  seconds: number;
  /** Optional caption burned in at the bottom during this clip. */
  caption?: string;
}

export interface ShortProps {
  /** Big text shown during the hook scene (first ~2.5s). */
  hook: string;
  /** Ordered clips forming the body of the short. */
  clips: ClipSpec[];
  /** Optional per-clip captions aligned 1:1 with clips. */
  captions?: string[];
  /** Final call-to-action line, e.g. "bookmarkforgeapp.com". */
  cta: string;
  /** Optional sub-line under the CTA. */
  ctaSub?: string;
  /** Optional narration audio file under video/public/. */
  narration?: string;
}

export const DEFAULT_PROPS: ShortProps = {
  hook: "Stop losing your bookmarks.",
  clips: [
    { src: "clips/demo.mp4", seconds: 6, caption: "Everything you save stays on your device." },
  ],
  cta: "bookmarkforgeapp.com",
  ctaSub: "Private. Local-first. Free forever.",
};
