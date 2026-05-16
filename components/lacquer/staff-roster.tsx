// StaffRoster — server component. Renders the `.auth-roster` grid of staff
// tiles for `/select-staff`.
//
// Each tile is wrapped in its own `<form method="get" action="/select-staff">`
// with hidden inputs for `selectedTileId` and the propagated `next`. Tapping
// the tile submits the GET form, which re-renders the page with the keypad
// slot filled. No client JS required — the tap → keypad transition is
// server-rendered.
//
// Ordering: roles are surfaced top-to-bottom (owner → manager → technician →
// front_desk); within a role, tiles are sorted by `display_name` ascending.

import { StaffTile } from "./staff-tile";

type StaffRow = {
  id: string;
  display_name: string;
  role: string;
  color_token: string;
  pin_reset_admin_at: string | null;
};

export type StaffRosterProps = {
  staff: StaffRow[];
  selectedId?: string;
  next?: string;
};

const ROLE_PRIORITY: Record<string, number> = {
  owner: 0,
  manager: 1,
  technician: 2,
  front_desk: 3,
};

function rolePriority(role: string): number {
  return ROLE_PRIORITY[role] ?? 99;
}

function sortRoster(rows: StaffRow[]): StaffRow[] {
  return [...rows].sort((a, b) => {
    const ra = rolePriority(a.role);
    const rb = rolePriority(b.role);
    if (ra !== rb) return ra - rb;
    return a.display_name.localeCompare(b.display_name);
  });
}

export function StaffRoster({ staff, selectedId, next }: StaffRosterProps) {
  const ordered = sortRoster(staff);
  return (
    <div className="auth-roster" role="group" aria-label="Staff roster">
      {ordered.map((row) => (
        <form key={row.id} method="get" action="/select-staff" style={{ display: "contents" }}>
          <input type="hidden" name="selectedTileId" value={row.id} />
          <input type="hidden" name="next" value={next ?? ""} />
          <StaffTile staff={row} selected={selectedId === row.id} />
        </form>
      ))}
    </div>
  );
}
