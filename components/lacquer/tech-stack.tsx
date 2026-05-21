import type { Technician } from "@/lib/dashboard/aggregate";
import { InitialsAvatar } from "@/components/lacquer/initials-avatar";

export type TechStackProps = {
  staff: readonly Technician[];
  ids: readonly string[];
  size?: number;
  max?: number;
};

// Server component — a row of up to `max` tech avatars shown side by side
// with a small gap. They are deliberately NOT overlapped: the shared
// `InitialsAvatar` renders a semi-transparent tinted background, so stacking
// the circles would let one show through another and read as muddy. When
// `ids.length` exceeds `max`, a trailing `.tx-tech-overflow` chip shows `+N`.
//
// The roster (`staff`) is passed in by the caller (typically the dashboard
// page via `DashboardData.staff`) so this component stays free of mock-data
// imports.
export function TechStack({ staff, ids, size = 20, max = 3 }: TechStackProps) {
  const visible = ids.slice(0, max);
  const overflow = ids.length - visible.length;

  return (
    <span
      data-slot="tech-stack"
      style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}
    >
      {visible.map((id) => {
        const tech = staff.find((s) => s.id === id);
        if (!tech) return null;
        return (
          <InitialsAvatar
            key={id}
            name={tech.displayName}
            colorToken={tech.colorToken}
            size={size}
          />
        );
      })}
      {overflow > 0 ? (
        <span
          className="tx-tech-overflow"
          style={{
            width: size,
            height: size,
            borderRadius: 9999,
            background: "var(--neutral-200)",
            color: "var(--muted-foreground)",
            fontSize: Math.round(size * 0.4),
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
