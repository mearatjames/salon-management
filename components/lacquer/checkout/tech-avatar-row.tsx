"use client";

// TechAvatarRow — adapted from `design-system/prototypes/transaction/FlowSingle.jsx`
// § tech assignment block (single-select variant, lines 185-199 of the
// prototype). Two render states per FR-006 / FR-007:
//
//   pre-pick:  a horizontal row of staff avatars (initials inside a tinted
//              swatch derived from `staff.color_token`). The first tap
//              selects the tech for the whole transaction.
//   post-pick: the row collapses to a compact chip ("● Maya Patel") + a
//              "Change" text link that returns to the pre-pick state.
//
// All visuals trace to Lacquer tokens. No emoji in chrome; the colored
// dot in the chip is a `<span>` background, not a glyph (Principle I).

import { InitialsAvatar } from "@/components/lacquer/initials-avatar";

type ActiveStaff = {
  id: string;
  display_name: string;
  color_token: string;
};

export type TechAvatarRowProps = {
  /** Active staff roster to choose from. */
  staff: ReadonlyArray<ActiveStaff>;
  /** Currently selected staff id; `null` when no tech is picked yet. */
  selectedStaffId: string | null;
  /** Called with a staff id when the operator picks (pre-pick state only). */
  onPick: (staffId: string) => void;
  /** Called when the operator taps "Change" in the post-pick chip. */
  onClear: () => void;
};

// First name only — labels each avatar in the pre-pick picker so techs
// are identifiable at a glance. Mirrors the prototype's
// `t.full.split(" ")[0]` (`TechPicker.jsx:88`).
function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || name;
}

export function TechAvatarRow({ staff, selectedStaffId, onPick, onClear }: TechAvatarRowProps) {
  const selected = selectedStaffId ? (staff.find((s) => s.id === selectedStaffId) ?? null) : null;

  if (selected) {
    // Post-pick: collapsed chip.
    return (
      <div
        data-slot="checkout-tech-chip"
        data-staff-id={selected.id}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-full)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: "var(--space-2)",
            height: "var(--space-2)",
            borderRadius: "var(--radius-full)",
            background: `var(${selected.color_token})`,
          }}
        />
        <span
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            color: "var(--foreground)",
          }}
        >
          {selected.display_name}
        </span>
        <button
          type="button"
          onClick={onClear}
          data-slot="change-tech-link"
          style={{
            marginLeft: "var(--space-2)",
            background: "transparent",
            border: "none",
            color: "var(--primary)",
            fontSize: "var(--text-xs)",
            fontWeight: 500,
            cursor: "pointer",
            padding: 0,
          }}
        >
          Change
        </button>
      </div>
    );
  }

  // Pre-pick: avatar row.
  return (
    <div
      data-slot="checkout-tech-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: "var(--text-xs)",
          textTransform: "uppercase",
          letterSpacing: "var(--tracking-wide)",
          color: "var(--muted-foreground)",
          fontWeight: 500,
        }}
      >
        Assign a tech to start
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
        {staff.map((s) => {
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s.id)}
              data-staff-name={s.display_name}
              data-staff-id={s.id}
              title={s.display_name}
              aria-label={`Assign ${s.display_name} as the tech for this sale`}
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "var(--space-1)",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              {/* Initials swatch — decorative; the button's aria-label
                  and the name span below carry the accessible meaning. */}
              <InitialsAvatar name={s.display_name} colorToken={s.color_token} size={32} />
              <span
                style={{
                  maxWidth: "var(--space-16)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: "var(--text-xs)",
                  fontWeight: 500,
                  color: "var(--foreground)",
                }}
              >
                {firstName(s.display_name)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
