import type { Technician } from "@/lib/dashboard/mock-data";

export type TechAvatarProps = {
  tech: Technician;
  size?: number;
  ring?: boolean;
};

// Server component — circular initials avatar with a tone-derived OKLCH
// background. Ports `design-system/prototypes/transaction/TechPicker.jsx:12-31`
// verbatim modulo TypeScript types. The OKLCH literals `oklch(0.86 0.045 ${tone})`
// and `oklch(0.32 0.06 ${tone})` are intentional hue-driven shading and are not
// expressible as Lacquer tokens (Phase-5 orchestrator note).
//
// `ring` is `false` in v1 — kept on the prop surface for future reuse (e.g.
// the new-transaction picker in a later feature).
export function TechAvatar({ tech, size = 36, ring = false }: TechAvatarProps) {
  const bg = `oklch(0.86 0.045 ${tech.tone})`;
  const fg = `oklch(0.32 0.06 ${tech.tone})`;
  const initials = tech.full
    .split(/\s+/)
    .slice(0, 2)
    .map((token) => token[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <div
      data-slot="tech-avatar"
      className="tx-tech-avatar"
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.38),
        fontWeight: 600,
        letterSpacing: "0.01em",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxShadow: ring
          ? "0 0 0 2px var(--card), 0 0 0 4px var(--primary)"
          : "0 0 0 2px var(--card)",
        position: "relative",
      }}
    >
      <span>{initials}</span>
    </div>
  );
}
