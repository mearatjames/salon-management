// InitialsAvatar — the single initials-avatar circle for the whole app.
//
// One color treatment everywhere: a soft 15%-opacity wash of the staff
// color token behind the token at full opacity for the initials. This is
// the Settings → Staff roster look (the canonical reference); reports,
// payroll, the dashboard, transactions, and the studio chrome all render
// the same way so a person reads as the same identity on every surface.
//
// Replaces the former `StaffAvatar` (tinted) + `TechAvatar` (solid) split
// and the per-surface inline copies. Pure rendering — safe in Server and
// Client Components. Initials come from the shared `initials()` helper.
//
// Sizing is intentionally caller-controlled (`size`, default 40px); only
// the color scheme is fixed. Pass `separated` for overlapping stacks (adds
// a 2px card-colored ring so neighbours read apart). Any extra props —
// `className`, `style`, `data-*` — pass straight through to the span.

import type { CSSProperties, HTMLAttributes } from "react";

import { initials } from "@/components/lacquer/staff/initials";

export type InitialsAvatarProps = HTMLAttributes<HTMLSpanElement> & {
  /** Display name — the 1–2 char initials are derived from this. */
  name: string;
  /** Lacquer avatar color token, e.g. `"--avatar-rose"`. Falls back to the
   *  neutral `--avatar-slate` token when missing. */
  colorToken: string | null | undefined;
  /** Box edge in px. Defaults to 40 (10 × the 4px grid unit). */
  size?: number;
  /** Adds a 2px card-colored ring — for overlapping avatar stacks. */
  separated?: boolean;
};

export function InitialsAvatar({
  name,
  colorToken,
  size = 40,
  separated = false,
  style,
  ...rest
}: InitialsAvatarProps) {
  // A missing token resolves to the neutral avatar token rather than a
  // raw color, so the wash formula below still produces a valid tint.
  const token = colorToken || "--avatar-slate";
  // Roughly half the box for a comfortable initials weight.
  const fontPx = Math.round(size * 0.4);

  const baseStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "var(--radius-full)",
    background: `oklch(from var(${token}) l c h / 0.15)`,
    color: `var(${token})`,
    fontWeight: 600,
    fontSize: `${fontPx}px`,
    letterSpacing: "var(--tracking-wide)",
    userSelect: "none",
    ...(separated ? { boxShadow: "0 0 0 2px var(--card)" } : null),
    ...style,
  };

  return (
    <span aria-hidden="true" {...rest} style={baseStyle}>
      {initials(name)}
    </span>
  );
}
