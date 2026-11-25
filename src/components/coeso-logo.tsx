/**
 * The Coeso wordmark: cream serif capitals on a dark slate-blue tile,
 * recreated from the brand artwork as a self-contained SVG so it scales
 * crisply at any size and needs no asset file. If the original PNG/SVG
 * becomes available in `public/`, swap this markup for an <img> — the
 * component's props stay the same.
 */
export function CoesoLogo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <svg viewBox="0 0 112 32" role="img" aria-label="Coeso" className={className}>
      <rect width="112" height="32" rx="7" fill="#22333b" />
      <text
        x="56"
        y="22.5"
        textAnchor="middle"
        fill="#f0ebd8"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "17px",
          fontWeight: 600,
          letterSpacing: "2.5px",
        }}
      >
        COESO
      </text>
    </svg>
  );
}
