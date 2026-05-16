"use client";

// StaffAssignmentList — per-tech checkbox + per-tech duration override input
// for the services drawer. Renders one row per active staff. The parent
// (drawer.client.tsx) owns the draft state and pipes:
//
//   - `assignableStaff`   the full active roster (server-rendered, immutable)
//   - `draftAssignments`  the current draft state (only the assigned subset)
//   - `onToggle`          fires when a staff checkbox flips
//   - `onOverrideChange`  fires when a row's override input changes
//   - `disabled`          true for US6 read-only mode (technician / front-desk)
//
// Override input semantics:
//   - Disabled until the row is ticked.
//   - Empty input → `null` override (defer to the service's `duration_min`).
//   - Positive integer → an override (the validator at submit time enforces
//     positive-int shape; this island accepts any digits while the operator
//     types).

import { ROLE_LABEL } from "./_role-label";

import type { AssignableStaff, ServiceAssignment } from "@/app/(studio)/settings/services/_types";

export type StaffAssignmentListProps = {
  assignableStaff: AssignableStaff[];
  draftAssignments: ServiceAssignment[];
  onToggle: (staffId: string, ticked: boolean) => void;
  onOverrideChange: (staffId: string, value: string) => void;
  /** Read-only mode (US6): every input + checkbox is disabled. */
  disabled?: boolean;
};

export function StaffAssignmentList({
  assignableStaff,
  draftAssignments,
  onToggle,
  onOverrideChange,
  disabled = false,
}: StaffAssignmentListProps) {
  // Index the draft so per-row lookups are O(1).
  const byId = new Map(draftAssignments.map((a) => [a.staff_id, a]));

  return (
    <div
      data-slot="staff-assignment-list"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <span
        style={{
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          color: "var(--foreground)",
        }}
      >
        Who can perform this service?
      </span>

      {assignableStaff.length === 0 ? (
        <p
          data-slot="staff-assignment-empty"
          style={{
            margin: 0,
            padding: "var(--space-4)",
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
            background: "var(--muted)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          No active staff. Add staff first.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          {assignableStaff.map((staff) => {
            const draft = byId.get(staff.id);
            const checked = draft !== undefined;
            const overrideValue =
              draft?.duration_min_override !== null && draft?.duration_min_override !== undefined
                ? String(draft.duration_min_override)
                : "";
            const overrideDisabled = disabled || !checked;
            return (
              <li
                key={staff.id}
                data-slot="staff-assignment-row"
                data-staff-id={staff.id}
                data-checked={checked ? "true" : "false"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                  padding: "var(--space-2) var(--space-3)",
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                {/* Avatar dot (uses the staff's color_token directly). */}
                <span
                  aria-hidden="true"
                  style={{
                    width: "var(--space-5)",
                    height: "var(--space-5)",
                    borderRadius: "var(--radius-full)",
                    background: `var(${staff.color_token})`,
                    flexShrink: 0,
                    border: "1px solid var(--border)",
                  }}
                />

                {/* Name + role label. */}
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: "1 1 auto",
                    minWidth: 0,
                  }}
                >
                  <span
                    data-slot="staff-assignment-name"
                    style={{
                      fontSize: "var(--text-sm)",
                      fontWeight: 500,
                      color: "var(--foreground)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {staff.display_name}
                  </span>
                  <span
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--muted-foreground)",
                    }}
                  >
                    {ROLE_LABEL[staff.role]}
                  </span>
                </span>

                {/* Override input — disabled until the checkbox is ticked. */}
                <label
                  data-slot="staff-assignment-override"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    fontSize: "var(--text-xs)",
                    color: overrideDisabled ? "var(--muted-foreground)" : "var(--foreground)",
                  }}
                >
                  <span>Override</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label={`Duration override (minutes) for ${staff.display_name}`}
                    value={overrideValue}
                    onChange={(e) => onOverrideChange(staff.id, e.target.value)}
                    disabled={overrideDisabled}
                    placeholder="min"
                    data-slot="staff-assignment-override-input"
                    style={{
                      width: `calc(var(--space-16) * 0.75)`,
                      padding: "var(--space-1) var(--space-2)",
                      background: "var(--card)",
                      color: "var(--foreground)",
                      border: "1px solid var(--input)",
                      borderRadius: "var(--radius-xs)",
                      fontSize: "var(--text-sm)",
                      fontVariantNumeric: "tabular-nums",
                      outline: "none",
                      cursor: overrideDisabled ? "not-allowed" : "text",
                      opacity: overrideDisabled ? 0.5 : 1,
                    }}
                  />
                </label>

                {/* Checkbox — drives the ticked state. */}
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onToggle(staff.id, e.target.checked)}
                  disabled={disabled}
                  aria-label={`Assign ${staff.display_name}`}
                  data-slot="staff-assignment-checkbox"
                  style={{
                    width: "var(--space-4)",
                    height: "var(--space-4)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.5 : 1,
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
