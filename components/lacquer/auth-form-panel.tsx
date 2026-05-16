// AuthFormPanel — server component. Renders the right form panel of the
// 010-login-redesign two-panel shell (FR-004): a fixed-width 480px panel
// (per the prototype's CSS grid) whose interior is a 360px-max form well
// that vertically centres the active view component.
//
// At viewports < 720px the shell collapses (CSS-driven) and the brand
// panel hides; in that case the solo wordmark inside this panel becomes
// visible above the form well via `.auth-solo-mark`'s media-query rule in
// `styles/auth.css`. No JS viewport check is required — the wordmark is
// always rendered and the CSS controls visibility.
//
// LacquerMark SVG path data + raw OKLCH fills mirror those in
// `components/lacquer/auth-brand-panel.tsx`. Both values resolve to
// `--rose-500` / `--rose-300` in `styles/tokens.css`.

import type { ReactNode } from "react";

const LACQUER_FILL_PRIMARY = "oklch(0.55 0.12 12)";
const LACQUER_FILL_ACCENT = "oklch(0.76 0.07 12)";

function LacquerMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path
        d="M32 4c-9 0-16 7-16 18 0 8 3 14 6 22 2 6 4 12 4 16 0 0 2 0 6 0s6 0 6 0c0-4 2-10 4-16 3-8 6-14 6-22 0-11-7-18-16-18z"
        fill={LACQUER_FILL_PRIMARY}
      />
      <path
        d="M32 4c-9 0-16 7-16 18 0 4 1 8 2 11 4-3 9-5 14-5s10 2 14 5c1-3 2-7 2-11 0-11-7-18-16-18z"
        fill={LACQUER_FILL_ACCENT}
      />
    </svg>
  );
}

export type AuthFormPanelProps = {
  children: ReactNode;
};

export function AuthFormPanel({ children }: AuthFormPanelProps) {
  return (
    <section className="auth-form-panel">
      <div className="auth-form-well">
        <div className="auth-solo-mark">
          <LacquerMark size={24} />
          <span className="auth-solo-mark-name">Tang Nails Studio</span>
        </div>
        {children}
      </div>
    </section>
  );
}
