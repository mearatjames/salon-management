import type { Technician } from "@/lib/dashboard/mock-data";
import { TechAvatar } from "@/components/lacquer/tech-avatar";

export type TechsOnShiftTileProps = {
  staff: readonly Technician[];
};

// Server component — wrap-flex tile listing every tech "on shift". In v1
// `staff === STAFF`. `flexWrap: "wrap"` is non-negotiable so rosters larger
// than fit on one row overflow to a new line (spec Edge case "Long tech
// rosters"). Color / border / radius all resolve to Lacquer tokens.
export function TechsOnShiftTile({ staff }: TechsOnShiftTileProps) {
  return (
    <div
      data-slot="techs-on-shift-tile"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        padding: 12,
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      {staff.map((tech) => (
        <div
          key={tech.id}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            minWidth: 44,
          }}
        >
          <TechAvatar tech={tech} size={32} />
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: "var(--foreground)",
            }}
          >
            {tech.full.split(" ")[0]}
          </span>
        </div>
      ))}
    </div>
  );
}
