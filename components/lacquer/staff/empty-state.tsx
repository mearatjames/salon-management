// EmptyState — the right-column "Select a staff member" placeholder.
// Server Component, pure layout. Copy is verbatim from
// `specs/006-staff-management/contracts/ui.contract.md` § Empty-states.

import { Users } from "lucide-react";

export function StaffEmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-3)",
        padding: "var(--space-12) var(--space-6)",
        textAlign: "center",
        color: "var(--muted-foreground)",
      }}
      data-slot="staff-empty-state"
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
          background: "oklch(from var(--muted-foreground) l c h / 0.10)",
          color: "var(--muted-foreground)",
        }}
      >
        <Users size={24} strokeWidth={1.5} />
      </span>
      <h3
        style={{
          margin: 0,
          fontSize: "var(--text-lg)",
          fontWeight: 600,
          color: "var(--foreground)",
        }}
      >
        Select a staff member
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: "var(--text-sm)",
          maxWidth: "calc(var(--space-16) * 5)",
          lineHeight: "var(--leading-normal)",
        }}
      >
        Choose someone from the roster to edit their details, change their role, or update their PIN.
      </p>
    </div>
  );
}
