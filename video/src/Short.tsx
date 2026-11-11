import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  COLORS,
  CTA_SECONDS,
  HOOK_SECONDS,
  SHORT_FPS,
  type ShortProps,
} from "./theme";

const HOOK_FRAMES = Math.round(HOOK_SECONDS * SHORT_FPS);
const CTA_FRAMES = Math.round(CTA_SECONDS * SHORT_FPS);

function secondsToFrames(s: number): number {
  return Math.max(1, Math.round(s * SHORT_FPS));
}

function clipFrames(props: ShortProps): number[] {
  return props.clips.map((c) => secondsToFrames(c.seconds));
}

export function shortDurationInFrames(props: ShortProps): number {
  return HOOK_FRAMES + clipFrames(props).reduce((a, b) => a + b, 0) + CTA_FRAMES;
}

// ── Scenes ──────────────────────────────────────────────────────────

const HookScene: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 12, stiffness: 120 } });
  const opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${COLORS.bg} 0%, ${COLORS.bgElevated} 100%)`,
        alignItems: "center",
        justifyContent: "center",
        padding: "0 90px",
      }}
    >
      <div
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          fontWeight: 800,
          fontSize: 96,
          lineHeight: 1.1,
          color: COLORS.text,
          textAlign: "center",
          transform: `scale(${0.8 + scale * 0.2})`,
          opacity,
          maxWidth: 900,
        }}
      >
        {text}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 220,
          fontFamily: "Inter, system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 44,
          color: COLORS.accent,
          letterSpacing: 4,
          textTransform: "uppercase",
          opacity: interpolate(frame, [15, 30], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        BookmarkForge
      </div>
    </AbsoluteFill>
  );
};

const FADE_FRAMES = 12;

const ClipScene: React.FC<{
  src: string;
  caption?: string;
  durationFrames: number;
  globalProgress: (f: number) => number;
}> = ({ src, caption, durationFrames, globalProgress }) => {
  const frame = useCurrentFrame();
  // Slight zoom-in (Ken Burns) keeps static screen recordings alive.
  const zoom = interpolate(frame, [0, durationFrames], [1, 1.06], {
    extrapolateRight: "clamp",
  });
  const progress = globalProgress(frame);
  // Dip-to-background fades at clip edges = smooth scene transitions.
  const edgeFade =
    interpolate(frame, [0, FADE_FRAMES], [0, 1], { extrapolateRight: "clamp" }) *
    interpolate(frame, [durationFrames - FADE_FRAMES, durationFrames], [1, 0], {
      extrapolateLeft: "clamp",
    });
  return (
    <AbsoluteFill style={{ background: COLORS.bg, opacity: edgeFade }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <OffthreadVideo
          src={staticFile(src)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${zoom})`,
          }}
          pauseWhenBuffering
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(11,18,32,0.55) 0%, rgba(11,18,32,0) 30%, rgba(11,18,32,0) 62%, rgba(11,18,32,0.85) 100%)",
          }}
        />
      </div>

      {/* Progress bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 14,
          background: "rgba(255,255,255,0.15)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress * 100}%`,
            background: COLORS.accent,
          }}
        />
      </div>

      {/* Caption */}
      {caption ? (
        <div
          style={{
            position: "absolute",
            left: 80,
            right: 80,
            bottom: 260,
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 64,
            lineHeight: 1.25,
            color: COLORS.white,
            textAlign: "center",
            textShadow: "0 4px 24px rgba(0,0,0,0.6)",
            whiteSpace: "pre-line",
          }}
        >
          {caption}
        </div>
      ) : null}

      {/* Watermark */}
      <div
        style={{
          position: "absolute",
          top: 60,
          right: 60,
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontFamily: "Inter, system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 36,
          color: COLORS.textMuted,
        }}
      >
        <Img
          src={staticFile("brand/logo-mark.png")}
          style={{ width: 56, height: 56, borderRadius: 12 }}
        />
        BookmarkForge
      </div>
    </AbsoluteFill>
  );
};

const CtaScene: React.FC<{ cta: string; ctaSub?: string }> = ({ cta, ctaSub }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 14, stiffness: 100 } });
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${COLORS.bg} 0%, ${COLORS.bgElevated} 100%)`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Img
        src={staticFile("brand/logo-mark.png")}
        style={{
          width: 220,
          height: 220,
          borderRadius: 48,
          marginBottom: 80,
          transform: `scale(${0.7 + scale * 0.3})`,
          opacity,
        }}
      />
      <div
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          fontWeight: 800,
          fontSize: 88,
          color: COLORS.text,
          opacity,
          marginBottom: ctaSub ? 40 : 0,
        }}
      >
        {cta}
      </div>
      {ctaSub ? (
        <div
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 600,
            fontSize: 48,
            color: COLORS.accent,
            opacity: interpolate(frame, [12, 26], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          {ctaSub}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// ── Composition ─────────────────────────────────────────────────────

export const Short: React.FC<ShortProps> = (props) => {
  const frames = clipFrames(props);
  const total = shortDurationInFrames(props);
  const bodyStart = HOOK_FRAMES;

  const globalProgress = (localFrame: number): number => {
    const abs = bodyStart + localFrame;
    return Math.min(1, abs / total);
  };

  let cursor = bodyStart;
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Sequence durationInFrames={HOOK_FRAMES}>
        <HookScene text={props.hook} />
      </Sequence>
      {props.clips.map((clip, i) => {
        const dur = frames[i];
        const start = cursor;
        cursor += dur;
        const caption =
          clip.caption ?? props.captions?.[i] ?? undefined;
        return (
          <Sequence key={i} from={start} durationInFrames={dur}>
            <ClipScene
              src={clip.src}
              caption={caption}
              durationFrames={dur}
              globalProgress={globalProgress}
            />
          </Sequence>
        );
      })}
      <Sequence from={total - CTA_FRAMES} durationInFrames={CTA_FRAMES}>
        <CtaScene cta={props.cta} ctaSub={props.ctaSub} />
      </Sequence>
      {props.narration ? (
        <Audio src={staticFile(props.narration)} />
      ) : null}
    </AbsoluteFill>
  );
};
