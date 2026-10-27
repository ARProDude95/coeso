import { CSSProperties, ReactNode } from 'react';
import { StorySection } from './scaffold';

/**
 * Design-token stories: the color palette (as swatches) and the type ramp.
 * These catch accidental changes to the CSS custom properties in styles.css —
 * the single source of the whole dark, gold-accented theme.
 */

/** The token names exposed as swatches, in display order. */
const SURFACE_TOKENS = [
  '--bg',
  '--bg-glow',
  '--bg-raised',
  '--bg-overlay',
  '--bg-hover',
  '--border',
  '--border-strong',
];

const TEXT_TOKENS = ['--text', '--text-dim', '--text-faint'];

const BRAND_TOKENS = [
  '--accent',
  '--accent-strong',
  '--accent-soft',
  '--accent-line',
  '--accent-glow',
  '--accent-ink',
];

const STATUS_TOKENS = [
  '--danger',
  '--danger-soft',
  '--danger-line',
  '--success',
  '--success-soft',
  '--success-line',
  '--info',
];

function Swatch({ token }: { token: string }) {
  return (
    <div className="swatch">
      {/* The chip paints the token's computed value; the name is the token id. */}
      <div className="swatch-chip" style={{ background: `var(${token})` }} />
      <div className="swatch-name">{token}</div>
    </div>
  );
}

function SwatchGroup({ title, tokens }: { title: string; tokens: string[] }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div className="story-label" style={{ marginBottom: '0.5rem' }}>
        {title}
      </div>
      <div className="swatch-grid">
        {tokens.map((token) => (
          <Swatch key={token} token={token} />
        ))}
      </div>
    </div>
  );
}

export function ColorTokens() {
  return (
    <StorySection id="color-tokens" title="Color tokens">
      <SwatchGroup title="Surfaces" tokens={SURFACE_TOKENS} />
      <SwatchGroup title="Text" tokens={TEXT_TOKENS} />
      <SwatchGroup title="Brand / accent" tokens={BRAND_TOKENS} />
      <SwatchGroup title="Status" tokens={STATUS_TOKENS} />
    </StorySection>
  );
}

/** One line of the type ramp: label + a live sample using the token. */
function TypeLine({
  meta,
  style,
  children,
}: {
  meta: string;
  style: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className="type-sample">
      <span className="type-meta">{meta}</span>
      <span style={style}>{children}</span>
    </div>
  );
}

export function TypeRamp() {
  return (
    <StorySection id="type-ramp" title="Type ramp">
      <div className="type-ramp">
        <TypeLine
          meta="h1 · font-display · 600"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1.9rem', color: 'var(--text)' }}
        >
          Display heading
        </TypeLine>
        <TypeLine
          meta="h2 · font-display · 600"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1.35rem', color: 'var(--text)' }}
        >
          Section heading
        </TypeLine>
        <TypeLine
          meta="body · font-body"
          style={{ fontFamily: 'var(--font-body)', fontSize: '0.95rem', color: 'var(--text)' }}
        >
          Body copy — the quick brown fox jumps over the lazy dog.
        </TypeLine>
        <TypeLine
          meta="muted · text-dim"
          style={{ fontFamily: 'var(--font-body)', fontSize: '0.92rem', color: 'var(--text-dim)' }}
        >
          Secondary / muted copy in --text-dim.
        </TypeLine>
        <TypeLine
          meta="faint · text-faint"
          style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--text-faint)' }}
        >
          Faint / placeholder copy in --text-faint.
        </TypeLine>
        <TypeLine
          meta="mono · font-mono"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text)' }}
        >
          {'monospace: workspace_id = 42'}
        </TypeLine>
        <TypeLine
          meta="stat-value · font-display"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: '1.85rem',
            color: 'var(--accent)',
            letterSpacing: '-0.02em',
          }}
        >
          128
        </TypeLine>
      </div>
    </StorySection>
  );
}
