import React from "react";
import { motion } from "motion/react";
import {
  Sparkles,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Bookmark,
} from "lucide-react";

/**
 * TokenCatalog — visual reference of every locked design-system token
 * and utility class.
 *
 * Rendered only in dev builds behind the `?catalog=true` URL flag so it
 * has zero impact on production bundle or runtime. Useful for:
 *   - Onboarding new contributors to the palette/tokens.
 *   - Reviewing visual drift between builds (open in two tabs).
 *   - Spot-checking icons/badges/buttons without spinning up a story.
 *
 * The catalog queries CSS custom properties off `:root` so it
 * automatically reflects whatever's loaded — no hardcoded swatch
 * colors that could drift from index.css.
 */

interface SwatchProps {
  name: string;
  cssVar: string;
  /** When true, render as a tinted text/border sample; default is solid. */
  text?: boolean;
}

const Swatch: React.FC<SwatchProps> = ({ name, cssVar, text }) => {
  const baseStyle: React.CSSProperties & Record<string, unknown> = text
    ? { color: `var(${cssVar})` }
    : {
        background: `var(${cssVar})`,
        "--swatch-preview": undefined,
      };
  const style = baseStyle as React.CSSProperties;
  return (
    <div className="rounded-lg border border-divider overflow-hidden flex flex-col ds-bg-card">
      <div
        className="h-16 flex items-center justify-center"
        style={style}
        data-token={cssVar}
      >
        <span
          className="text-xs font-mono"
          style={{
            color: text ? undefined : "var(--text-primary)",
            mixBlendMode: text ? "normal" : "difference",
          }}
        >
          {cssVar}
        </span>
      </div>
      <div className="px-3 py-2">
        <div className="ds-card-subtitle text-[11px]">{name}</div>
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="mb-12">
    <h2 className="ds-h2 mb-4">{title}</h2>
    {children}
  </section>
);

const Glyph: React.FC<{
  Accent: string;
  icon: React.ComponentType<{ size?: number }>;
}> = ({ Accent, icon: Icon }) => (
  <div className={`p-3 rounded-xl inline-flex ${Accent}`}>
    <Icon size={20} />
  </div>
);

export const TokenCatalog: React.FC = () => {
  return (
    <div className="min-h-screen p-10 ds-bg-primary ds-text-primary">
      <header className="mb-10 max-w-3xl">
        <h1 className="ds-h1">Design System · Token Catalog</h1>
        <p className="ds-body-secondary mt-3">
          Dev-only visual reference. Every swatch and style chip reads live from
          the documented <code>:root</code> tokens in <code>src/index.css</code>{" "}
          — drift in this catalog indicates drift in the design-system contract.
        </p>
        <p className="mt-16 text-xs font-mono ds-text-muted">
          Toggle: open with <code>?catalog=true</code>, close by removing the
          query string. SoT = src/index.css (drift test lock).
        </p>
      </header>

      <Section title="Semantic-state palette">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Swatch name="success" cssVar="--color-success" />
          <Swatch name="warning" cssVar="--color-warning" />
          <Swatch name="danger" cssVar="--color-danger" />
          <Swatch name="danger-hover" cssVar="--color-danger-hover" />
          <Swatch name="success · soft fill" cssVar="--success-soft" />
          <Swatch name="warning · soft fill" cssVar="--warning-soft" />
          <Swatch name="danger · soft fill" cssVar="--danger-soft" />
          <Swatch name="success · border" cssVar="--success-soft-border" />
        </div>
      </Section>

      <Section title="Accent / brand · cyan">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Swatch name="primary" cssVar="--accent-primary" />
          <Swatch name="secondary" cssVar="--accent-secondary" />
          <Swatch name="soft" cssVar="--accent-soft" />
          <Swatch name="glow" cssVar="--accent-glow" />
          <Swatch name="primary-hover" cssVar="--accent-primary-hover" />
        </div>
      </Section>

      <Section title="Surface / text / overlay">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Swatch name="bg-primary" cssVar="--bg-primary" text />
          <Swatch name="bg-card" cssVar="--bg-card" text />
          <Swatch name="text-primary" cssVar="--text-primary" text />
          <Swatch name="text-secondary" cssVar="--text-secondary" text />
          <Swatch name="text-muted" cssVar="--text-muted" text />
          <Swatch name="divider" cssVar="--divider" />
          <Swatch name="modal-overlay" cssVar="--modal-overlay" />
          <Swatch name="scrim-on-accent" cssVar="--scrim-on-accent" />
        </div>
      </Section>

      <Section title="Typography utilities">
        <div className="space-y-2 max-w-2xl">
          <p className="ds-h1">.ds-h1 · Title 24px/700/1.2</p>
          <p className="ds-h2">.ds-h2 · Subtitle 20px/600/1.3</p>
          <p className="ds-h3">.ds-h3 · Section 18px/600/1.3</p>
          <p className="ds-label-section">
            .ds-label-section · 12px uppercase tracked
          </p>
          <p className="ds-card-title">.ds-card-title · Card heading</p>
          <p className="ds-card-subtitle">.ds-card-subtitle · Card subtitle</p>
          <p className="ds-display-numeric">
            .ds-display-numeric · 28px numeric
          </p>
          <p className="ds-list-item-text">.ds-list-item-text · 14px body</p>
          <p className="ds-body-secondary">
            .ds-body-secondary · 14px secondary body
          </p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <button type="button" className="btn-primary">
            Primary
          </button>
          <button type="button" className="btn-primary-outline">
            Outline
          </button>
          <button type="button" className="ds-ghost-btn">
            Ghost
          </button>
          <button
            type="button"
            className="ds-ghost-btn-icon"
            aria-label="icon-only"
          >
            <Sparkles size={16} />
          </button>
        </div>
        <p className="ds-card-subtitle">
          .btn-primary uses <code>var(--accent-primary-glow)</code> for the
          shadow ring · outline mirrors the cyan border · ds-ghost-btn clears
          background on hover via state-hover-bg.
        </p>
      </Section>

      <Section title="Icon tints (NavCard API)">
        <div className="flex flex-wrap items-center gap-4">
          <Glyph Accent="ds-icon-tint-cyan" icon={Bookmark} />
          <Glyph Accent="ds-icon-tint-success" icon={CheckCircle2} />
          <Glyph Accent="ds-icon-tint-warning" icon={AlertTriangle} />
          <Glyph Accent="ds-icon-tint-danger" icon={AlertOctagon} />
          <Glyph Accent="ds-icon-tint-neutral" icon={Sparkles} />
        </div>
      </Section>

      <Section title="Badges / pills">
        <div className="flex flex-wrap items-center gap-3">
          <span className="ds-badge-success">Saved</span>
          <span className="ds-badge-warning-solid">Pending</span>
          <span className="ds-badge-warning-soft">Stale</span>
          <span className="ds-badge-danger">Danger</span>
        </div>
      </Section>

      <Section title="Active / state compositors">
        <div className="flex flex-wrap items-center gap-3">
          <motion.div className="px-4 py-2 rounded-xl ds-side-tab ds-active-soft">
            .ds-side-tab + .ds-active-soft
          </motion.div>
          <div className="ds-ghost-bg-success px-4 py-2 rounded-xl">
            .ds-ghost-bg-success (hover swatch)
          </div>
          <div className="ds-ghost-bg-danger px-4 py-2 rounded-xl">
            .ds-ghost-bg-danger
          </div>
          <div className="ds-ghost-bg-accent px-4 py-2 rounded-xl">
            .ds-ghost-bg-accent
          </div>
        </div>
      </Section>

      <Section title="Privacy lock">
        <div className="rounded-xl p-4 border ds-bg-card ds-border-divider ds-text-secondary">
          <p className="ds-card-title">
            fonts.googleapis.com and fonts.gstatic.com are forbidden.
          </p>
          <p className="ds-body-secondary mt-2">
            Fonts self-host via <code>@fontsource-variable/inter</code> (see{" "}
            <code>src/main.tsx</code>). The Design System test suite asserts
            neither host appears anywhere in <code>src/index.css</code>.
          </p>
        </div>
      </Section>

      <footer className="mt-12 max-w-3xl">
        <p className="ds-card-subtitle">
          Single source of truth: <code>src/index.css</code>. When you change a
          token, the catalog and the drift test follow automatically.
        </p>
      </footer>
    </div>
  );
};

export default TokenCatalog;
