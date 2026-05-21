// LacquerMark — the Tang Nails Studio brand mark (a stylised polish drop).
//
// The single shared copy of the brand glyph, used in the studio topbar and
// the select-staff screen. Pure SVG, no client code.
//
// SVG fills are the Lacquer rose ramp inlined as raw OKLCH — SVG `fill` does
// not resolve CSS custom properties consistently.

const FILL_PRIMARY = "oklch(0.55 0.12 12)";
const FILL_ACCENT = "oklch(0.76 0.07 12)";

export type LacquerMarkProps = {
  /** Box edge in px. */
  size: number;
};

export function LacquerMark({ size }: LacquerMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path
        d="M32 4c-9 0-16 7-16 18 0 8 3 14 6 22 2 6 4 12 4 16 0 0 2 0 6 0s6 0 6 0c0-4 2-10 4-16 3-8 6-14 6-22 0-11-7-18-16-18z"
        fill={FILL_PRIMARY}
      />
      <path
        d="M32 4c-9 0-16 7-16 18 0 4 1 8 2 11 4-3 9-5 14-5s10 2 14 5c1-3 2-7 2-11 0-11-7-18-16-18z"
        fill={FILL_ACCENT}
      />
    </svg>
  );
}
