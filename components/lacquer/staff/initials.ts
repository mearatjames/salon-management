// Pure helpers for staff display chrome.
//
// Extracted from `components/lacquer/operator-chip.tsx` so both the topbar
// `OperatorChip` and the sidebar footer (`sidebar-footer.tsx`) can share the
// same name→initials and role→label logic without duplication.
//
// No React, no JSX — these are pure functions covered by
// `tests/unit/staff/initials.test.ts`.

export type StaffRole = "owner" | "manager" | "technician" | "front_desk" | (string & {});

/**
 * Convert a display name into a 1–2 character avatar label.
 *
 * - Empty / whitespace-only name → "?"
 * - Single word → first two characters, uppercased
 * - Two+ words → first character of the first word + first character of the
 *   last word, uppercased
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Human-friendly label for a staff role. Unknown roles pass through verbatim
 * so a future role added in the database is at least visible until the UI
 * catches up.
 */
export function roleLabel(role: string): string {
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
