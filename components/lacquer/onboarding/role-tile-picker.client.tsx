"use client";

// RoleTilePicker — 4-tile role chooser for the Onboard sheet.
//
// Adapted from `design-system/prototypes/onboarding/OnboardSheet.jsx`
// `RolePicker`. Labels + short summaries come from
// `lib/auth/role-permissions.ts`, which is the single source of truth
// pinned by `tests/unit/auth/role-permissions.test.ts`.
//
// This is the client variant. The parent (OnboardSheet) is a client island
// already, so a controlled `value`/`onChange` API is the natural shape —
// no separate server-rendered presentational variant is needed for v1.
//
// Token discipline: every value resolves to `styles/tokens.css` (see
// `styles/onboarding.css` `.onb-role-tile*` rules). No hex, no off-scale
// spacing. The `data-selected="true"` attribute toggles the active border
// via CSS instead of inline styles.

import type { StudioRole } from "@/lib/auth/session";
import { ROLE_PERMISSIONS } from "@/lib/auth/role-permissions";

const ROLES: ReadonlyArray<StudioRole> = ["owner", "manager", "technician", "front_desk"];

export type RoleTilePickerProps = {
  value: StudioRole;
  onChange: (next: StudioRole) => void;
  /** Visual id used to scope tests/queries (default "onb-role-tile"). */
  testIdPrefix?: string;
};

/**
 * Truncate a role's `summary` to a single short clause for the tile.
 * Matches the prototype's "sub" string convention (≈ 28–40 chars) by
 * splitting on the first sentence boundary and falling back to a hard
 * 48-char cap so any future copy edit stays within tile bounds.
 */
function shortSummary(role: StudioRole): string {
  const full = ROLE_PERMISSIONS[role].summary;
  const firstClause = full.split(/[.,]/)[0]?.trim() ?? full;
  return firstClause.length > 48 ? `${firstClause.slice(0, 47)}…` : firstClause;
}

export function RoleTilePicker({
  value,
  onChange,
  testIdPrefix = "onb-role-tile",
}: RoleTilePickerProps) {
  return (
    <div className="onb-role-grid" role="radiogroup" aria-label="Role">
      {ROLES.map((role) => {
        const def = ROLE_PERMISSIONS[role];
        const selected = value === role;
        return (
          <button
            key={role}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-current={selected ? "true" : undefined}
            data-slot={testIdPrefix}
            data-role={role}
            data-selected={selected ? "true" : "false"}
            className="onb-role-tile"
            onClick={() => onChange(role)}
          >
            <span className="onb-role-tile-radio" aria-hidden="true" />
            <span className="onb-role-tile-text">
              <span className="onb-role-tile-label">{def.label}</span>
              <span className="onb-role-tile-sub">{shortSummary(role)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
