// StaffAvatar — initials avatar circle. Server Component, pure rendering.
// Adapted from `components/lacquer/staff-tile.tsx:48-75` for the Settings →
// Staff roster + edit panel. Background = soft-tint of the color token
// (`oklch(from var(--avatar-<color>) l c h / 0.15)`); text = the token at
// full opacity. Size prop (default 40px) keeps the swatch on the 4px grid.

import type { CSSProperties } from "react";

export type StaffAvatarProps = {
  name: string;
  colorToken: string;
  /** Box edge in px. Defaults to 40 (10 * 4px grid units). */
  size?: number;
  className?: string;
  style?: CSSProperties;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function StaffAvatar({ name, colorToken, size = 40, className, style }: StaffAvatarProps) {
  const tint = `oklch(from var(${colorToken}) l c h / 0.15)`;
  const text = `var(${colorToken})`;
  // Roughly half the box for a comfortable initials weight.
  const fontPx = Math.round(size * 0.4);
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "var(--radius-full)",
        background: tint,
        color: text,
        fontWeight: 600,
        fontSize: `${fontPx}px`,
        letterSpacing: "var(--tracking-wide)",
        userSelect: "none",
        ...style,
      }}
    >
      {initials(name)}
    </span>
  );
}
