import { STAFF } from "@/lib/dashboard/mock-data";
import { TechAvatar } from "@/components/lacquer/tech-avatar";

export type TechStackProps = {
  ids: readonly string[];
  size?: number;
  max?: number;
};

// Server component — overlap stack of up to `max` avatars. When `ids.length`
// exceeds `max`, renders a trailing `.tx-tech-overflow` chip showing `+N`.
// Mirrors `design-system/prototypes/transaction/TechPicker.jsx:34-60`.
export function TechStack({ ids, size = 20, max = 3 }: TechStackProps) {
  const visible = ids.slice(0, max);
  const overflow = ids.length - visible.length;
  const overlapPx = Math.round(size * 0.35);

  return (
    <span data-slot="tech-stack" style={{ display: "inline-flex", alignItems: "center" }}>
      {visible.map((id, index) => {
        const tech = STAFF.find((s) => s.id === id);
        if (!tech) return null;
        return (
          <span key={id} style={{ marginLeft: index === 0 ? 0 : -overlapPx }}>
            <TechAvatar tech={tech} size={size} />
          </span>
        );
      })}
      {overflow > 0 ? (
        <span
          className="tx-tech-overflow"
          style={{
            width: size,
            height: size,
            borderRadius: 9999,
            marginLeft: -overlapPx,
            background: "var(--neutral-200)",
            color: "var(--muted-foreground)",
            fontSize: Math.round(size * 0.4),
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 0 2px var(--card)",
          }}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
