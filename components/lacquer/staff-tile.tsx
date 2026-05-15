// StaffTile — server component. One tap-target tile on the `/select-staff`
// roster.
//
// Renders as a `<button type="submit">` inside the form wrapper that
// `<StaffRoster />` lays around each tile (the form posts a GET to
// `/select-staff?selectedTileId=<id>&next=<...>` so the page re-renders with
// the PIN keypad slot filled — no client JS for the tap → keypad transition).
//
// All visuals trace to tokens in `styles/tokens.css`. The avatar background
// is a soft-tint Lacquer pattern: `oklch(from var(--accent-rose) l c h / 0.15)`
// — same idiom used by the studio dashboard's tinted surfaces.

type StaffShape = {
  id: string;
  display_name: string;
  role: string;
  color_token: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "manager":
      return "Manager";
    case "technician":
      return "Tech";
    case "front_desk":
      return "Front desk";
    default:
      return role;
  }
}

export type StaffTileProps = {
  staff: StaffShape;
  selected?: boolean;
};

export function StaffTile({ staff, selected }: StaffTileProps) {
  const tint = `oklch(from var(${staff.color_token}) l c h / 0.15)`;
  const ring = `var(${staff.color_token})`;

  return (
    <button
      type="submit"
      className={selected ? "auth-staff-tile selected" : "auth-staff-tile"}
      aria-pressed={selected ? "true" : "false"}
      data-staff-id={staff.id}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "var(--space-12)",
          height: "var(--space-12)",
          borderRadius: "var(--radius-full)",
          background: tint,
          color: ring,
          fontWeight: 600,
          fontSize: "var(--text-base)",
          letterSpacing: "var(--tracking-wide)",
        }}
      >
        {initials(staff.display_name)}
      </span>
      <span
        style={{
          fontWeight: 500,
          fontSize: "var(--text-sm)",
          color: "var(--card-foreground)",
        }}
      >
        {staff.display_name}
      </span>
      <span
        style={{
          fontSize: "var(--text-xs)",
          letterSpacing: "var(--tracking-wide)",
          textTransform: "uppercase",
          background: "var(--muted)",
          color: "var(--muted-foreground)",
          padding: "var(--space-1) var(--space-2)",
          borderRadius: "var(--radius-full)",
        }}
      >
        {roleLabel(staff.role)}
      </span>
    </button>
  );
}
