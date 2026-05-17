import type { Technician } from "@/lib/dashboard/aggregate";

export type TechAvatarProps = {
  tech: Technician;
  size?: number;
  ring?: boolean;
};

// Server component — circular initials avatar. The new `Technician` shape
// from the live read model carries `colorToken` (e.g. `"--avatar-rose"`) and
// `displayName`; the initials come from the first two whitespace-separated
// tokens of `displayName`.
//
// `ring` is `false` in v1 — kept on the prop surface for future reuse (e.g.
// the new-transaction picker in a later feature).
export function TechAvatar({ tech, size = 36, ring = false }: TechAvatarProps) {
  // Build CSS var reference; fall back to a neutral if the token is missing.
  const bg = tech.colorToken ? `var(${tech.colorToken})` : "var(--muted)";
  const initials = tech.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((token) => token[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <div
      data-slot="tech-avatar"
      data-staff-name={tech.displayName}
      className="tx-tech-avatar"
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        background: bg,
        color: "var(--primary-foreground)",
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
