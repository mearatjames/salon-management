// AuthBrandPanel — server component. Renders the left brand panel of the
// 010-login-redesign two-panel shell: a top-left wordmark (LacquerMark +
// "Tang Nails Studio"), two decorative LacquerMarks (top-right large /
// bottom-right small, both `aria-hidden`), and the bottom-left tagline +
// sub-line lifted verbatim from FR-003.
//
// No client JS. No focusable elements (decorative-only per
// `ui-views.contract.md § Brand panel content`). The LacquerMark SVG path
// data is inlined from `design-system/prototypes/auth/Login Screen.html`
// lines 367-372 — the prototype is the visual source of truth.
//
// Color values referenced inline in the SVG path `fill` come from the
// Lacquer rose ramp (`oklch(0.55 0.12 12)` ≡ `--rose-500`,
// `oklch(0.76 0.07 12)` ≡ `--rose-300`). These match the prototype
// verbatim; embedding the raw OKLCH inside SVG attributes is unavoidable
// because SVG `fill` does not resolve CSS custom properties consistently
// across the rendering paths we care about (server-rendered HTML +
// Lighthouse + Playwright screenshot). Both values are present in
// `styles/tokens.css`.

const LACQUER_FILL_PRIMARY = "oklch(0.55 0.12 12)";
const LACQUER_FILL_ACCENT = "oklch(0.76 0.07 12)";

function LacquerMark({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
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

export function AuthBrandPanel() {
  return (
    <aside className="auth-brand-panel" aria-label="Tang Nails Studio">
      <LacquerMark size={380} className="auth-brand-deco" />
      <LacquerMark size={160} className="auth-brand-deco-2" />

      <div className="auth-brand-wordmark">
        <LacquerMark size={26} />
        <span className="auth-brand-name">Tang Nails Studio</span>
      </div>

      <div className="auth-brand-content">
        <p className="auth-brand-tagline">Studio tools built for focused work.</p>
        <p className="auth-brand-sub">
          Bookings, clients, payments, and staff scheduling — all in one quiet place.
        </p>
      </div>
    </aside>
  );
}
